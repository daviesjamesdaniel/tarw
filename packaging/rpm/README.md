# Fedora/openSUSE packaging

Builds a `.rpm` via [`cargo-generate-rpm`](https://github.com/cat-in-136/cargo-generate-rpm),
which reads the `[package.metadata.generate-rpm]` block in `src-tauri/Cargo.toml`.
Local-only for now, same as `packaging/arch` - not published to any repository.

```sh
cargo install cargo-generate-rpm --locked
cd src-tauri
cargo build --release --locked
cargo generate-rpm
```

The `.rpm` is written to `src-tauri/target/generate-rpm/tarw-<version>-1.<arch>.rpm`.
Install with:

```sh
sudo dnf install ./target/generate-rpm/tarw-*.rpm
```
