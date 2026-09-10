# Debian/Ubuntu packaging

Builds a `.deb` via [`cargo-deb`](https://github.com/kornelski/cargo-deb), which
reads the `[package.metadata.deb]` block in `src-tauri/Cargo.toml`. Local-only
for now, same as `packaging/arch` - not published to any repository.

```sh
cargo install cargo-deb --locked
cd src-tauri
cargo deb --locked
```

The `.deb` is written to `src-tauri/target/debian/tarw_<version>_<arch>.deb`.
Install with:

```sh
sudo apt install ./target/debian/tarw_*.deb
```
