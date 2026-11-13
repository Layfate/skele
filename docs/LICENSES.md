# Licenses

Skele is released under the [MIT License](../LICENSE).

## Dependency review (2026-11-13)

All dependencies that ship in the app use licenses that are compatible with distributing
Skele under MIT, in source and binary form.

**JavaScript (production dependencies, 206 packages, `npm ls --omit=dev --all`):** MIT (most),
Apache-2.0, ISC, BSD-3-Clause, 0BSD and CC0-1.0. Two packages need a note:

- `caniuse-lite` (CC-BY-4.0) is browser-support data used at build time by the CSS/JS tooling.
  Attribution: data from [caniuse.com](https://caniuse.com) by Alexis Deveria.
- `sharp` and its `libvips` binaries (Apache-2.0 / LGPL-3.0) are optional Next.js dependencies
  for server-side image optimisation. Skele's static export sets `images.unoptimized`, so they
  aren't used or shipped in the app.

**Rust (desktop shell, 303 crates, `cargo metadata`):** MIT and/or Apache-2.0 (most),
Unicode-3.0, Unlicense/MIT, BSD-3-Clause, Zlib, ISC, CC0-1.0, and MPL-2.0 for five crates in
Tauri's HTML/CSS tooling (`cssparser`, `selectors` and related). MPL-2.0 is file-level
copyleft: those crates are used unmodified from crates.io, and their source stays available
there, so it places no obligation on Skele's own code.

**Bundled native code:** SQLite (public domain, compiled in through `rusqlite`'s `bundled`
feature). The Windows installer can download Microsoft's WebView2 runtime bootstrapper
(Microsoft's redistribution terms); the runtime isn't bundled.

## Re-checking

```bash
npm ls --omit=dev --all --json        # then read each package's "license" field
cargo metadata --format-version 1 --manifest-path src-tauri/Cargo.toml   # "license" per crate
```

Please flag any GPL/AGPL/SSPL-licensed dependency in a pull request. Those can't be added
without changing Skele's license.
