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
            AccountProvider::Builtin { id } => crate::providers::by_id(id)
                .ok_or_else(|| melib::error::Error::new(format!("Unknown provider id {id:?}"))),
            AccountProvider::Manual(cfg) => Ok(cfg.clone()),
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Signature {
    pub id: String,
    pub name: String,
    pub html: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AccountRecord {
    pub email: String,
    pub display_name: Option<String>,
    pub provider: AccountProvider,
    // #[serde(default)] on all of these so an accounts.json written before
    // signatures existed still loads cleanly instead of failing to parse.
    #[serde(default)]
    pub signatures: Vec<Signature>,
    #[serde(default)]
    pub default_signature_id: Option<String>,
    #[serde(default)]
    pub signature_on_replies: bool,
    // The pre-multiple-signatures single signature. Read once so old data can
    // be migrated in load(), never written back.
    #[serde(default, skip_serializing)]
    signature_html: Option<String>,
}

impl AccountRecord {
    pub fn new(email: String, display_name: Option<String>, provider: AccountProvider) -> Self {
        Self {
            email,
            display_name,
            provider,
            signatures: Vec::new(),
            default_signature_id: None,
            signature_on_replies: false,
            signature_html: None,
        }
    }

    fn migrate_legacy_signature(&mut self) {
        if let Some(html) = self.signature_html.take() {
            if self.signatures.is_empty() && !html.trim().is_empty() {
                self.signatures.push(Signature {
                    id: "default".to_string(),
                    name: "Default".to_string(),
                    html,
                });
                self.default_signature_id = Some("default".to_string());
            }
        }
    }
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
    let mut accounts = file.accounts;
    for account in &mut accounts {
        account.migrate_legacy_signature();
    }
    Ok(accounts)
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
    accounts.push(AccountRecord::new(email.to_string(), None, provider));
    save(app, &accounts)
}

pub fn update_signatures(
    app: &tauri::AppHandle,
    email: &str,
    signatures: Vec<Signature>,
    default_signature_id: Option<String>,
    signature_on_replies: bool,
) -> melib::Result<()> {
    let mut accounts = load(app)?;
    let account = accounts
        .iter_mut()
        .find(|a| a.email == email)
        .ok_or_else(|| melib::error::Error::new(format!("No account {email}")))?;
    let known = |id: &Option<String>| {
        id.clone()
            .filter(|id| signatures.iter().any(|s| &s.id == id))
    };
    account.default_signature_id = known(&default_signature_id);
    account.signature_on_replies = signature_on_replies;
    account.signatures = signatures;
    save(app, &accounts)
}

pub fn remove(app: &tauri::AppHandle, email: &str) -> melib::Result<()> {
    let mut accounts = load(app)?;
    accounts.retain(|a| a.email != email);
    save(app, &accounts)
}
