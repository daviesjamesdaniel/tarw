# Nix packaging

Builds via [`crane`](https://github.com/ipetkov/crane) from the `flake.nix`
at the repo root (not this directory - kept here only so the update
instructions live alongside the other distros' packaging notes).

Root cause of an earlier crane vendoring failure (`the source ... requires
a lock file to be present first before it can be used against vendored
source code`) was investigated and, as of 2026-09-14, no longer reproduces
against tarw's real dependency tree - see project notes if this resurfaces.

```sh
nix build
```

The built package (binary, desktop entry, icon) is written to `./result`.
Run it directly:

```sh
./result/bin/tarw
```

Or install/update it into your Nix profile straight from GitHub, no local
clone needed:

```sh
nix profile install github:daviesjamesdaniel/tarw --refresh
```

(`--refresh` re-fetches rather than reusing eval cache - safe to re-run any
time you want the latest `main`, same as the other distros' update snippets
doing a fresh clone every time.)

If your Nix install doesn't have flakes enabled globally, add
`--extra-experimental-features 'nix-command flakes'` to either command.
