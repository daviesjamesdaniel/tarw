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
    pub client_id: String,
    // None for a public-client (PKCE-only) flow - Microsoft's consumer OAuth2
    // endpoint doesn't want one at all, unlike Google's.
    pub client_secret: Option<String>,
}

pub const GMAIL_PROVIDER_ID: &str = "gmail";
pub const OUTLOOK_PROVIDER_ID: &str = "outlook";

// Reuses Mozilla Thunderbird's own published OAuth2 client id rather than
// registering a Tarw-owned Azure app - Microsoft's per-provider app
// registration process is a real, well-documented pain for small FOSS
// projects (this is a widely used pattern precisely for that reason: the
// client id is public in Thunderbird's own open-source repo, and native/
// desktop OAuth clients can't keep a secret confidential anyway, same
// reasoning as GOOGLE_OAUTH_CLIENT_ID/SECRET below). No client secret is
// used - this is a public client authenticating via PKCE only.
const THUNDERBIRD_MS_OAUTH_CLIENT_ID: &str = "9e5f94bc-e8a4-4e73-b8be-63364c29d753";

// This "Desktop app" OAuth client belongs to the Tarw project itself, so every install can sign
// in to Gmail without each user having to register their own Google Cloud OAuth client. The
// secret below isn't actually confidential for this client type - Google's own OAuth docs treat
// installed-app client secrets as non-secret, since an installed app can't keep one anyway - so
// this being visible in a public repo is expected, not a leaked credential.
const GOOGLE_OAUTH_CLIENT_ID: &str =
    "390467409611-3h1o42vtndeqafvvjmm89j6ujsemiuuv.apps.googleusercontent.com";
const GOOGLE_OAUTH_CLIENT_SECRET: &str = "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";

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
                client_id: GOOGLE_OAUTH_CLIENT_ID.to_string(),
                client_secret: Some(GOOGLE_OAUTH_CLIENT_SECRET.to_string()),
            }),
        },
        ProviderConfig {
            id: OUTLOOK_PROVIDER_ID.to_string(),
            display_name: "Outlook".to_string(),
            imap_host: "outlook.office365.com".to_string(),
            imap_port: 993,
            imap_use_tls: true,
            smtp_host: "smtp.office365.com".to_string(),
            smtp_port: 587,
            smtp_security: SmtpSecurityKind::StartTls,
            auth_method: AuthMethod::OAuth2,
            oauth: Some(OAuthProviderConfig {
                // /consumers/ - personal Outlook.com/Hotmail accounts only,
                // not work/school (Microsoft 365) accounts, which would need
                // /organizations/ or /common/ and a different consent story.
                auth_url: "https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize"
                    .to_string(),
                token_url: "https://login.microsoftonline.com/consumers/oauth2/v2.0/token"
                    .to_string(),
                scope: "openid offline_access https://outlook.office.com/IMAP.AccessAsUser.All"
                    .to_string(),
                client_id: THUNDERBIRD_MS_OAUTH_CLIENT_ID.to_string(),
                client_secret: None,
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
        ("outlook.com", OUTLOOK_PROVIDER_ID),
        ("hotmail.com", OUTLOOK_PROVIDER_ID),
        ("hotmail.co.uk", OUTLOOK_PROVIDER_ID),
        ("live.com", OUTLOOK_PROVIDER_ID),
        ("msn.com", OUTLOOK_PROVIDER_ID),
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
