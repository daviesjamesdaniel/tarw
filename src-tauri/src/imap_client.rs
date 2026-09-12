use melib::backends::{
    prelude::*, BackendEvent, BackendEventConsumer, MailBackend, RefreshEventKind,
};
use melib::email::attachment_types::Text;
use melib::futures::StreamExt;
use melib::imap::ImapType;
use melib::smol::block_on;
use melib::{Address, Envelope, MessageID};
use std::sync::Arc;

pub struct EnvelopeRow {
    pub hash: melib::email::EnvelopeHash,
    pub subject: String,
    pub from: String,
    pub from_address: String,
    pub to: Vec<String>,
    pub cc: Vec<String>,
    pub date: u64,
    pub is_seen: bool,
    pub is_flagged: bool,
    pub has_attachments: bool,
    // For client-side thread grouping - references is the same
    // space-separated bracketed-MessageID format already used by BodyResult
    // below, so a thread's parent is just its last entry (matching melib's
    // own Envelope::in_reply_to() fallback logic, re-derived client-side
    // rather than sent as a separate field).
    pub message_id: String,
    pub references: String,
}

pub fn remove_account_data(email: &str) -> melib::Result<()> {
    crate::oauth::forget_credentials(email)?;
    crate::password_auth::forget_password(email)?;
    remove_cache_files(email)
}

/// Deletes just the on-disk sqlite header cache (main file + WAL/SHM
/// sidecars), leaving credentials untouched - used both for full account
/// removal above and as a self-heal step when the cache itself is corrupt
/// (see `is_cache_corrupted`/`run_on_slot` in lib.rs). Safe either way: the
/// IMAP server is always the real source of truth, melib rebuilds this
/// cache from scratch on the next fetch.
pub fn remove_cache_files(email: &str) -> melib::Result<()> {
    // melib itself owns this cache file and always uses its own crate name
    // as the XDG prefix, regardless of the embedding app's name - not "tarw".
    let xdg_dirs = xdg::BaseDirectories::with_prefix("meli").map_err(|e| {
        melib::error::Error::new(format!("Could not resolve meli's XDG data directory: {e}"))
    })?;
    // WAL-mode SQLite leaves -wal/-shm sidecar files alongside the main .db;
    // all three need removing or stale cache fragments survive "removal".
    for suffix in ["", "-wal", "-shm"] {
        let path = xdg_dirs
            .get_data_home()
            .join(format!("{email}_header_cache.db{suffix}"));
        if path.exists() {
            std::fs::remove_file(&path).map_err(|e| {
                melib::error::Error::new(format!(
                    "Could not remove cache file {}: {e}",
                    path.display()
                ))
            })?;
        }
    }
    Ok(())
}

pub fn keepalive(imap: &mut ImapType) -> melib::Result<()> {
    block_on(imap.is_online()?)
}

pub fn connect(
    email: &str,
    provider: &crate::providers::ProviderConfig,
) -> melib::Result<Box<ImapType>> {
    use crate::providers::AuthMethod;
    let (server_password, use_oauth2) = match provider.auth_method {
        AuthMethod::OAuth2 => (crate::oauth::get_xoauth2_password(email, provider)?, true),
        AuthMethod::Password => (crate::password_auth::get_password(email)?, false),
    };
    connect_inner(email, provider, server_password, use_oauth2)
}

/// Test-only entry point used by the add-account flow to validate a manual
/// IMAP+password config before it's persisted/keyring-stored - skips the
/// keyring read and uses a caller-supplied password directly.
pub fn test_connect(
    email: &str,
    provider: &crate::providers::ProviderConfig,
    password: &str,
) -> melib::Result<()> {
    connect_inner(email, provider, password.to_string(), false).map(|_| ())
}

fn connect_inner(
    email: &str,
    provider: &crate::providers::ProviderConfig,
    server_password: String,
    use_oauth2: bool,
) -> melib::Result<Box<ImapType>> {
    let account_conf = melib::conf::AccountSettings {
        name: email.to_string(),
        root_mailbox: "INBOX".to_string(),
        format: "imap".to_string(),
        identity: email.to_string(),
        extra_identities: vec![],
        read_only: false,
        display_name: None,
        subscribed_mailboxes: vec![],
        mailboxes: indexmap::indexmap! {},
        manual_refresh: false,
        extra: indexmap::indexmap! {
            "server_hostname".to_string() => provider.imap_host.clone(),
            "server_username".to_string() => email.to_string(),
            "server_password".to_string() => server_password,
            "server_port".to_string() => provider.imap_port.to_string(),
            "use_tls".to_string() => provider.imap_use_tls.to_string(),
            "use_oauth2".to_string() => use_oauth2.to_string(),
            // Raised from melib's 16s default - hit real timeout errors at 16s, likely from
            // concurrent connection-pool operations (search fan-out, badge priming) taking longer.
            "timeout".to_string() => "30".to_string(),
            "offline_cache".to_string() => "true".to_string(),
            "use_id".to_string() => "true".to_string(),
        },
    };

    // No-op: this connection is a one-shot login + mailbox-list check, not the long-lived
    // watch_stream connection elsewhere that actually processes events.
    let event_consumer = BackendEventConsumer::new(Arc::new(|_account_hash, _event| {}));
    let mut imap = ImapType::new(&account_conf, Default::default(), event_consumer)?;

    let online_future = imap
        .is_online()
        .map_err(|err| melib::error::Error::new(format!("Could not start login: {err}")))?;
    if let Err(err) = block_on(online_future) {
        // Branching on err.kind as it's difficult to differentiate between genuine network problem and
        // service (Google) throttling / holding the connection
        let is_real_network_problem = err.kind.is_network_down()
            || matches!(
                err.kind,
                melib::error::ErrorKind::Network(melib::error::NetworkErrorKind::HostLookupFailed)
            );
        if is_real_network_problem {
            return Err(melib::error::Error::new(format!(
                "Could not reach {} ({err}) - this looks like a real network \
                 problem. Check your connection.",
                provider.imap_host
            )));
        }
        return Err(melib::error::Error::new(format!(
            "Reached {}, but login never completed ({err}). This can happen when a provider \
             temporarily holds/throttles connections after repeated attempts in a short window - \
             wait a while before retrying rather than retrying immediately.",
            provider.display_name
        )));
    }

    // Result discarded on success - this call exists only to force a second round-trip after
    // login, so a "logged in but broken" failure surfaces here with a clear error instead of
    // being silently deferred to whatever the next real caller happens to be.
    let mailboxes_future = imap.mailboxes()?;
    if let Err(err) = block_on(mailboxes_future) {
        return Err(melib::error::Error::new(format!(
            "Logged in, but listing mailboxes failed ({err})."
        )));
    }

    Ok(imap)
}

pub fn list_mailbox(
    imap: &mut ImapType,
    mailbox_hash: MailboxHash,
) -> melib::Result<Vec<EnvelopeRow>> {
    let mut stream = imap.fetch(mailbox_hash)?;
    let mut envelopes: Vec<Envelope> = Vec::new();
    while let Some(chunk) = block_on(stream.next()) {
        envelopes.extend(chunk?);
    }
    envelopes.sort_by_key(|e| std::cmp::Reverse(e.date()));

    Ok(envelopes.iter().map(envelope_row).collect())
}

pub fn envelope_row(e: &Envelope) -> EnvelopeRow {
    EnvelopeRow {
        hash: e.hash(),
        subject: e.subject().to_string(),
        from: e
            .from()
            .first()
            .map(|a| a.display_name().to_string())
            .unwrap_or_else(|| "(unknown sender)".to_string()),
        from_address: e.from().first().map(|a| a.get_email().to_string()).unwrap_or_default(),
        to: format_address_list(e.to()),
        cc: format_address_list(e.cc()),
        date: e.date(),
        is_seen: e.is_seen(),
        is_flagged: e.flags().is_flagged(),
        has_attachments: e.has_attachments(),
        message_id: e.message_id().display_brackets().to_string(),
        references: MessageID::display_slice(e.references(), Some(" ")),
    }
}

pub struct MailboxInfo {
    pub hash: MailboxHash,
    pub name: String,
    pub path: String,
    pub unread: usize,
    pub total: usize,
    pub special_usage: String,
    pub parent_hash: Option<MailboxHash>,
}

// Display order for mailbox list
fn special_usage_rank(usage: SpecialUsageMailbox) -> u8 {
    match usage {
        SpecialUsageMailbox::Inbox => 0,
        SpecialUsageMailbox::Sent => 1,
        SpecialUsageMailbox::Drafts => 2,
        SpecialUsageMailbox::Junk => 3,
        SpecialUsageMailbox::Trash => 4,
        SpecialUsageMailbox::Archive => 5,
        SpecialUsageMailbox::Flagged => 6,
        SpecialUsageMailbox::Normal => 9,
    }
}

fn mailbox_infos(mailboxes: &HashMap<MailboxHash, Mailbox>) -> Vec<MailboxInfo> {
    let mut infos: Vec<(u8, MailboxInfo)> = mailboxes
        .iter()
        .map(|(hash, mbox)| {
            let (unseen, exists) = mbox.count().unwrap_or((0, 0));
            (
                special_usage_rank(mbox.special_usage()),
                MailboxInfo {
                    hash: *hash,
                    name: mbox.name().to_string(),
                    path: mbox.path().to_string(),
                    unread: unseen,
                    total: exists,
                    special_usage: mbox.special_usage().to_string(),
                    parent_hash: mbox.parent(),
                },
            )
        })
        .collect();
    infos.sort_by(|(rank_a, a), (rank_b, b)| rank_a.cmp(rank_b).then_with(|| a.name.cmp(&b.name)));
    infos.into_iter().map(|(_, info)| info).collect()
}

pub fn list_mailboxes(imap: &mut ImapType) -> melib::Result<Vec<MailboxInfo>> {
    let mailboxes = block_on(imap.mailboxes()?)?;
    Ok(mailbox_infos(&mailboxes))
}

pub fn refresh_mailboxes(imap: &mut ImapType) -> melib::Result<Vec<MailboxInfo>> {
    // Reaches into melib's internal cache directly (no public API for this) to force the
    // following list_mailboxes() to refetch from the server instead of returning stale data.
    block_on(imap.uid_store.mailboxes.lock()).clear();
    list_mailboxes(imap)
}

pub fn create_mailbox(imap: &mut ImapType, path: String) -> melib::Result<Vec<MailboxInfo>> {
    let (_new_hash, mailboxes) = block_on(imap.create_mailbox(path)?)?;
    Ok(mailbox_infos(&mailboxes))
}

#[derive(Clone, Copy)]
pub enum DeleteMailboxMessages {
    MoveToParent,
    MoveToTrash,
}

// Post-order (children before parent) so a nested mailbox's messages
// get moved out and the mailbox itself deleted before its parent - deleting
// a parent first would orphan any children still sitting on the server.
fn post_order_with_root(
    mailboxes: &HashMap<MailboxHash, Mailbox>,
    root: MailboxHash,
) -> Vec<MailboxHash> {
    let mut children_of: HashMap<MailboxHash, Vec<MailboxHash>> = HashMap::new();
    for (hash, mbox) in mailboxes.iter() {
        if let Some(parent) = mbox.parent() {
            children_of.entry(parent).or_default().push(*hash);
        }
    }
    fn visit(
        children_of: &HashMap<MailboxHash, Vec<MailboxHash>>,
        node: MailboxHash,
        out: &mut Vec<MailboxHash>,
    ) {
        if let Some(children) = children_of.get(&node) {
            for &child in children {
                visit(children_of, child, out);
            }
        }
        out.push(node);
    }
    let mut out = Vec::new();
    visit(&children_of, root, &mut out);
    out
}

pub fn delete_mailbox(
    imap: &mut ImapType,
    mailbox_hash: MailboxHash,
    messages: DeleteMailboxMessages,
) -> melib::Result<Vec<MailboxInfo>> {
    let snapshot = block_on(imap.mailboxes()?)?;
    let target = snapshot
        .get(&mailbox_hash)
        .ok_or_else(|| melib::error::Error::new("This mailbox no longer exists."))?;
    let parent_hash = target.parent();

    let destination = match messages {
        DeleteMailboxMessages::MoveToParent => parent_hash.unwrap_or_else(|| {
            // Deleting a top-level mailbox with no parent falls back to Inbox. Panics rather
            // than erroring if the account genuinely has none - not guaranteed by melib's types,
            // but true for every real IMAP account.
            snapshot
                .iter()
                .find(|(_, m)| m.special_usage() == SpecialUsageMailbox::Inbox)
                .map(|(hash, _)| *hash)
                .expect("account must have an Inbox")
        }),
        DeleteMailboxMessages::MoveToTrash => snapshot
            .iter()
            .find(|(_, m)| m.special_usage() == SpecialUsageMailbox::Trash)
            .map(|(hash, _)| *hash)
            .ok_or_else(|| melib::error::Error::new("Could not find a Trash mailbox"))?,
    };

    let order = post_order_with_root(&snapshot, mailbox_hash);

    // We have two seperate loops here deliberately
    // First loop moves every message out of the mailbox into the
    // destination (either Trash or parent)
    // Second loop which only starts after the first has completed
    // actually commits to the deletion of the mailbox
    for &hash in &order {
        let rows = list_mailbox(imap, hash)?;
        if rows.is_empty() {
            continue;
        }
        let hashes: Vec<melib::email::EnvelopeHash> = rows.iter().map(|r| r.hash).collect();
        let batch =
            EnvelopeHashBatch::try_from(hashes.as_slice()).expect("just checked non-empty above");
        block_on(imap.copy_messages(batch, hash, destination, /* move */ true)?)?;
    }

    for &hash in &order {
        let current = block_on(imap.mailboxes()?)?;
        if !current.contains_key(&hash) {
            continue;
        }
        block_on(imap.delete_mailbox(hash)?)?;
    }

    let mailboxes = block_on(imap.mailboxes()?)?;
    Ok(mailbox_infos(&mailboxes))
}

pub fn watch_stream(imap: &mut ImapType) -> ResultStream<BackendEvent> {
    imap.watch()
}

pub fn watch_inbox_for_new_mail(
    email: &str,
    provider: &crate::providers::ProviderConfig,
    on_new_mail: impl Fn(&Envelope),
    on_mailbox_changed: impl Fn(),
) -> melib::Result<()> {
    let mut imap = connect(email, provider)?;
    let inbox_hash = list_mailboxes(&mut imap)?
        .into_iter()
        .find(|m| m.special_usage == "Inbox")
        .map(|m| m.hash)
        .ok_or_else(|| melib::error::Error::new("no Inbox mailbox found"))?;
    let mut known_hashes: std::collections::HashSet<_> = list_mailbox(&mut imap, inbox_hash)?
        .into_iter()
        .map(|row| row.hash)
        .collect();

    let mut stream = watch_stream(&mut imap)?;
    while let Some(event) = block_on(stream.next()) {
        let refresh_events = match event? {
            BackendEvent::Refresh(e) => vec![e],
            BackendEvent::RefreshBatch(events) => events,
            _ => continue,
        };
        for refresh in refresh_events {
            if refresh.mailbox_hash != inbox_hash {
                continue;
            }
            match refresh.kind {
                RefreshEventKind::Create(envelope) => {
                    // Servers can resend a Create for the same message across reconnects/IDLE
                    // re-syncs - skip already-seen envelopes to avoid duplicate notifications.
                    if !known_hashes.insert(envelope.hash()) {
                        continue;
                    }
                    on_new_mail(&envelope);
                }
                RefreshEventKind::Remove(_)
                | RefreshEventKind::NewFlags(_, _)
                | RefreshEventKind::Update(_, _)
                | RefreshEventKind::Rescan => on_mailbox_changed(),
                // Deliberately ignored - only mailbox-changed-shaped events matter to this watcher.
                _ => {}
            }
        }
    }
    Ok(())
}

pub struct AttachmentInfo {
    pub index: usize,
    pub filename: String,
    pub mime_type: String,
    pub size: usize,
}

pub struct BodyResult {
    pub body: String,
    pub is_html: bool,
    pub attachments: Vec<AttachmentInfo>,
    pub from: String,
    pub to: Vec<String>,
    pub cc: Vec<String>,
    pub reply_to: String,
    pub subject: String,
    pub date: u64,
    pub message_id: String,
    pub references: String,
}

fn format_address_list(addrs: &[Address]) -> Vec<String> {
    addrs.iter().map(|a| a.to_string()).collect()
}

// Exclude the body and any 'container' MIMES leaving only the 'true' attachments
fn real_attachments(body: &melib::email::Attachment) -> Vec<melib::email::Attachment> {
    use melib::email::attachment_types::ContentType;
    body.attachments()
        .into_iter()
        .filter(|a| {
            !matches!(
                a.content_type(),
                ContentType::Multipart { .. }
                    | ContentType::Text { .. }
                    | ContentType::PGPSignature
                    | ContentType::CMSSignature
            )
        })
        .collect()
}

fn attachment_filename(att: &melib::email::Attachment, index: usize) -> String {
    if let Some(name) = att.content_disposition.filename.clone() {
        return name;
    }
    if let Some(name) = att.content_type().name() {
        return name.to_string();
    }
    format!("attachment-{index}")
}

fn attachment_infos(body: &melib::email::Attachment) -> Vec<AttachmentInfo> {
    real_attachments(body)
        .into_iter()
        .enumerate()
        .map(|(index, a)| AttachmentInfo {
            filename: attachment_filename(&a, index),
            mime_type: a.mime_type(),
            // Decoded size, not the raw (possibly base64-inflated) part
            // size - what a "Save As" dialog will actually write to disk.
            size: a.decode(Default::default()).len(),
            index,
        })
        .collect()
}

/// `mailbox_hash` lets us recover when the connection servicing this call
/// (any of the pool's connections may pick it up) has never itself fetched
/// the message's real mailbox - melib's `hash_index` is populated per
/// connection instance, only as a side effect of a real FETCH (not just
/// SELECT/EXAMINE), so a connection that has only ever touched a different
/// mailbox genuinely has no idea this hash exists yet and returns "Message
/// not found in local cache" - not a data problem, just a warm-up gap. Hit
/// this for real opening a foreign-mailbox message surfaced via thread
/// view. If we know which mailbox the hash belongs to, do one real listing
/// of it to populate this connection's hash_index, then retry once.
pub fn fetch_body(
    imap: &mut ImapType,
    hash: melib::email::EnvelopeHash,
    mailbox_hash: Option<MailboxHash>,
) -> melib::Result<BodyResult> {
    let bytes = match imap.envelope_bytes_by_hash(hash) {
        Ok(future) => block_on(future)?,
        Err(err) => {
            let Some(mailbox_hash) = mailbox_hash else {
                return Err(err);
            };
            list_mailbox(imap, mailbox_hash)?;
            block_on(imap.envelope_bytes_by_hash(hash)?)?
        }
    };
    let envelope = Envelope::from_bytes(&bytes, None)?;
    let attachment = envelope.body_bytes(&bytes);
    let attachments = attachment_infos(&attachment);

    let from = envelope
        .from()
        .first()
        .map(|a| a.to_string())
        .unwrap_or_default();
    let to = format_address_list(envelope.to());
    let cc = format_address_list(envelope.cc());
    let reply_to = envelope
        .other_headers()
        .get("Reply-To")
        .unwrap_or("")
        .to_string();
    let subject = envelope.subject().to_string();
    let date = envelope.date();
    let message_id = envelope.message_id().display_brackets().to_string();
    let references = MessageID::display_slice(envelope.references(), Some(" "));

    // Decision made here to favour HTML over raw text based as this is often
    // what the Sender intends, plain text shown only when there is no HTML version at all
    let html = attachment.text(Text::Html);
    let (body, is_html) = if !html.trim().is_empty() {
        (html, true)
    } else {
        let plain = attachment.text(Text::Plain);
        if !plain.trim().is_empty() {
            (plain, false)
        } else {
            (String::from("(no readable body)"), false)
        }
    };

    Ok(BodyResult {
        body,
        is_html,
        attachments,
        from,
        to,
        cc,
        reply_to,
        subject,
        date,
        message_id,
        references,
    })
}

pub fn fetch_attachment(
    imap: &mut ImapType,
    hash: melib::email::EnvelopeHash,
    index: usize,
) -> melib::Result<(String, String, Vec<u8>)> {
    let bytes = block_on(imap.envelope_bytes_by_hash(hash)?)?;
    let envelope = Envelope::from_bytes(&bytes, None)?;
    let body = envelope.body_bytes(&bytes);
    let attachments = real_attachments(&body);
    let att = attachments
        .get(index)
        .ok_or_else(|| melib::error::Error::new("Attachment index out of range"))?;
    let filename = attachment_filename(att, index);
    let mime_type = att.mime_type();
    Ok((filename, mime_type, att.decode(Default::default())))
}

pub fn save_draft(imap: &mut ImapType, raw: Vec<u8>) -> melib::Result<()> {
    let mailboxes = block_on(imap.mailboxes()?)?;
    let drafts_hash = mailboxes
        .iter()
        .find(|(_, mbox)| mbox.special_usage() == SpecialUsageMailbox::Drafts)
        .map(|(hash, _)| *hash)
        .ok_or_else(|| melib::error::Error::new("Could not find a Drafts mailbox"))?;
    block_on(imap.save(raw, drafts_hash, Some(melib::email::Flag::DRAFT))?)
}

pub fn delete_message(
    imap: &mut ImapType,
    hash: melib::email::EnvelopeHash,
    source_mailbox_hash: MailboxHash,
) -> melib::Result<()> {
    let mailboxes = block_on(imap.mailboxes()?)?;
    let trash_hash = mailboxes
        .iter()
        .find(|(_, mbox)| mbox.special_usage() == SpecialUsageMailbox::Trash)
        .map(|(hash, _)| *hash)
        .ok_or_else(|| melib::error::Error::new("Could not find a Trash mailbox"))?;
    if source_mailbox_hash == trash_hash {
        return Err(melib::error::Error::new(
            "This message is already in Trash.",
        ));
    }

    let batch = EnvelopeHashBatch::from(hash);
    block_on(imap.copy_messages(batch, source_mailbox_hash, trash_hash, /* move */ true)?)
}

pub fn move_message(
    imap: &mut ImapType,
    hash: melib::email::EnvelopeHash,
    source_mailbox_hash: MailboxHash,
    destination_mailbox_hash: MailboxHash,
) -> melib::Result<()> {
    if source_mailbox_hash == destination_mailbox_hash {
        return Err(melib::error::Error::new(
            "This message is already in that folder.",
        ));
    }
    let batch = EnvelopeHashBatch::from(hash);
    block_on(imap.copy_messages(batch, source_mailbox_hash, destination_mailbox_hash, /* move */ true)?)
}

pub fn set_flag(
    imap: &mut ImapType,
    hash: melib::email::EnvelopeHash,
    mailbox_hash: MailboxHash,
    flag: melib::email::Flag,
    value: bool,
) -> melib::Result<()> {
    let batch = EnvelopeHashBatch::from(hash);
    let op = if value {
        FlagOp::Set(flag)
    } else {
        FlagOp::UnSet(flag)
    };
    block_on(imap.set_flags(batch, mailbox_hash, vec![op])?)
}

pub fn mark_all_seen(imap: &mut ImapType, mailbox_hash: MailboxHash) -> melib::Result<()> {
    let rows = list_mailbox(imap, mailbox_hash)?;
    let hashes: Vec<melib::email::EnvelopeHash> =
        rows.iter().filter(|r| !r.is_seen).map(|r| r.hash).collect();
    let Ok(batch) = EnvelopeHashBatch::try_from(hashes.as_slice()) else {
        // Empty batch (nothing unread) - nothing to do, not an error.
        return Ok(());
    };
    block_on(imap.set_flags(
        batch,
        mailbox_hash,
        vec![FlagOp::Set(melib::email::Flag::SEEN)],
    )?)
}

pub fn delete_all_messages(imap: &mut ImapType, mailbox_hash: MailboxHash) -> melib::Result<()> {
    let rows = list_mailbox(imap, mailbox_hash)?;
    let hashes: Vec<melib::email::EnvelopeHash> = rows.iter().map(|r| r.hash).collect();
    let Ok(batch) = EnvelopeHashBatch::try_from(hashes.as_slice()) else {
        return Ok(());
    };
    block_on(imap.delete_messages(batch, mailbox_hash)?)
}
