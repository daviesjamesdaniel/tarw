use base64::Engine;
use keyring::Entry;
use oauth2::basic::BasicClient;
use oauth2::{
    reqwest, AuthUrl, AuthorizationCode, ClientId, ClientSecret, CsrfToken, PkceCodeChallenge,
    PkceCodeVerifier, RedirectUrl, RefreshToken, Scope, TokenResponse, TokenUrl,
};
use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

use crate::providers::OAuthProviderConfig;

const KEYRING_SERVICE: &str = "tarw";

fn pending_logins() -> &'static Mutex<std::collections::HashMap<String, Arc<AtomicBool>>> {
    static PENDING: OnceLock<Mutex<std::collections::HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();
    PENDING.get_or_init(Default::default)
}

pub fn cancel_login(email: &str) {
    if let Some(flag) = pending_logins().lock().unwrap().get(email) {
        flag.store(true, Ordering::Relaxed);
    }
}

struct PendingLoginGuard(String);
impl Drop for PendingLoginGuard {
    fn drop(&mut self) {
        pending_logins().lock().unwrap().remove(&self.0);
    }
}

fn err(msg: impl Into<String>) -> melib::error::Error {
    melib::error::Error::new(msg.into())
}

fn http_client() -> melib::Result<reqwest::blocking::Client> {
    reqwest::blocking::ClientBuilder::new()
        // Never follow redirects on a token/auth exchange - a malicious/compromised auth server
        // could otherwise redirect the request (carrying the code/token) to an arbitrary URL.
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| err(format!("Could not build HTTP client: {e}")))
}

fn keyring_entry(email: &str) -> melib::Result<Entry> {
    Entry::new(KEYRING_SERVICE, email)
        .map_err(|e| err(format!("Could not open the system keyring: {e}")))
}

pub fn forget_credentials(email: &str) -> melib::Result<()> {
    let entry = keyring_entry(email)?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(err(format!("Could not remove stored credentials: {e}"))),
    }
}

fn try_refresh(email: &str, cfg: &OAuthProviderConfig) -> melib::Result<Option<String>> {
    let entry = keyring_entry(email)?;
    let refresh_token = match entry.get_password() {
        Ok(token) => token,
        Err(keyring::Error::NoEntry) => return Ok(None),
        Err(e) => return Err(err(format!("Could not read stored refresh token: {e}"))),
    };

    let (client_id, client_secret) = (cfg.client_id.clone(), cfg.client_secret.clone());
    let client = BasicClient::new(ClientId::new(client_id))
        .set_client_secret(ClientSecret::new(client_secret))
        .set_token_uri(
            TokenUrl::new(cfg.token_url.clone()).map_err(|e| err(format!("bad token url: {e}")))?,
        );

    let http = http_client()?;
    let token_result = client
        .exchange_refresh_token(&RefreshToken::new(refresh_token))
        .request(&http);

    match token_result {
        Ok(token) => Ok(Some(token.access_token().secret().clone())),
        // Any refresh failure (revoked, expired, network blip) falls through to a full
        // interactive re-login rather than surfacing the specific error here.
        Err(_) => Ok(None),
    }
}

fn interactive_login(email: &str, cfg: &OAuthProviderConfig) -> melib::Result<String> {
    let cancel_flag = Arc::new(AtomicBool::new(false));
    pending_logins()
        .lock()
        .unwrap()
        .insert(email.to_string(), cancel_flag.clone());
    let _guard = PendingLoginGuard(email.to_string());

    let (client_id, client_secret) = (cfg.client_id.clone(), cfg.client_secret.clone());

    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| {
        err(format!(
            "Could not bind a local port for the OAuth redirect: {e}"
        ))
    })?;
    let port = listener
        .local_addr()
        .map_err(|e| err(format!("Could not read local port: {e}")))?
        .port();
    let redirect_uri = format!("http://127.0.0.1:{port}/");

    let client = BasicClient::new(ClientId::new(client_id))
        .set_client_secret(ClientSecret::new(client_secret))
        .set_auth_uri(
            AuthUrl::new(cfg.auth_url.clone()).map_err(|e| err(format!("bad auth url: {e}")))?,
        )
        .set_token_uri(
            TokenUrl::new(cfg.token_url.clone()).map_err(|e| err(format!("bad token url: {e}")))?,
        )
        .set_redirect_uri(
            RedirectUrl::new(redirect_uri).map_err(|e| err(format!("bad redirect url: {e}")))?,
        );

    let (pkce_challenge, pkce_verifier) = PkceCodeChallenge::new_random_sha256();

    let (auth_url, csrf_token) = client
        .authorize_url(CsrfToken::new_random)
        .add_scope(Scope::new(cfg.scope.clone()))
        .set_pkce_challenge(pkce_challenge)
        // Google-specific: required to actually get a refresh token back, not just an access token.
        .add_extra_param("access_type", "offline")
        .add_extra_param("prompt", "consent")
        .url();

    std::process::Command::new("xdg-open")
        .arg(auth_url.to_string())
        .spawn()
        .map_err(|e| {
            err(format!(
                "Could not open a browser ({e}). Open this URL yourself: {auth_url}"
            ))
        })?;

    let (code, returned_state) = accept_redirect(&listener, &cancel_flag)?;
    if returned_state != *csrf_token.secret() {
        return Err(err(
            "OAuth state mismatch - the redirect didn't match the request that started it",
        ));
    }

    let http = http_client()?;
    let token = client
        .exchange_code(AuthorizationCode::new(code))
        .set_pkce_verifier(PkceCodeVerifier::new(pkce_verifier.secret().clone()))
        .request(&http)
        .map_err(|e| {
            err(format!(
                "Could not exchange the authorization code for a token: {e}"
            ))
        })?;

    if let Some(refresh_token) = token.refresh_token() {
        let entry = keyring_entry(email)?;
        entry
            .set_password(refresh_token.secret())
            .map_err(|e| err(format!("Got a token but could not store it: {e}")))?;
    }

    Ok(token.access_token().secret().clone())
}

// How long to wait for the browser redirect before giving up (e.g. tab closed without signing in).
const REDIRECT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(180);

fn accept_redirect(listener: &TcpListener, cancel_flag: &AtomicBool) -> melib::Result<(String, String)> {
    listener
        .set_nonblocking(true)
        .map_err(|e| err(format!("Could not configure the OAuth redirect listener: {e}")))?;
    let deadline = std::time::Instant::now() + REDIRECT_TIMEOUT;
    let mut stream = loop {
        if cancel_flag.load(Ordering::Relaxed) {
            return Err(err("Sign-in cancelled."));
        }
        match listener.accept() {
            Ok((stream, _)) => break stream,
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                if std::time::Instant::now() >= deadline {
                    return Err(err(
                        "Timed out waiting for sign-in - the browser tab may have been closed \
                         without completing it. Try again.",
                    ));
                }
                std::thread::sleep(std::time::Duration::from_millis(200));
            }
            Err(e) => return Err(err(format!("Did not receive the OAuth redirect: {e}"))),
        }
    };
    stream
        .set_nonblocking(false)
        .map_err(|e| err(format!("Could not configure the OAuth redirect connection: {e}")))?;

    let mut reader = BufReader::new(stream.try_clone().map_err(|e| err(format!("{e}")))?);
    let mut request_line = String::new();
    reader
        .read_line(&mut request_line)
        .map_err(|e| err(format!("Could not read the OAuth redirect request: {e}")))?;

    let path = request_line
        .split_whitespace()
        .nth(1)
        .ok_or_else(|| err("Malformed redirect request"))?;
    let query = path.split_once('?').map(|(_, q)| q).unwrap_or("");

    let mut code = None;
    let mut state = None;
    for pair in query.split('&') {
        if let Some((key, value)) = pair.split_once('=') {
            let value = urlencoding_decode(value);
            match key {
                "code" => code = Some(value),
                "state" => state = Some(value),
                _ => {}
            }
        }
    }

    let body = "<html><body>Signed in - you can close this tab.</body></html>";
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    );
    let _ = stream.write_all(response.as_bytes());

    match (code, state) {
        (Some(code), Some(state)) => Ok((code, state)),
        _ => Err(err(
            "OAuth redirect did not contain the expected code/state - was the login cancelled or denied?",
        )),
    }
}

fn urlencoding_decode(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut chars = input.chars();
    while let Some(c) = chars.next() {
        match c {
            '%' => {
                let hex: String = chars.by_ref().take(2).collect();
                if let Ok(byte) = u8::from_str_radix(&hex, 16) {
                    out.push(byte as char);
                }
            }
            '+' => out.push(' '),
            _ => out.push(c),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;
    use std::net::TcpStream;

    #[test]
    fn accept_redirect_parses_code_and_state() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();

        let client = std::thread::spawn(move || {
            let mut stream = TcpStream::connect(addr).unwrap();
            stream
                .write_all(
                    b"GET /?code=abc%2F123&state=xyz+state HTTP/1.1\r\nHost: localhost\r\n\r\n",
                )
                .unwrap();
            let mut buf = Vec::new();
            let _ = stream.read_to_end(&mut buf);
        });

        let (code, state) = accept_redirect(&listener, &AtomicBool::new(false)).unwrap();
        client.join().unwrap();

        assert_eq!(code, "abc/123");
        assert_eq!(state, "xyz state");
    }

    #[test]
    fn accept_redirect_errors_when_code_missing() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();

        let client = std::thread::spawn(move || {
            let mut stream = TcpStream::connect(addr).unwrap();
            stream
                .write_all(b"GET /?error=access_denied HTTP/1.1\r\nHost: localhost\r\n\r\n")
                .unwrap();
            let mut buf = Vec::new();
            let _ = stream.read_to_end(&mut buf);
        });

        let result = accept_redirect(&listener, &AtomicBool::new(false));
        client.join().unwrap();

        assert!(result.is_err());
    }
}

pub fn get_xoauth2_password(
    email: &str,
    provider: &crate::providers::ProviderConfig,
) -> melib::Result<String> {
    let cfg = provider
        .oauth
        .as_ref()
        .ok_or_else(|| err(format!("{} is not an OAuth2 provider", provider.display_name)))?;

    let refreshed = try_refresh(email, cfg)?;
    let access_token = match refreshed {
        Some(token) => token,
        None => interactive_login(email, cfg)?,
    };

    let raw = format!("user={email}\x01auth=Bearer {access_token}\x01\x01");
    Ok(base64::engine::general_purpose::STANDARD.encode(raw))
}
