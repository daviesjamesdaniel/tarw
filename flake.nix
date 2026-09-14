{
  description = "Tarw - a FOSS, native Linux email client";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    crane.url = "github:ipetkov/crane";
  };

  # Advertises the public Cachix cache CI pushes to (see .github/workflows/build.yml)
  # so `nix build`/`nix profile install` against this flake offers to use it instead
  # of building from source - Nix prompts a one-time accept for an untrusted flake's
  # nixConfig, or a user with `accept-flake-config = true` picks it up silently.
  nixConfig = {
    extra-substituters = [ "https://tarw.cachix.org" ];
    extra-trusted-public-keys = [ "tarw.cachix.org-1:s8iNCabSLG4p9F/KEDtgN6A6sG8rKdbfRn/KrVJA2tk=" ];
  };

  outputs = { self, nixpkgs, crane }:
    let
      system = "x86_64-linux";
      pkgs = import nixpkgs { inherit system; };
      craneLib = crane.mkLib pkgs;

      # cleanCargoSource alone strips tauri.conf.json/icons/capabilities and
      # the frontend (tauri.conf.json's frontendDist points at ../src, i.e.
      # the repo-root src/ of plain HTML/JS/CSS, not a separate npm build
      # step) - tauri-build's build.rs reads all of these directly, so the
      # filtered source has to keep them alongside the usual Rust files.
      src = pkgs.lib.fileset.toSource {
        root = ./.;
        fileset = pkgs.lib.fileset.unions [
          (craneLib.fileset.commonCargoSources ./src-tauri)
          ./src-tauri/tauri.conf.json
          ./src-tauri/capabilities
          ./src-tauri/icons
          ./src
        ];
      };

      # mold speeds up the link step (see src-tauri/build.rs) - it's an
      # optional auto-detected dependency there (silent fallback to the
      # default linker if absent), same as the other three distros'
      # packaging, so it belongs here rather than as a hard requirement.
      nativeBuildInputs = with pkgs; [ pkg-config wrapGAppsHook3 mold ];

      # Same set proven working against tarw's real ~600-crate dependency
      # tree, 2026-09-14 - see project memory for how this was verified
      # (glib-2.0 wasn't found by pkg-config until these were added).
      buildInputs = with pkgs; [
        sqlite
        openssl
        glib
        gtk3
        webkitgtk_4_1
        libayatana-appindicator
        librsvg
      ];

      commonArgs = {
        inherit src nativeBuildInputs buildInputs;
        cargoToml = ./src-tauri/Cargo.toml;
        cargoLock = ./src-tauri/Cargo.lock;
        # Deliberately NOT `cargoExtraArgs = "--manifest-path=..."` - that
        # runs cargo from the repo root against a nested manifest, which
        # reproduces the exact crane/cargo git-dependency vendoring bug
        # investigated in project memory ("requires a lock file to be
        # present first"). Running cargo with its cwd actually inside
        # src-tauri (implicit manifest discovery, same as every other
        # distro's packaging) avoids it entirely - real root cause found
        # 2026-09-14.
        sourceRoot = "source/src-tauri";
        pname = "tarw";
        version = "0.3.6";
      };

      # Deliberately no separate `buildDepsOnly`/cargoArtifacts split here -
      # tauri's own build script bakes the sandbox's absolute OUT_DIR path
      # into a generated permissions manifest, which breaks when that target
      # dir gets decompressed into a *different* sandbox path for the final
      # buildPackage derivation (each Nix build gets a fresh /nix/var/nix/builds/...
      # path). A single-phase build sidesteps it; repeat CI runs on unchanged
      # source still get a full binary-cache hit via magic-nix-cache, so this
      # only costs a full rebuild when something actually changed anyway.
      tarw = craneLib.buildPackage (commonArgs // {
        # Explicitly null, not just omitted - buildPackage computes its own
        # default cargoArtifacts (still a two-phase build) unless told not
        # to, which would silently reintroduce the OUT_DIR staleness bug
        # explained above.
        cargoArtifacts = null;

        # Same desktop entry / icon already shipped in the deb and rpm
        # packages - kept as the one source of truth rather than
        # duplicating a Nix-specific copy that could drift.
        postInstall = ''
          install -Dm644 ${./packaging/deb/dan.tarw.desktop} \
            "$out/share/applications/dan.tarw.desktop"
          install -Dm644 ${./src-tauri/icons/128x128.png} \
            "$out/share/icons/hicolor/128x128/apps/dan.tarw.png"
          install -Dm644 ${./src-tauri/icons/32x32.png} \
            "$out/share/icons/hicolor/32x32/apps/dan.tarw.png"
        '';
      });
    in
    {
      packages.${system}.default = tarw;
      apps.${system}.default = {
        type = "app";
        program = "${tarw}/bin/tarw";
      };
      devShells.${system}.default = craneLib.devShell {
        inputsFrom = [ tarw ];
      };
    };
}
