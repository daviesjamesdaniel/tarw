use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AuthMethod {
    OAuth2,
    Password,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SmtpSecurityKind {
    StartTls,
    Tls,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ProviderConfig {
    pub id: String,
    pub display_name: String,
    pub imap_host: String,
    pub imap_port: u16,
    pub imap_use_tls: bool,
    pub smtp_host: String,
    pub smtp_port: u16,
    pub smtp_security: SmtpSecurityKind,
    pub auth_method: AuthMethod,
    pub oauth: Option<OAuthProviderConfig>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct OAuthProviderConfig {
    pub auth_url: String,
    pub token_url: String,
    pub scope: String,
    pub client_id_env: String,
    pub client_secret_env: String,
}

pub const GMAIL_PROVIDER_ID: &str = "gmail";

fn builtin_providers() -> Vec<ProviderConfig> {
    vec![
        ProviderConfig {
            id: GMAIL_PROVIDER_ID.to_string(),
            display_name: "Gmail".to_string(),
            imap_host: "imap.gmail.com".to_string(),
            imap_port: 993,
            imap_use_tls: true,
            smtp_host: "smtp.gmail.com".to_string(),
            smtp_port: 587,
            smtp_security: SmtpSecurityKind::StartTls,
            auth_method: AuthMethod::OAuth2,
            oauth: Some(OAuthProviderConfig {
                auth_url: "https://accounts.google.com/o/oauth2/v2/auth".to_string(),
                token_url: "https://oauth2.googleapis.com/token".to_string(),
                scope: "https://mail.google.com/".to_string(),
                client_id_env: "GOOGLE_OAUTH_CLIENT_ID".to_string(),
                client_secret_env: "GOOGLE_OAUTH_CLIENT_SECRET".to_string(),
            }),
        },
        ProviderConfig {
            id: "fastmail".to_string(),
            display_name: "Fastmail".to_string(),
            imap_host: "imap.fastmail.com".to_string(),
            imap_port: 993,
            imap_use_tls: true,
            smtp_host: "smtp.fastmail.com".to_string(),
            smtp_port: 587,
            smtp_security: SmtpSecurityKind::StartTls,
            auth_method: AuthMethod::Password,
            oauth: None,
        },
        ProviderConfig {
            id: "icloud".to_string(),
            display_name: "iCloud Mail".to_string(),
            imap_host: "imap.mail.me.com".to_string(),
            imap_port: 993,
            imap_use_tls: true,
            smtp_host: "smtp.mail.me.com".to_string(),
            smtp_port: 587,
            smtp_security: SmtpSecurityKind::StartTls,
            auth_method: AuthMethod::Password,
            oauth: None,
        },
    ]
}

pub fn by_id(id: &str) -> Option<ProviderConfig> {
    builtin_providers().into_iter().find(|p| p.id == id)
}

fn domain_table() -> &'static [(&'static str, &'static str)] {
    &[
        ("gmail.com", GMAIL_PROVIDER_ID),
        ("googlemail.com", GMAIL_PROVIDER_ID),
        ("fastmail.com", "fastmail"),
        ("fastmail.fm", "fastmail"),
        ("icloud.com", "icloud"),
        ("me.com", "icloud"),
        ("mac.com", "icloud"),
    ]
}

pub fn detect_from_email(email: &str) -> Option<ProviderConfig> {
    let domain = email.rsplit('@').next()?.to_lowercase();
    domain_table()
        .iter()
        .find(|(d, _)| *d == domain)
        .and_then(|(_, id)| by_id(id))
}
