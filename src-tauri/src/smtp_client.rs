use base64::Engine;
use melib::smol::block_on;
use melib::smtp::{SmtpAuth, SmtpConnection, SmtpSecurity, SmtpServerConf};
use melib::utils::datetime;

pub struct OutgoingAttachment {
    pub filename: String,
    pub mime_type: String,
    pub bytes: Vec<u8>,
}

pub struct OutgoingMessage {
    pub to: String,
    pub cc: String,
    pub bcc: String,
    pub subject: String,
    pub body_html: String,
    pub body_text: String,
    pub in_reply_to: String,
    pub references: String,
    pub attachments: Vec<OutgoingAttachment>,
}

fn format_date_header() -> String {
    datetime::timestamp_to_string(datetime::now(), Some(datetime::formats::RFC822_DATE), false)
}

fn generate_message_id(domain: &str) -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("<{}.{}@{}>", std::process::id(), nanos, domain)
}

fn generate_boundary() -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("mime-boundary-{}-{}", std::process::id(), nanos)
}

fn base64_wrapped(bytes: &[u8]) -> String {
    let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
    encoded
        .as_bytes()
        .chunks(76)
        .map(|chunk| std::str::from_utf8(chunk).expect("base64 output is always ASCII"))
        .collect::<Vec<_>>()
        .join("\r\n")
}

/// `include_bcc_header` should be true when saving a draft (so reopening it still shows who was
/// Bcc'd) and false when actually sending over SMTP (recipients must never see the Bcc header -
/// they're addressed separately via the envelope recipient list instead).
pub fn build_raw(msg: &OutgoingMessage, account: &str, include_bcc_header: bool) -> String {
    let mut raw = format!("From: {account}\r\nTo: {}\r\n", msg.to.trim());
    if !msg.cc.trim().is_empty() {
        raw += &format!("Cc: {}\r\n", msg.cc.trim());
    }
    if include_bcc_header && !msg.bcc.trim().is_empty() {
        raw += &format!("Bcc: {}\r\n", msg.bcc.trim());
    }
    if !msg.in_reply_to.trim().is_empty() {
        raw += &format!("In-Reply-To: {}\r\n", msg.in_reply_to.trim());
    }
    if !msg.references.trim().is_empty() {
        raw += &format!("References: {}\r\n", msg.references.trim());
    }
    let alt_boundary = generate_boundary();
    let alt_part = format!(
        "--{alt_boundary}\r\n\
         Content-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n\
         {}\r\n\
         --{alt_boundary}\r\n\
         Content-Type: text/html; charset=utf-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n\
         {}\r\n\
         --{alt_boundary}--\r\n",
        msg.body_text, msg.body_html,
    );

    let headers = format!(
        "Subject: {}\r\nDate: {}\r\nMessage-Id: {}\r\nMIME-Version: 1.0\r\n",
        msg.subject,
        format_date_header(),
        generate_message_id("tarw.local"),
    );

    if msg.attachments.is_empty() {
        raw += &headers;
        raw += &format!(
            "Content-Type: multipart/alternative; boundary=\"{alt_boundary}\"\r\n\r\n{alt_part}"
        );
    } else {
        let mixed_boundary = generate_boundary();
        raw += &headers;
        raw += &format!(
            "Content-Type: multipart/mixed; boundary=\"{mixed_boundary}\"\r\n\r\n\
             --{mixed_boundary}\r\n\
             Content-Type: multipart/alternative; boundary=\"{alt_boundary}\"\r\n\r\n{alt_part}\r\n",
        );
        for att in &msg.attachments {
            let safe_name = att.filename.replace('"', "");
            let mime_type = if att.mime_type.trim().is_empty() {
                "application/octet-stream"
            } else {
                &att.mime_type
            };
            raw += &format!(
                "--{mixed_boundary}\r\n\
                 Content-Type: {mime_type}; name=\"{safe_name}\"\r\n\
                 Content-Disposition: attachment; filename=\"{safe_name}\"\r\n\
                 Content-Transfer-Encoding: base64\r\n\r\n\
                 {}\r\n",
                base64_wrapped(&att.bytes),
            );
        }
        raw += &format!("--{mixed_boundary}--\r\n");
    }
    raw
}

pub fn send(
    msg: OutgoingMessage,
    account: &str,
    provider: &crate::providers::ProviderConfig,
) -> melib::Result<()> {
    use crate::providers::AuthMethod;
    let auth = match provider.auth_method {
        AuthMethod::OAuth2 => {
            let secret = crate::oauth::get_xoauth2_password(account, provider)?;
            SmtpAuth::XOAuth2 {
                token: melib::conf::Secret::Value(secret),
                require_auth: true,
            }
        }
        AuthMethod::Password => {
            let secret = crate::password_auth::get_password(account)?;
            SmtpAuth::Auto {
                username: melib::conf::Secret::Value(account.to_string()),
                password: melib::conf::Secret::Value(secret),
                require_auth: true,
                auth_type: Default::default(),
            }
        }
    };

    let server_conf = SmtpServerConf {
        hostname: melib::conf::Secret::Value(provider.smtp_host.clone()),
        port: provider.smtp_port,
        envelope_from: account.to_string(),
        auth,
        security: match provider.smtp_security {
            crate::providers::SmtpSecurityKind::StartTls => SmtpSecurity::StartTLS {
                danger_accept_invalid_certs: false,
            },
            crate::providers::SmtpSecurityKind::Tls => SmtpSecurity::Tls {
                danger_accept_invalid_certs: false,
            },
        },
        extensions: Default::default(),
    };

    let raw = build_raw(&msg, account, false);

    let envelope = melib::Envelope::from_bytes(raw.as_bytes(), None)?;
    let mut recipients = envelope.to().to_vec();
    if !msg.bcc.trim().is_empty() {
        // Throwaway single-header envelope, just to reuse melib's RFC address-list parser on
        // msg.bcc instead of hand-rolling one.
        let shadow = format!("Bcc: {}\r\n\r\n", msg.bcc.trim());
        let shadow_envelope = melib::Envelope::from_bytes(shadow.as_bytes(), None)?;
        recipients.extend(shadow_envelope.bcc().iter().cloned());
    }

    block_on(async {
        let mut conn = SmtpConnection::new_connection(server_conf).await?;
        conn.mail_transaction(&raw, Some(&recipients)).await?;
        conn.quit().await
    })
}
