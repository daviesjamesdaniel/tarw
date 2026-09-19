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

struct InlineImage {
    cid: String,
    mime_type: String,
    bytes: Vec<u8>,
}

/// Swaps each `src="data:image/...;base64,..."` in the HTML for a `cid:` reference and
/// returns the decoded images to attach as inline parts. Mail clients (Gmail, Outlook) block
/// or drop `data:` images, whereas CID-referenced inline parts display reliably.
fn extract_inline_images(html: &str) -> (String, Vec<InlineImage>) {
    const START: &str = "src=\"data:image/";
    let mut out = String::with_capacity(html.len());
    let mut images: Vec<InlineImage> = Vec::new();
    let mut seen: Vec<(String, usize)> = Vec::new();
    let mut rest = html;
    while let Some(pos) = rest.find(START) {
        out.push_str(&rest[..pos]);
        let after = &rest[pos + "src=\"".len()..];
        let Some(end) = after.find('"') else {
            out.push_str(&rest[pos..]);
            rest = "";
            break;
        };
        let uri = &after[..end];
        let decoded = uri
            .strip_prefix("data:")
            .and_then(|u| u.split_once(";base64,"))
            .and_then(|(mime, data)| {
                base64::engine::general_purpose::STANDARD
                    .decode(data)
                    .ok()
                    .map(|bytes| (mime.to_string(), bytes))
            });
        match decoded {
            Some((mime_type, bytes)) => {
                let index = match seen.iter().find(|(u, _)| u == uri) {
                    Some((_, i)) => *i,
                    None => {
                        let i = images.len();
                        images.push(InlineImage {
                            cid: format!("img{}.{}@tarw.local", i + 1, std::process::id()),
                            mime_type,
                            bytes,
                        });
                        seen.push((uri.to_string(), i));
                        i
                    }
                };
                out.push_str(&format!("src=\"cid:{}\"", images[index].cid));
            }
            None => out.push_str(&rest[pos..pos + "src=\"".len() + end + 1]),
        }
        rest = &after[end + 1..];
    }
    out.push_str(rest);
    (out, images)
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
    // Drafts keep data: URIs so reopening one still shows the images; only what
    // actually goes out over SMTP gets converted to inline CID parts.
    let (body_html, inline_images) = if include_bcc_header {
        (msg.body_html.clone(), Vec::new())
    } else {
        extract_inline_images(&msg.body_html)
    };
    let html_part = if inline_images.is_empty() {
        format!(
            "Content-Type: text/html; charset=utf-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n{body_html}"
        )
    } else {
        let rel_boundary = generate_boundary();
        let mut part = format!(
            "Content-Type: multipart/related; type=\"text/html\"; boundary=\"{rel_boundary}\"\r\n\r\n\
             --{rel_boundary}\r\n\
             Content-Type: text/html; charset=utf-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n\
             {body_html}\r\n"
        );
        for img in &inline_images {
            part += &format!(
                "--{rel_boundary}\r\n\
                 Content-Type: {}\r\n\
                 Content-Transfer-Encoding: base64\r\n\
                 Content-ID: <{}>\r\n\
                 Content-Disposition: inline\r\n\r\n\
                 {}\r\n",
                img.mime_type,
                img.cid,
                base64_wrapped(&img.bytes),
            );
        }
        part += &format!("--{rel_boundary}--");
        part
    };
    let alt_part = format!(
        "--{alt_boundary}\r\n\
         Content-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n\
         {}\r\n\
         --{alt_boundary}\r\n\
         {html_part}\r\n\
         --{alt_boundary}--\r\n",
        msg.body_text,
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

#[cfg(test)]
mod tests {
    use super::*;

    fn message(html: &str) -> OutgoingMessage {
        OutgoingMessage {
            to: "a@example.com".into(),
            cc: String::new(),
            bcc: String::new(),
            subject: "s".into(),
            body_html: html.into(),
            body_text: "t".into(),
            in_reply_to: String::new(),
            references: String::new(),
            attachments: Vec::new(),
        }
    }

    const PNG: &str = "iVBORw0KGgo=";

    #[test]
    fn data_uris_become_inline_cid_parts_when_sending() {
        let html = format!(
            "<p>hi</p><img src=\"data:image/png;base64,{PNG}\" width=\"100\"><img src=\"data:image/png;base64,{PNG}\">"
        );
        let raw = build_raw(&message(&html), "me@example.com", false);
        assert!(raw.contains("multipart/related"));
        assert!(!raw.contains("data:image"));
        assert_eq!(raw.matches("Content-ID:").count(), 1, "identical images share one part");
        assert_eq!(raw.matches("src=\"cid:").count(), 2);
        assert!(raw.contains("Content-Type: image/png"));
    }

    #[test]
    fn drafts_keep_data_uris() {
        let html = format!("<img src=\"data:image/png;base64,{PNG}\">");
        let raw = build_raw(&message(&html), "me@example.com", true);
        assert!(raw.contains("data:image/png;base64,"));
        assert!(!raw.contains("multipart/related"));
    }

    #[test]
    fn undecodable_data_uri_is_left_alone() {
        let html = "<img src=\"data:image/png;base64,!!!not-base64!!!\">";
        let (out, images) = extract_inline_images(html);
        assert_eq!(out, html);
        assert!(images.is_empty());
    }
}
