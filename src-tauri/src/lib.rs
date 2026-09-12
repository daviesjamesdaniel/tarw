mod accounts;
mod imap_client;
mod oauth;
mod password_auth;
mod providers;
mod smtp_client;

use melib::imap::ImapType;
use providers::ProviderConfig;
use serde::Serialize;
use std::sync::Mutex;
use tauri::{
    image::Image,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager,
};

// Constant for the tray icon, a bit of a hack as no easy way
// to detect light v dark mode for the system tray
const TRAY_ICON_BYTES: &[u8] = include_bytes!("../icons/tray-icon.png");

// Connection pool used rather than one shared connection
// Used primarily with search to fan out concurrent calls across mailboxes
// One lock/connection per account would serialize everything
#[derive(Default)]
struct AppState {
    connections:
        Mutex<std::collections::HashMap<String, Vec<std::sync::Arc<Mutex<Box<ImapType>>>>>>,
    watcher_stop_flags:
        Mutex<std::collections::HashMap<String, std::sync::Arc<std::sync::atomic::AtomicBool>>>,
    // Resolved provider config per account, populated on add_account and at
    // startup from accounts.json - lets with_connection/spawn_watcher/
    // spawn_keepalive reconnect without re-reading+re-resolving the
    // registry file on every reconnect.
    providers: Mutex<std::collections::HashMap<String, ProviderConfig>>,
}

fn provider_for(state: &AppState, account: &str) -> melib::Result<ProviderConfig> {
    state
        .providers
        .lock()
        .unwrap()
        .get(account)
        .cloned()
        .ok_or_else(|| melib::error::Error::new(format!("No provider config cached for {account}")))
}

fn is_connection_dead(err: &melib::Error) -> bool {
    err.kind.is_disconnected()
        || err.kind.is_network()
        || err.kind.is_timeout()
        || err.summary.contains("Disconnected")
}

/// A torn WAL/SHM sidecar (e.g. from a hard process kill mid-write) can
/// leave melib's sqlite header cache genuinely unreadable. The server is
/// always the real source of truth for mail, so the safe remedy is just to
/// delete the cache and let melib rebuild it from scratch - not something
/// the user should ever have to do by hand over SSH.
fn is_cache_corrupted(err: &melib::Error) -> bool {
    err.summary.contains("malformed") || err.summary.contains("disk image")
}

// Each pooled connection (see POOL_SIZE below) keeps its own independent
// mailbox list, populated once on first use. A mailbox created or deleted
// after that means every *other* pooled connection for the account is now
// stale and doesn't know about it - melib's own retry-with-backoff (see the
// fork's imap/mod.rs fetch()) eventually gives up with this message.
fn is_unknown_mailbox(err: &melib::Error) -> bool {
    err.summary.contains("no longer exists")
}

// Creating/deleting a mailbox only updates the one pooled connection that
// performed it. Left alone, every other pooled connection would only learn
// about the change the slow way - via melib's own multi-second
// retry-with-backoff inside fetch() (see is_unknown_mailbox above) - the
// first time something tries to use it. Refresh them all synchronously
// right away instead, best-effort, so nothing has to pay that cost later.
fn refresh_all_connections(state: &AppState, account: &str) {
    let pool = state
        .connections
        .lock()
        .unwrap()
        .get(account)
        .cloned()
        .unwrap_or_default();
    for conn in pool {
        if let Ok(mut imap) = conn.lock() {
            let _ = imap_client::refresh_mailboxes(&mut imap);
        }
    }
}

const POOL_SIZE: usize = 3;

//Reuse a free slot, grow the pool if there is room, block on the first slot if full
fn with_connection<T>(
    state: &AppState,
    account: &str,
    f: impl Fn(&mut ImapType) -> melib::Result<T>,
) -> melib::Result<T> {
    let pool = {
        let mut guard = state.connections.lock().unwrap();
        guard.entry(account.to_string()).or_default().clone()
    };

    for conn in &pool {
        if let Ok(imap) = conn.try_lock() {
            return run_on_slot(state, account, conn, imap, &f);
        }
    }

    if pool.len() < POOL_SIZE {
        let provider = provider_for(state, account)?;
        let fresh = std::sync::Arc::new(Mutex::new(imap_client::connect(account, &provider)?));
        state
            .connections
            .lock()
            .unwrap()
            .entry(account.to_string())
            .or_default()
            .push(fresh.clone());
        let imap = fresh.lock().unwrap();
        return run_on_slot(state, account, &fresh, imap, &f);
    }

    let conn = pool[0].clone();
    let imap = conn.lock().unwrap();
    run_on_slot(state, account, &conn, imap, &f)
}

fn run_on_slot<T>(
    state: &AppState,
    account: &str,
    conn: &std::sync::Arc<Mutex<Box<ImapType>>>,
    mut imap: std::sync::MutexGuard<'_, Box<ImapType>>,
    f: &impl Fn(&mut ImapType) -> melib::Result<T>,
) -> melib::Result<T> {
    let result = f(&mut imap);
    let Err(err) = result else {
        return result;
    };
    let cache_corrupted = is_cache_corrupted(&err);
    let unknown_mailbox = is_unknown_mailbox(&err);
    if !is_connection_dead(&err) && !cache_corrupted && !unknown_mailbox {
        return Err(err);
    }
    if unknown_mailbox && !is_connection_dead(&err) {
        // Cheaper than a full reconnect below: the connection itself is fine,
        // it just never learned about a mailbox created/removed elsewhere.
        // Refresh its mailbox list in place and retry once before giving up
        // on it entirely.
        let _ = imap_client::refresh_mailboxes(&mut imap);
        return f(&mut imap);
    }
    if cache_corrupted {
        // Best-effort - if cleanup itself fails, still try to reconnect;
        // the original corruption error is more useful to the caller than
        // a cleanup-failure error would be.
        let _ = imap_client::remove_cache_files(account);
    }
    let reconnect = provider_for(state, account).and_then(|provider| imap_client::connect(account, &provider));
    let Ok(fresh) = reconnect else {
        drop(imap);
        state
            .connections
            .lock()
            .unwrap()
            .entry(account.to_string())
            .or_default()
            // Evict just the one slot not the whole account connection pool
            // if connection dead. A bad connection shouldn't kill healthy siblings
            .retain(|c| !std::sync::Arc::ptr_eq(c, conn));
        return Err(reconnect.unwrap_err());
    };
    *imap = fresh;
    let retry_result = f(&mut imap);
    if retry_result.is_err() {
        drop(imap);
        state
            .connections
            .lock()
            .unwrap()
            .entry(account.to_string())
            .or_default()
            .retain(|c| !std::sync::Arc::ptr_eq(c, conn));
    }
    retry_result
}

fn parse_mailbox_hash(s: &str) -> Result<melib::backends::MailboxHash, String> {
    s.parse::<u64>()
        .map(melib::backends::MailboxHash)
        .map_err(|_| "invalid mailbox hash".to_string())
}

#[derive(Serialize)]
struct EnvelopeDto {
    hash: String,
    subject: String,
    from: String,
    from_address: String,
    to: Vec<String>,
    cc: Vec<String>,
    date: u64,
    is_seen: bool,
    is_flagged: bool,
    has_attachments: bool,
}

#[derive(Serialize)]
struct MailboxInfoDto {
    hash: String,
    name: String,
    path: String,
    unread: usize,
    total: usize,
    special_usage: String,
    parent_hash: Option<String>,
}

#[derive(Serialize)]
struct AttachmentInfoDto {
    index: usize,
    filename: String,
    mime_type: String,
    size: usize,
}

#[derive(Serialize)]
struct BodyDto {
    body: String,
    is_html: bool,
    attachments: Vec<AttachmentInfoDto>,
    from: String,
    to: Vec<String>,
    cc: Vec<String>,
    reply_to: String,
    subject: String,
    date: u64,
    message_id: String,
    references: String,
}

fn mailbox_infos_to_dtos(infos: Vec<imap_client::MailboxInfo>) -> Vec<MailboxInfoDto> {
    infos
        .into_iter()
        .map(|m| MailboxInfoDto {
            hash: m.hash.0.to_string(),
            name: m.name,
            path: m.path,
            unread: m.unread,
            total: m.total,
            special_usage: m.special_usage,
            parent_hash: m.parent_hash.map(|h| h.0.to_string()),
        })
        .collect()
}

#[tauri::command]
async fn fetch_mailboxes(app: tauri::AppHandle, account: String) -> Result<Vec<MailboxInfoDto>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        with_connection(&state, &account, |imap| imap_client::list_mailboxes(imap))
            .map(mailbox_infos_to_dtos)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn refresh_mailboxes(app: tauri::AppHandle, account: String) -> Result<Vec<MailboxInfoDto>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        with_connection(&state, &account, |imap| imap_client::refresh_mailboxes(imap))
            .map(mailbox_infos_to_dtos)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

impl From<imap_client::EnvelopeRow> for EnvelopeDto {
    fn from(r: imap_client::EnvelopeRow) -> Self {
        Self {
            hash: r.hash.0.to_string(),
            subject: r.subject,
            from: r.from,
            from_address: r.from_address,
            to: r.to,
            cc: r.cc,
            date: r.date,
            is_seen: r.is_seen,
            is_flagged: r.is_flagged,
            has_attachments: r.has_attachments,
        }
    }
}

#[tauri::command]
async fn fetch_mailbox_messages(
    app: tauri::AppHandle,
    account: String,
    mailbox_hash: String,
) -> Result<Vec<EnvelopeDto>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mailbox_hash = parse_mailbox_hash(&mailbox_hash)?;
        let state = app.state::<AppState>();
        with_connection(&state, &account, |imap| {
            imap_client::list_mailbox(imap, mailbox_hash)
        })
        .map(|rows| rows.into_iter().map(EnvelopeDto::from).collect())
        .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct MailboxRequest {
    account: String,
    mailbox_hash: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MailboxBatchResult {
    account: String,
    mailbox_hash: String,
    rows: Option<Vec<EnvelopeDto>>,
    error: Option<String>,
}

#[tauri::command]
async fn fetch_mailbox_messages_batch(
    app: tauri::AppHandle,
    requests: Vec<MailboxRequest>,
) -> Vec<MailboxBatchResult> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let state = &state;
        // We used to fire one invoke() per mailbox but replaced with
        // Vec<MailboxRequest> to fan out as concurrent threads inside the
        // single command each doing its own with_connection / list_mailbox
        // and joining all results before return
        std::thread::scope(|scope| {
            let handles: Vec<_> = requests
                .into_iter()
                .map(|req| {
                    scope.spawn(move || {
                        let mailbox_hash = match parse_mailbox_hash(&req.mailbox_hash) {
                            Ok(h) => h,
                            Err(err) => {
                                return MailboxBatchResult {
                                    account: req.account,
                                    mailbox_hash: req.mailbox_hash,
                                    rows: None,
                                    error: Some(err),
                                };
                            }
                        };
                        match with_connection(state, &req.account, |imap| {
                            imap_client::list_mailbox(imap, mailbox_hash)
                        }) {
                            Ok(rows) => MailboxBatchResult {
                                account: req.account,
                                mailbox_hash: req.mailbox_hash,
                                rows: Some(rows.into_iter().map(EnvelopeDto::from).collect()),
                                error: None,
                            },
                            Err(err) => MailboxBatchResult {
                                account: req.account,
                                mailbox_hash: req.mailbox_hash,
                                rows: None,
                                error: Some(err.to_string()),
                            },
                        }
                    })
                })
                .collect();
            handles.into_iter().map(|h| h.join().unwrap()).collect()
        })
    })
    .await
    .unwrap_or_default()
}

#[tauri::command]
async fn fetch_body(app: tauri::AppHandle, account: String, hash: String) -> Result<BodyDto, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let hash: u64 = hash.parse().map_err(|_| "invalid hash".to_string())?;
        let hash = melib::email::EnvelopeHash(hash);
        let state = app.state::<AppState>();
        with_connection(&state, &account, |imap| imap_client::fetch_body(imap, hash))
            .map(|r| BodyDto {
                body: r.body,
                is_html: r.is_html,
                attachments: r
                    .attachments
                    .into_iter()
                    .map(|a| AttachmentInfoDto {
                        index: a.index,
                        filename: a.filename,
                        mime_type: a.mime_type,
                        size: a.size,
                    })
                    .collect(),
                from: r.from,
                to: r.to,
                cc: r.cc,
                reply_to: r.reply_to,
                subject: r.subject,
                date: r.date,
                message_id: r.message_id,
                references: r.references,
            })
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn save_attachment(
    app: tauri::AppHandle,
    account: String,
    hash: String,
    index: usize,
    dest_path: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let hash: u64 = hash.parse().map_err(|_| "invalid hash".to_string())?;
        let hash = melib::email::EnvelopeHash(hash);
        let state = app.state::<AppState>();
        let (_filename, _mime_type, bytes) = with_connection(&state, &account, |imap| {
            imap_client::fetch_attachment(imap, hash, index)
        })
        .map_err(|e| e.to_string())?;
        std::fs::write(&dest_path, bytes).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn open_attachment(
    app: tauri::AppHandle,
    account: String,
    hash: String,
    index: usize,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let hash_num: u64 = hash.parse().map_err(|_| "invalid hash".to_string())?;
        let envelope_hash = melib::email::EnvelopeHash(hash_num);
        let state = app.state::<AppState>();
        let (filename, _mime_type, bytes) = with_connection(&state, &account, |imap| {
            imap_client::fetch_attachment(imap, envelope_hash, index)
        })
        .map_err(|e| e.to_string())?;

        let dir = std::env::temp_dir()
            .join("tarw")
            .join(format!("{hash}-{index}"));
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let path = dir.join(&filename);
        std::fs::write(&path, bytes).map_err(|e| e.to_string())?;

        tauri_plugin_opener::open_path(&path, None::<&str>).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn set_seen(
    app: tauri::AppHandle,
    account: String,
    hash: String,
    mailbox_hash: String,
    value: bool,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let hash: u64 = hash.parse().map_err(|_| "invalid hash".to_string())?;
        let hash = melib::email::EnvelopeHash(hash);
        let mailbox_hash = parse_mailbox_hash(&mailbox_hash)?;
        let state = app.state::<AppState>();
        with_connection(&state, &account, |imap| {
            imap_client::set_flag(imap, hash, mailbox_hash, melib::email::Flag::SEEN, value)
        })
        .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn set_flagged(
    app: tauri::AppHandle,
    account: String,
    hash: String,
    mailbox_hash: String,
    value: bool,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let hash: u64 = hash.parse().map_err(|_| "invalid hash".to_string())?;
        let hash = melib::email::EnvelopeHash(hash);
        let mailbox_hash = parse_mailbox_hash(&mailbox_hash)?;
        let state = app.state::<AppState>();
        with_connection(&state, &account, |imap| {
            imap_client::set_flag(imap, hash, mailbox_hash, melib::email::Flag::FLAGGED, value)
        })
        .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn mark_all_seen(app: tauri::AppHandle, account: String, mailbox_hash: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mailbox_hash = parse_mailbox_hash(&mailbox_hash)?;
        let state = app.state::<AppState>();
        with_connection(&state, &account, |imap| {
            imap_client::mark_all_seen(imap, mailbox_hash)
        })
        .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn delete_all_messages(app: tauri::AppHandle, account: String, mailbox_hash: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mailbox_hash = parse_mailbox_hash(&mailbox_hash)?;
        let state = app.state::<AppState>();
        with_connection(&state, &account, |imap| {
            imap_client::delete_all_messages(imap, mailbox_hash)
        })
        .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn create_mailbox(app: tauri::AppHandle, account: String, path: String) -> Result<Vec<MailboxInfoDto>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let result = with_connection(&state, &account, |imap| {
            imap_client::create_mailbox(imap, path.clone())
        })
        .map(mailbox_infos_to_dtos)
        .map_err(|e| e.to_string());
        if result.is_ok() {
            refresh_all_connections(&state, &account);
        }
        result
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn delete_mailbox(
    app: tauri::AppHandle,
    account: String,
    mailbox_hash: String,
    messages: String,
) -> Result<Vec<MailboxInfoDto>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mailbox_hash = parse_mailbox_hash(&mailbox_hash)?;
        let messages = match messages.as_str() {
            "move_to_parent" => imap_client::DeleteMailboxMessages::MoveToParent,
            "move_to_trash" => imap_client::DeleteMailboxMessages::MoveToTrash,
            other => return Err(format!("invalid messages policy: {other}")),
        };
        let state = app.state::<AppState>();
        let result = with_connection(&state, &account, |imap| {
            imap_client::delete_mailbox(imap, mailbox_hash, messages)
        })
        .map(mailbox_infos_to_dtos)
        .map_err(|e| e.to_string());
        if result.is_ok() {
            refresh_all_connections(&state, &account);
        }
        result
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn delete_message(
    app: tauri::AppHandle,
    account: String,
    hash: String,
    mailbox_hash: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let hash: u64 = hash.parse().map_err(|_| "invalid hash".to_string())?;
        let hash = melib::email::EnvelopeHash(hash);
        let mailbox_hash = parse_mailbox_hash(&mailbox_hash)?;
        let state = app.state::<AppState>();
        with_connection(&state, &account, |imap| {
            imap_client::delete_message(imap, hash, mailbox_hash)
        })
        .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn move_message(
    app: tauri::AppHandle,
    account: String,
    hash: String,
    source_mailbox_hash: String,
    destination_mailbox_hash: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let hash: u64 = hash.parse().map_err(|_| "invalid hash".to_string())?;
        let hash = melib::email::EnvelopeHash(hash);
        let source_mailbox_hash = parse_mailbox_hash(&source_mailbox_hash)?;
        let destination_mailbox_hash = parse_mailbox_hash(&destination_mailbox_hash)?;
        let state = app.state::<AppState>();
        with_connection(&state, &account, |imap| {
            imap_client::move_message(imap, hash, source_mailbox_hash, destination_mailbox_hash)
        })
        .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

fn resolve_outgoing_attachments(
    state: &AppState,
    account: &str,
    attachment_source_hash: &str,
    attachment_indices: Vec<usize>,
) -> Result<Vec<smtp_client::OutgoingAttachment>, String> {
    let mut attachments = Vec::new();
    if !attachment_source_hash.is_empty() {
        let hash: u64 = attachment_source_hash
            .parse()
            .map_err(|_| "invalid hash".to_string())?;
        let hash = melib::email::EnvelopeHash(hash);
        for index in attachment_indices {
            let (filename, mime_type, bytes) = with_connection(state, account, |imap| {
                imap_client::fetch_attachment(imap, hash, index)
            })
            .map_err(|e| e.to_string())?;
            attachments.push(smtp_client::OutgoingAttachment {
                filename,
                mime_type,
                bytes,
            });
        }
    }
    Ok(attachments)
}

#[tauri::command]
async fn send_message(
    app: tauri::AppHandle,
    account: String,
    to: String,
    cc: String,
    bcc: String,
    subject: String,
    body_html: String,
    body_text: String,
    in_reply_to: String,
    references: String,
    attachment_source_hash: String,
    attachment_indices: Vec<usize>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let attachments = resolve_outgoing_attachments(
            &state,
            &account,
            &attachment_source_hash,
            attachment_indices,
        )?;
        let provider = provider_for(&state, &account).map_err(|e| e.to_string())?;
        smtp_client::send(
            smtp_client::OutgoingMessage {
                to,
                cc,
                bcc,
                subject,
                body_html,
                body_text,
                in_reply_to,
                references,
                attachments,
            },
            &account,
            &provider,
        )
        .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn save_draft(
    app: tauri::AppHandle,
    account: String,
    to: String,
    cc: String,
    bcc: String,
    subject: String,
    body_html: String,
    body_text: String,
    in_reply_to: String,
    references: String,
    attachment_source_hash: String,
    attachment_indices: Vec<usize>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let attachments = resolve_outgoing_attachments(
            &state,
            &account,
            &attachment_source_hash,
            attachment_indices,
        )?;
        let raw = smtp_client::build_raw(
            &smtp_client::OutgoingMessage {
                to,
                cc,
                bcc,
                subject,
                body_html,
                body_text,
                in_reply_to,
                references,
                attachments,
            },
            &account,
            true,
        );

        with_connection(&state, &account, |imap| {
            imap_client::save_draft(imap, raw.clone().into_bytes())
        })
        .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn list_accounts(app: tauri::AppHandle) -> Result<Vec<accounts::AccountRecord>, String> {
    accounts::load(&app).map_err(|e| e.to_string())
}

#[tauri::command]
async fn remove_account(app: tauri::AppHandle, email: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        if let Some(flag) = state.watcher_stop_flags.lock().unwrap().remove(&email) {
            flag.store(true, std::sync::atomic::Ordering::Relaxed);
        }
        state.connections.lock().unwrap().remove(&email);
        state.providers.lock().unwrap().remove(&email);
        imap_client::remove_account_data(&email).map_err(|e| e.to_string())?;
        accounts::remove(&app, &email).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Frontend-supplied config for an unrecognized/self-hosted domain - always
/// password auth (manual entry never offers OAuth). Converts into a
/// `ProviderConfig` with a synthetic id, used only for the `Manual`
/// variant, never looked up by id elsewhere.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ManualProviderInput {
    imap_host: String,
    imap_port: u16,
    imap_use_tls: bool,
    smtp_host: String,
    smtp_port: u16,
    smtp_use_implicit_tls: bool,
}

impl ManualProviderInput {
    fn into_provider_config(self, email: &str) -> ProviderConfig {
        ProviderConfig {
            id: format!("manual:{email}"),
            display_name: self.imap_host.clone(),
            imap_host: self.imap_host,
            imap_port: self.imap_port,
            imap_use_tls: self.imap_use_tls,
            smtp_host: self.smtp_host,
            smtp_port: self.smtp_port,
            smtp_security: if self.smtp_use_implicit_tls {
                providers::SmtpSecurityKind::Tls
            } else {
                providers::SmtpSecurityKind::StartTls
            },
            auth_method: providers::AuthMethod::Password,
            oauth: None,
        }
    }
}

#[tauri::command]
fn detect_provider(email: String) -> Option<ProviderConfig> {
    providers::detect_from_email(&email)
}

/// Used by the edit-account flow to re-derive a builtin account's provider
/// config from its stored id, without re-running email-domain detection.
#[tauri::command]
fn provider_by_id(id: String) -> Option<ProviderConfig> {
    providers::by_id(&id)
}

#[tauri::command]
fn app_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

#[derive(Serialize)]
struct UpdateInfo {
    version: String,
    url: String,
    notes: String,
}

#[derive(serde::Deserialize)]
struct GithubRelease {
    tag_name: String,
    html_url: String,
    #[serde(default)]
    body: Option<String>,
}

/// Silent on any failure (offline, rate-limited, GitHub down) - this is a
/// best-effort notice, never something that should block startup or surface
/// an error to the user. Deliberately no version-range/semver-precedence
/// logic - a plain string inequality against GitHub's own "latest" release
/// is enough, since GitHub already picks the newest non-prerelease tag.
#[tauri::command]
async fn check_for_update() -> Option<UpdateInfo> {
    tauri::async_runtime::spawn_blocking(|| {
        let client = reqwest::blocking::Client::builder()
            .user_agent("tarw-update-check")
            .timeout(std::time::Duration::from_secs(5))
            .build()
            .ok()?;
        let release: GithubRelease = client
            .get("https://api.github.com/repos/daviesjamesdaniel/tarw/releases/latest")
            .send()
            .ok()?
            .json()
            .ok()?;
        let latest = release.tag_name.trim_start_matches('v');
        if latest == env!("CARGO_PKG_VERSION") {
            return None;
        }
        Some(UpdateInfo {
            version: latest.to_string(),
            url: release.html_url,
            notes: release.body.unwrap_or_default(),
        })
    })
    .await
    .ok()?
}

/// A no-op if there's no OAuth login currently in progress for this email -
/// the frontend calls this unconditionally when the add-account modal is
/// cancelled/closed, since it doesn't need to track whether a sign-in is
/// actually in flight.
#[tauri::command]
fn cancel_oauth_login(email: String) {
    oauth::cancel_login(&email);
}

#[tauri::command]
async fn test_imap_connection(
    email: String,
    manual: ManualProviderInput,
    password: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let provider = manual.into_provider_config(&email);
        imap_client::test_connect(&email, &provider, &password).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

// Tauri commands run synchronously on the shared IPC dispatch thread unless declared `async fn` -
// add_account could block that thread for minutes during an interactive OAuth sign-in, freezing
// every other command (including cancel_oauth_login, so Cancel did nothing). `async fn` moves it
// onto Tauri's async runtime; spawn_blocking is still needed inside since the actual work (IMAP
// connect, keyring access) is blocking I/O, not an awaitable future.
#[tauri::command]
async fn add_account(
    app: tauri::AppHandle,
    email: String,
    provider_id: Option<String>,
    manual: Option<ManualProviderInput>,
    password: Option<String>,
) -> Result<accounts::AccountRecord, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let provider = match (&provider_id, manual) {
            (Some(id), _) => providers::by_id(id).ok_or_else(|| "Unknown provider id".to_string())?,
            (None, Some(m)) => m.into_provider_config(&email),
            (None, None) => providers::detect_from_email(&email).ok_or_else(|| {
                "Could not detect provider - please enter connection details".to_string()
            })?,
        };

        if provider.auth_method == providers::AuthMethod::Password {
            let pw = password.ok_or_else(|| "Password required".to_string())?;
            password_auth::set_password(&email, &pw).map_err(|e| e.to_string())?;
        }

        let imap = imap_client::connect(&email, &provider).map_err(|e| e.to_string())?;
        state
            .connections
            .lock()
            .unwrap()
            .insert(email.clone(), vec![std::sync::Arc::new(Mutex::new(imap))]);
        state
            .providers
            .lock()
            .unwrap()
            .insert(email.clone(), provider.clone());

        let account_provider = match provider_id {
            Some(id) => accounts::AccountProvider::Builtin { id },
            None => accounts::AccountProvider::Manual(provider),
        };
        accounts::add(&app, &email, account_provider.clone()).map_err(|e| e.to_string())?;

        let stop_flag = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        {
            let mut flags = state.watcher_stop_flags.lock().unwrap();
            // Stop any watcher thread already running for this email before
            // replacing its flag - otherwise the old thread's Arc becomes
            // unreachable from here (still `false`, no way left to signal it)
            // and it keeps IDLE-ing forever alongside the new one, doubling
            // every notification.
            if let Some(old_flag) = flags.remove(&email) {
                old_flag.store(true, std::sync::atomic::Ordering::Relaxed);
            }
            flags.insert(email.clone(), stop_flag.clone());
        }
        spawn_watcher(app.clone(), email.clone(), stop_flag.clone());
        spawn_keepalive(app, email.clone(), stop_flag);

        Ok(accounts::AccountRecord {
            email,
            display_name: None,
            provider: account_provider,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

fn spawn_watcher(
    app: tauri::AppHandle,
    email: String,
    stop_flag: std::sync::Arc<std::sync::atomic::AtomicBool>,
) {
    use std::sync::atomic::Ordering;
    std::thread::spawn(move || loop {
        if stop_flag.load(Ordering::Relaxed) {
            return;
        }
        let provider = {
            let state = app.state::<AppState>();
            match provider_for(&state, &email) {
                Ok(p) => p,
                Err(err) => {
                    eprintln!("[watch:{email}] no provider config cached, stopping watcher: {err}");
                    return;
                }
            }
        };
        eprintln!("[watch:{email}] starting IMAP IDLE watch");
        let handle = app.clone();
        let change_handle = app.clone();
        let notify_email = email.clone();
        let change_email = email.clone();
        let result = imap_client::watch_inbox_for_new_mail(
            &email,
            &provider,
            move |envelope| {
                let subject = envelope.subject().to_string();
                let from = envelope
                    .from()
                    .first()
                    .map(|a| a.display_name().to_string())
                    .unwrap_or_else(|| "(unknown sender)".to_string());
                let row = EnvelopeDto::from(imap_client::envelope_row(envelope));
                let hash_for_click = row.hash.clone();
                let account_for_click = notify_email.clone();
                let click_handle = handle.clone();
                let notification = notify_rust::Notification::new()
                    .summary(&format!("New mail from {from}"))
                    .body(&subject)
                    .sound_name("message-new-email")
                    .icon(concat!(env!("CARGO_MANIFEST_DIR"), "/icons/128x128.png"))
                    .show();
                if let Ok(notif_handle) = notification {
                    std::thread::spawn(move || {
                        notif_handle.wait_for_action(|action| {
                            if action == "__closed" {
                                return;
                            }
                            if let Some(window) = click_handle.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                            let _ = click_handle.emit(
                                "open-message",
                                serde_json::json!({ "account": account_for_click, "hash": hash_for_click }),
                            );
                        });
                    });
                }
                let _ = handle.emit(
                    "inbox-changed",
                    serde_json::json!({ "account": notify_email, "from": from, "subject": subject, "row": row }),
                );
            },
            move || {
                let _ = change_handle.emit(
                    "inbox-changed",
                    serde_json::json!({ "account": change_email }),
                );
            },
        );
        if let Err(err) = result {
            eprintln!("[watch:{email}] IMAP IDLE watch ended: {err}");
        }
        if stop_flag.load(Ordering::Relaxed) {
            return;
        }
        for _ in 0..30 {
            if stop_flag.load(Ordering::Relaxed) {
                return;
            }
            std::thread::sleep(std::time::Duration::from_secs(1));
        }
    });
}

fn spawn_keepalive(
    app: tauri::AppHandle,
    email: String,
    stop_flag: std::sync::Arc<std::sync::atomic::AtomicBool>,
) {
    use std::sync::atomic::Ordering;
    std::thread::spawn(move || loop {
        for _ in 0..300 {
            if stop_flag.load(Ordering::Relaxed) {
                return;
            }
            std::thread::sleep(std::time::Duration::from_secs(1));
        }
        if stop_flag.load(Ordering::Relaxed) {
            return;
        }
        let state = app.state::<AppState>();
        let _ = with_connection(&state, &email, imap_client::keepalive);
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    unsafe {
        // Ran into issue with NVIDIA and open driver causing Error 71 (protocol error)
        // dispatching to Wayland display. A very well documented error and nothing we can
        // work around except to disable explicit-sync entirely with below, originally
        // disabled GPU compositing entirely with WEBKIT_DISABLE_DMABUF_RENDERER but was too heavy a fix
        std::env::set_var("__NV_DISABLE_EXPLICIT_SYNC", "1");
    }

    tauri::Builder::default()
        // Must be registered before any other plugin (Tauri's own
        // requirement) - a second launch hands off to this one instead of
        // starting a second process, avoiding real on-disk cache
        // corruption from two processes hitting the same melib sqlite
        // files at once.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            fetch_mailboxes,
            refresh_mailboxes,
            fetch_mailbox_messages,
            fetch_mailbox_messages_batch,
            create_mailbox,
            delete_mailbox,
            fetch_body,
            set_seen,
            set_flagged,
            mark_all_seen,
            delete_all_messages,
            delete_message,
            move_message,
            save_attachment,
            open_attachment,
            send_message,
            save_draft,
            remove_account,
            add_account,
            list_accounts,
            detect_provider,
            provider_by_id,
            check_for_update,
            app_version,
            test_imap_connection,
            cancel_oauth_login
        ])
        .setup(|app| {
            // Populate state.providers (and start watchers/keepalive) before the window/webview
            // is created, so the frontend's startup commands can never race ahead of this and
            // hit "No provider config cached for" on an account that hasn't been wired up yet.
            {
                let state = app.state::<AppState>();
                for record in accounts::load(&app.handle())? {
                    let provider = match record.provider.resolve() {
                        Ok(p) => p,
                        Err(err) => {
                            eprintln!("[startup] skipping {} - {err}", record.email);
                            continue;
                        }
                    };
                    state
                        .providers
                        .lock()
                        .unwrap()
                        .insert(record.email.clone(), provider);

                    let stop_flag = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
                    state
                        .watcher_stop_flags
                        .lock()
                        .unwrap()
                        .insert(record.email.clone(), stop_flag.clone());
                    spawn_watcher(app.handle().clone(), record.email.clone(), stop_flag.clone());
                    spawn_keepalive(app.handle().clone(), record.email, stop_flag);
                }
            }

            let window = tauri::WebviewWindowBuilder::new(
                app,
                "main",
                tauri::WebviewUrl::App("index.html".into()),
            )
            .title("Tarw")
            .inner_size(800.0, 600.0)
            .disable_drag_drop_handler()
            .on_navigation(|url| {
                let is_own_app =
                    url.scheme() == "tauri" || (cfg!(dev) && url.host_str() == Some("127.0.0.1"));
                if !is_own_app && (url.scheme() == "http" || url.scheme() == "https") {
                    let _ = tauri_plugin_opener::open_url(url.as_str(), None::<&str>);
                    false
                } else {
                    true
                }
            })
            .on_new_window(|url, _features| {
                let _ = tauri_plugin_opener::open_url(url.as_str(), None::<&str>);
                tauri::webview::NewWindowResponse::Deny
            })
            .build()?;

            let window_for_close = window.clone();
            window.on_window_event(move |event| {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window_for_close.hide();
                }
            });

            let show_item = MenuItem::with_id(app, "show", "Show", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let tray_menu = Menu::with_items(app, &[&show_item, &quit_item])?;

            TrayIconBuilder::new()
                .icon(Image::from_bytes(TRAY_ICON_BYTES).expect("valid tray icon PNG"))
                .menu(&tray_menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "quit" => app.exit(0),
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
