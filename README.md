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

## Getting started

### Prerequisites

- [Rust](https://www.rust-lang.org/tools/install) (stable toolchain)
- [Node.js](https://nodejs.org/) (for the Tauri CLI)
- Linux system packages for Tauri v2 + WebKitGTK — see the [Tauri prerequisites guide](https://v2.tauri.app/start/prerequisites/) for your distro (Debian/Ubuntu: `libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev`, `build-essential`, `curl`, `wget`, `file`, `libxdo-dev`, `libssl-dev`, `libsoup-3.0-dev`, `pkg-config`)

### Build and install

```sh
git clone https://github.com/daviesjamesdaniel/tarw.git
cd tarw
npm install && npm run tauri build
```

This produces a `.deb`/AppImage/etc. (depending on your distro) under `src-tauri/target/release/bundle/` — install that, then launch Tarw normally from your desktop's app launcher, like any other installed app.

### Gmail (OAuth2)

No setup needed — sign in with your Google account when adding the account in-app. Tarw ships with its own OAuth client, so there's no Google Cloud Console setup required. Since that client isn't verified by Google (a paid review process not worth it for a small FOSS project), you'll see an "unverified app" warning during sign-in — click **Advanced → Go to Tarw (unsafe)** to continue. See [PRIVACY.md](PRIVACY.md) for what the app actually does with your data.

### Other providers (Fastmail, iCloud, self-hosted IMAP)

No extra setup needed — add the account in-app with the email address and an app-specific password generated from that provider's own account settings.

## Status

Actively developed.

Not yet packaged for distribution.

## License

[GPL-3.0-or-later](LICENSE) — matching the license of the vendored [`melib`](https://git.meli-email.org/meli/meli) mail engine it's built on.
