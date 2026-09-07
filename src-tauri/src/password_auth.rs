use keyring::Entry;

// Distinct keyring service from oauth.rs's "tarw" - even though both are keyed by email, this
// keeps a password-auth account and an OAuth account on the same address from colliding on one slot.
const KEYRING_SERVICE: &str = "tarw.password";

fn err(msg: impl Into<String>) -> melib::error::Error {
    melib::error::Error::new(msg.into())
}

fn entry(email: &str) -> melib::Result<Entry> {
    Entry::new(KEYRING_SERVICE, email)
        .map_err(|e| err(format!("Could not open the system keyring: {e}")))
}

pub fn set_password(email: &str, password: &str) -> melib::Result<()> {
    entry(email)?
        .set_password(password)
        .map_err(|e| err(format!("Could not store password: {e}")))
}

pub fn get_password(email: &str) -> melib::Result<String> {
    entry(email)?.get_password().map_err(|e| match e {
        keyring::Error::NoEntry => err(format!("No stored password for {email} - re-add the account.")),
        e => err(format!("Could not read stored password: {e}")),
    })
}

pub fn forget_password(email: &str) -> melib::Result<()> {
    match entry(email)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(err(format!("Could not remove stored password: {e}"))),
    }
}
