fn main() {
    // Opportunistic speedup, safe for every build (local dev, packaging, and the
    // in-app "Update" command's fresh clone+build alike): link with mold instead of
    // the default bfd/gold if it's present on this machine - this binary statically
    // links melib + tauri + reqwest + oauth2, so the link step is large enough for
    // mold's speed to matter. Falls back to the default linker with no error if
    // mold isn't installed, unlike a hardcoded rustflag would.
    if cfg!(target_os = "linux") && mold_is_available() {
        println!("cargo:rustc-link-arg=-fuse-ld=mold");
    }
    tauri_build::build()
}

fn mold_is_available() -> bool {
    std::process::Command::new("mold")
        .arg("--version")
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}
