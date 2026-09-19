use crate::providers::ProviderConfig;
use serde::{Deserialize, Serialize};
use tauri::Manager;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AccountProvider {
    Builtin { id: String },
    Manual(ProviderConfig),
}

impl AccountProvider {
    pub fn resolve(&self) -> melib::Result<ProviderConfig> {
        match self {
            AccountProvider::Builtin { id } => crate::providers::by_id(id).ok_or_else(|| {
                melib::error::Error::new(format!("Unknown provider id {id:?}"))
            }),
            AccountProvider::Manual(cfg) => Ok(cfg.clone()),
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AccountRecord {
    pub email: String,
    pub display_name: Option<String>,
    pub provider: AccountProvider,
    // #[serde(default)] on both so an existing accounts.json written before
    // signatures existed still loads cleanly instead of failing to parse.
    #[serde(default)]
    pub signature_html: Option<String>,
    #[serde(default)]
    pub signature_on_replies: bool,
}

#[derive(Default, Serialize, Deserialize)]
struct AccountsFile {
    accounts: Vec<AccountRecord>,
}

fn registry_path(app: &tauri::AppHandle) -> melib::Result<std::path::PathBuf> {
    let dir = app.path().app_data_dir().map_err(|e| {
        melib::error::Error::new(format!("Could not resolve app data directory: {e}"))
    })?;
    std::fs::create_dir_all(&dir).map_err(|e| {
        melib::error::Error::new(format!("Could not create app data directory: {e}"))
    })?;
    Ok(dir.join("accounts.json"))
}

pub fn load(app: &tauri::AppHandle) -> melib::Result<Vec<AccountRecord>> {
    let path = registry_path(app)?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let contents = std::fs::read_to_string(&path)
        .map_err(|e| melib::error::Error::new(format!("Could not read {}: {e}", path.display())))?;
    let file: AccountsFile = serde_json::from_str(&contents).map_err(|e| {
        melib::error::Error::new(format!("Could not parse {}: {e}", path.display()))
    })?;
    Ok(file.accounts)
}

fn save(app: &tauri::AppHandle, accounts: &[AccountRecord]) -> melib::Result<()> {
    let path = registry_path(app)?;
    let file = AccountsFile {
        accounts: accounts.to_vec(),
    };
    let contents = serde_json::to_string_pretty(&file).map_err(|e| {
        melib::error::Error::new(format!("Could not serialise account registry: {e}"))
    })?;
    std::fs::write(&path, contents)
        .map_err(|e| melib::error::Error::new(format!("Could not write {}: {e}", path.display())))
}

pub fn add(app: &tauri::AppHandle, email: &str, provider: AccountProvider) -> melib::Result<()> {
    let mut accounts = load(app)?;
    if let Some(existing) = accounts.iter_mut().find(|a| a.email == email) {
        existing.provider = provider;
        return save(app, &accounts);
    }
    accounts.push(AccountRecord {
        email: email.to_string(),
        display_name: None,
        provider,
        signature_html: None,
        signature_on_replies: false,
    });
    save(app, &accounts)
}

pub fn update_signature(
    app: &tauri::AppHandle,
    email: &str,
    signature_html: Option<String>,
    signature_on_replies: bool,
) -> melib::Result<()> {
    let mut accounts = load(app)?;
    let account = accounts
        .iter_mut()
        .find(|a| a.email == email)
        .ok_or_else(|| melib::error::Error::new(format!("No account {email}")))?;
    account.signature_html = signature_html;
    account.signature_on_replies = signature_on_replies;
    save(app, &accounts)
}

pub fn remove(app: &tauri::AppHandle, email: &str) -> melib::Result<()> {
    let mut accounts = load(app)?;
    accounts.retain(|a| a.email != email);
    save(app, &accounts)
}
