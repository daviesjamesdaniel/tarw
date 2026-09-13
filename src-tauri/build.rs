fn main() {
    // Opportunistic speedup, safe for every build (local dev, packaging, and the
    // in-app "Update" command's fresh clone+build alike): link with mold instead of
    // the default bfd/gold if it's present on this machine - this binary statically
    // links melib + tauri + reqwest + oauth2, so the link step is large enough for
    // mold's speed to matter. Falls back to the default linker with no error if
    // mold isn't installed, unlike a hardcoded rustflag would.
    // cargo:warning shows up at normal (non -vv) verbosity, including in CI logs -
    // otherwise whether this actually took effect is invisible without a verbose
    // rebuild, and a silent fallback to the default linker looks identical to
    // mold working from the build's own output.
    if cfg!(target_os = "linux") && mold_is_available() {
        println!("cargo:rustc-link-arg=-fuse-ld=mold");
        println!("cargo:warning=Linking with mold");
    } else if cfg!(target_os = "linux") {
        println!("cargo:warning=mold not found, using the default linker");
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
