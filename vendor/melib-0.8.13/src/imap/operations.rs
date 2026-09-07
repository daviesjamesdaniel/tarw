/*
 * meli - imap module.
 *
 * Copyright 2017 - 2019 Manos Pitsidianakis
 *
 * This file is part of meli.
 *
 * meli is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * meli is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with meli. If not, see <http://www.gnu.org/licenses/>.
 */

use std::sync::Arc;

use imap_codec::imap_types::fetch::MessageDataItemName;

use super::*;
use crate::{backends::*, error::Error};

/// Fetch a [`UID`] as bytes.
#[derive(Clone, Debug)]
pub struct ImapOp {
    uid: UID,
    mailbox_hash: MailboxHash,
    connection: Arc<ConnectionMutex>,
    uid_store: Arc<UIDStore>,
}

impl ImapOp {
    pub fn new(
        uid: UID,
        mailbox_hash: MailboxHash,
        connection: Arc<ConnectionMutex>,
        uid_store: Arc<UIDStore>,
    ) -> Self {
        Self {
            uid,
            connection,
            mailbox_hash,
            uid_store,
        }
    }

    pub async fn fetch(self) -> Result<Vec<u8>> {
        let mut response = Vec::with_capacity(8 * 1024);
        // Always peek: a bare `RFC822`/`BODY[]` fetch implicitly sets \Seen
        // server-side per RFC 3501, which silently marked messages as read
        // any time the app fetched their body for something other than the
        // user actually opening them (e.g. row prefetching). Read state
        // should only ever change via the app's own explicit set_seen call.
        let (_uid, _flags, body) = loop {
            {
                let mut conn = self.connection.lock().await?;
                conn.connect().await?;
                conn.examine_mailbox(self.mailbox_hash, &mut response, false)
                    .await?;
                conn.send_command(CommandBody::fetch(
                    self.uid,
                    vec![
                        MessageDataItemName::Flags,
                        MessageDataItemName::BodyExt {
                            section: None,
                            partial: None,
                            peek: true,
                        },
                    ],
                    true,
                )?)
                .await?;
                conn.read_response(
                    &mut response,
                    RequiredResponses::FETCH_FLAGS | RequiredResponses::FETCH_BODY,
                )
                .await?;
            }
            log::trace!(
                "fetch response is {} bytes and {} lines",
                response.len(),
                String::from_utf8_lossy(&response).lines().count()
            );
            let mut results = protocol_parser::fetch_responses(&response)?.1;
            if results.len() > 1 {
                return Err(
                    Error::new(format!("Invalid/unexpected response: {response:?}"))
                        .set_summary(format!("Message with UID {} was not found.", self.uid))
                        .set_kind(ErrorKind::ProtocolError),
                );
            }
            let Some(fetch_response) = results.pop() else {
                // https://datatracker.ietf.org/doc/html/rfc3501#section-6.4.8:
                //
                // A non-existent unique identifier is ignored without any error message
                // generated. Thus, it is possible for a UID FETCH command to return an OK
                // without any data or a UID COPY or UID STORE to return an OK without
                // performing any operations.
                return Err(Error::new("Not found")
                    .set_summary(format!("Message with UID {} was not found.", self.uid))
                    .set_kind(ErrorKind::NotFound));
            };
            let FetchResponse {
                uid: Some(_uid),
                flags: _flags,
                body: Some(body),
                ..
            } = fetch_response
            else {
                return Err(Error::new("Invalid/unexpected response from server")
                    .set_summary(format!("Message with UID {} was not found.", self.uid))
                    .set_details(format!("Full response: {fetch_response:?}"))
                    .set_kind(ErrorKind::ProtocolError));
            };
            break (_uid, _flags, body);
        };
        if _uid != self.uid {
            return Err(Error::new("Invalid/unexpected response from server")
                .set_summary(format!("Message with UID {} was not found.", self.uid))
                .set_details(format!(
                    "Requested UID {} but UID FETCH response was for UID {}. Full response: {:?}",
                    self.uid,
                    _uid,
                    String::from_utf8_lossy(&response)
                ))
                .set_kind(ErrorKind::ProtocolError));
        }
        let mut bytes_cache = self.uid_store.byte_cache.lock()?;
        let cache = bytes_cache.entry(self.uid).or_default();
        if let Some((_flags, _)) = _flags {
            cache.flags = Some(_flags);
        }
        cache.bytes = Some(body.to_vec());
        Ok(body.to_vec())
    }

    pub async fn as_bytes(&self) -> Result<Vec<u8>> {
        let exists_in_cache = {
            let mut bytes_cache = self.uid_store.byte_cache.lock()?;
            let cache = bytes_cache.entry(self.uid).or_default();
            cache.bytes.is_some()
        };
        if !exists_in_cache {
            return self.clone().fetch().await;
        }
        let mut bytes_cache = self.uid_store.byte_cache.lock()?;
        let cache = bytes_cache.entry(self.uid).or_default();
        let ret = cache.bytes.clone().unwrap();
        Ok(ret)
    }
}
