<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="src-tauri/icons/icon-white.png">
    <img src="src-tauri/icons/icon.png" width="128" alt="Tarw logo">
  </picture>
</p>

<h1 align="center">Tarw</h1>

<p align="center">
  A FOSS, native Linux email client — Wayland-first, built on real IMAP/SMTP infrastructure.
</p>

Tarw (Welsh for "bull" — a nod to Tauri/Taurus) is a genuinely beautiful native email client for Linux.

## Stack

- **Backend**: Rust
- **Frontend**: [Tauri](https://github.com/tauri-apps/tauri) + WebKitGTK (HTML/CSS/JS), for genuine CSS-fidelity HTML email rendering
- **Mail engine**: [`melib`](https://git.meli-email.org/meli/meli) (the library behind the `meli` terminal client), vendored and patched locally

## Features

- OAuth2 login (Gmail), multi-account support with a unified inbox
- Mailbox hierarchy, folder create/delete/rename/move-to-folder
- Read/unread, star/pin, delete, move — real IMAP flag operations
- Compose, Reply/Reply-All/Forward (with original message context), rich-text editing, Save to Drafts
- HTML email rendering (sandboxed iframe, remote-image opt-in), attachment view/download
- Real-time push via IMAP IDLE, desktop notifications, minimise-to-tray

## Status

Actively developed.

Not yet packaged for distribution.

## License

[GPL-3.0-or-later](LICENSE) — matching the license of the vendored [`melib`](https://git.meli-email.org/meli/meli) mail engine it's built on.
