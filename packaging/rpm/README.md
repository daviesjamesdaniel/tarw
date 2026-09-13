# Fedora/openSUSE packaging

Builds a `.rpm` via [`cargo-generate-rpm`](https://github.com/cat-in-136/cargo-generate-rpm),
which reads the `[package.metadata.generate-rpm]` block in `src-tauri/Cargo.toml`.
Local-only for now, same as `packaging/arch` - not published to any repository.

Optional but recommended on Fedora - `src-tauri/build.rs` auto-detects and
links with [`mold`](https://github.com/rui314/mold) if it's present, which
noticeably speeds up the build (verified available on Fedora 40/41/latest;
not checked on openSUSE):

```sh
sudo dnf install -y mold
```

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
