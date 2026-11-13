# Skele

A calm, fast, keyboard-first workspace for notes, tasks, projects and databases. It's free and
open source, and it's **local-first**: there's no account and no Skele server, and everything
you write stays on your device.

Skele runs as a **desktop app** for Windows, macOS and Linux, and as an installable web app
(PWA) in any modern browser.

<p align="center">
  <img src="docs/screenshots/home.png" alt="Skele's home screen with the sidebar, recent pages and tasks" width="860">
</p>

<p align="center">
  <img src="docs/screenshots/page.png" alt="A note with wiki links and backlinks" width="420">
  <img src="docs/screenshots/board.png" alt="A project's task board" width="420">
</p>

## Features

- **Notes:** nested pages with a block editor (slash menu, Markdown shortcuts, tables,
  callouts, code, files), `[[wiki links]]`, backlinks, unlinked mentions, `#tags`, outline,
  daily notes, templates, a Markdown source mode, split view and a graph view
- **Projects and tasks:** list, board and calendar views, bulk actions, and notes linked to tasks
- **Databases:** table, board, calendar, gallery and list views
- **Your data, your files:** Markdown import and export (an Obsidian vault works in both
  directions), complete `.skele` backups, and automatic recovery points
- **Offline:** everything works without a network connection
- **Optional Spotify** playback controls (your own Spotify app, PKCE, no secrets)
- **Desktop app:** native window, menus and file dialogs, workspaces stored as SQLite files,
  a portable mode, and optional signed in-app updates

## Install

Download the latest version from **[GitHub Releases](../../releases/latest)**. Each release
lists a SHA-256 checksum for every file in `SHA256SUMS.txt`, and its notes say which builds are
code-signed.

| System | Download | Notes |
|---|---|---|
| **Windows 10/11 (x64)** | `Skele_<version>_x64-setup.exe` | Installer (recommended): per-user install, Start menu shortcut, uninstaller |
| | `Skele_<version>_x64.msi` | For managed/enterprise deployment (per-machine) |
| | `Skele_<version>_x64-portable.zip` | Portable: unzip and run, data stays in the folder |
| **Windows (ARM64)** | `Skele_<version>_arm64-setup.exe`, `…_arm64-portable.zip` | When the release includes them (best-effort build) |
| **macOS 11+ (Apple Silicon)** | `Skele_<version>_macos-arm64.dmg` / `.zip` | M1 and later |
| **macOS 11+ (Intel)** | `Skele_<version>_macos-x64.dmg` / `.zip` | |
| **Linux (x64)** | `Skele_<version>_linux-x64.AppImage` | Portable, most distributions |
| | `Skele_<version>_linux-x64.deb` | Debian, Ubuntu, Mint, Pop!_OS |
| | `Skele_<version>_linux-x64.rpm` | Fedora, RHEL, openSUSE |
| | `Skele_<version>_linux-x64.tar.gz` | Standalone binary + desktop entry |
| **Linux (ARM64)** | the same four with `linux-arm64` | When the release includes them (best-effort build) |

Files ending in `.app.tar.gz` and `.sig`, and `latest.json`, are used by the in-app updater.
You don't need to download them.

### Windows

1. Download `Skele_<version>_x64-setup.exe` and run it. It installs for your user account, so no
   administrator rights are needed, and adds a Start menu entry. You can choose a desktop
   shortcut at the end.
2. If the release isn't code-signed, SmartScreen may say *"Windows protected your PC"*. Choose
   **More info → Run anyway**.
3. Skele needs the Microsoft Edge WebView2 Runtime, which is part of Windows 11 and up-to-date
   Windows 10. The installer adds it if it's missing.

**Uninstall** from *Settings → Apps → Installed apps → Skele*. Your workspaces are kept (see
[Where your data lives](#where-your-data-lives)) unless you tick *Delete the application data*
in the uninstaller.

**Portable:** unzip `Skele_<version>_x64-portable.zip` somewhere you can write to (a USB stick,
`Documents`; not `Program Files`) and run `Skele.exe`. All data, including settings and window
position, goes into the `SkeleData` folder next to it, and nothing is written to your user
profile. To update, replace `Skele.exe` and keep `SkeleData`. Portable copies don't update
themselves.

### macOS

1. Open the `.dmg` for your Mac (Apple Silicon: `macos-arm64`, Intel: `macos-x64`) and drag
   Skele to **Applications**.
2. If the release notes say the build **isn't notarized**, macOS blocks the first launch.
   Right-click Skele in Applications → **Open** → **Open**, or go to **System Settings →
   Privacy & Security** and click **Open Anyway**.

The `.zip` contains the same `Skele.app` for people who prefer it to a disk image.
**Uninstall** by moving Skele to the Bin. Your data stays in
`~/Library/Application Support/dev.skele.desktop`.

### Linux

- **AppImage:** `chmod +x Skele_*.AppImage && ./Skele_*.AppImage`. On distributions without
  FUSE 2, install `libfuse2` (Ubuntu 22.04+: `sudo apt install libfuse2`) or run it with
  `--appimage-extract-and-run`.
- **Debian/Ubuntu:** `sudo apt install ./Skele_<version>_linux-x64.deb` (pulls in WebKitGTK
  4.1). Remove with `sudo apt remove skele`.
- **Fedora/RHEL/openSUSE:** `sudo dnf install ./Skele_<version>_linux-x64.rpm`. Remove with
  `sudo dnf remove skele`.
- **tar.gz:** extract and run `./skele`. It needs `webkit2gtk-4.1` and `gtk3` from your
  distribution. `README.txt` inside explains the optional menu entry and portable mode.

Linux builds are made on Ubuntu 22.04 and need **glibc 2.35+ and WebKitGTK 4.1**: Ubuntu
22.04+, Debian 12+, Fedora 36+, Linux Mint 21+, and current Arch/openSUSE Tumbleweed. Older
distributions (Ubuntu 20.04, Debian 11, RHEL 8) aren't supported.

### Supported architectures

| | x64 | ARM64 |
|---|---|---|
| Windows 10/11 | ✅ installer, MSI, portable | ◐ installer + portable, best-effort (no MSI: WiX can't target ARM64) |
| macOS 11+ | ✅ Intel | ✅ Apple Silicon |
| Linux | ✅ AppImage, deb, rpm, tar.gz | ◐ best-effort |

"Best-effort" builds are attempted for every release. When one fails, the release ships
without it and its notes say so.

### Web app

`npm run build` produces static files you can host anywhere (see
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)). In the browser, data lives in IndexedDB and the app
works offline as a PWA.

## Where your data lives

| | Location |
|---|---|
| Windows | `%APPDATA%\dev.skele.desktop\` |
| macOS | `~/Library/Application Support/dev.skele.desktop/` |
| Linux | `~/.local/share/dev.skele.desktop/` (or `$XDG_DATA_HOME/dev.skele.desktop/`) |
| Portable (Windows zip, Linux tar.gz) | `SkeleData/` next to the executable |
| Browser / PWA | IndexedDB in that browser profile |

In the desktop app each workspace is a folder with a SQLite database (`workspace.sqlite3`)
and its attachments as plain files. **Settings → Desktop app** shows the folder and opens it.
Installing a new version, updating in the app, or uninstalling never deletes this folder.
Before Skele ever changes the database format, it copies the old file to `backups/`. The full
layout is in [docs/DESKTOP.md](docs/DESKTOP.md).

Skele also keeps up to 12 rolling recovery points per workspace, and you can export a
complete `.skele` backup or a Markdown folder at any time (**Settings → Data & backup**). The
file format is documented in [docs/DATA-FORMAT.md](docs/DATA-FORMAT.md).

## Updates

The desktop app can check GitHub Releases for new versions (once a day, in the background).
When one is available it shows the release notes and asks before downloading. Every update
is verified against Skele's signing key before it's installed. If GitHub can't be reached,
nothing happens and Skele keeps working. Turn automatic checks off in **Settings → Desktop
app**. Portable copies and Linux `.deb`/`.rpm`/`.tar.gz` installs are updated by downloading
the new package.

## Development

Requirements: **Node.js 20.19+** (22 or 24 recommended). For the desktop app, also **Rust**
(stable, from <https://rustup.rs>) and the
[Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your system (Windows: Visual
Studio C++ Build Tools; macOS: Xcode Command Line Tools; Linux: `libwebkit2gtk-4.1-dev` and
friends).

```bash
npm install
npm run dev              # web app at http://127.0.0.1:3000
npm run desktop:dev      # the desktop app, with hot reload
```

Use `127.0.0.1` rather than `localhost`; Spotify only accepts loopback IPs.

### Build from source

```bash
npm run build            # static web build → ./out
npm run desktop:build    # desktop installers for this system → src-tauri/target/release/bundle/
```

Local desktop builds have no update source and aren't signed. Release builds are made by
GitHub Actions (see [docs/RELEASING.md](docs/RELEASING.md)).

### Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Next.js dev server |
| `npm run build` · `npm start` | Static production build → `./out` · serve it locally |
| `npm run typecheck` · `npm run lint` | TypeScript · ESLint |
| `npm test` | Unit and repository tests, against both IndexedDB and the desktop SQLite adapter |
| `npm run test:e2e` | End-to-end tests in a browser (Playwright) |
| `npm run test:rust` | Desktop storage engine, data paths and commands (`cargo test`) |
| `npm run test:desktop` | End-to-end test of the built Windows app (WebView2 over CDP) |
| `npm run desktop:dev` · `npm run desktop:build` | Tauri desktop app |
| `npm run desktop:icons` | Regenerate every icon size from `src-tauri/app-icon.png` |
| `npm run version:set 1.2.3` | Set the version in package.json and Cargo.toml |

### Project layout

```
src/app/                 routes (all static; ids are passed as ?id=…)
src/data/                local data layer: storage interface, IndexedDB and SQLite adapters,
                         repositories, backup/restore, recovery points, file validation
src/features/<area>/     UI and hooks per feature (pages, editor, projects, databases, desktop, …)
src/components/          shared UI
src-tauri/               desktop shell (Rust): SQLite storage, data paths, updater, sign-in
scripts/                 build, artifact collection, release assembly, smoke tests
tests/unit/ · tests/e2e/ · tests/desktop/
.github/workflows/       ci.yml · build.yml · release.yml
docs/                    desktop, releasing, data format, migration, deployment, status
```

### Stack

Next.js 16 (static export) · React 19 · TypeScript (strict) · Tailwind CSS 4 · shadcn/ui
(Radix) · Tiptap 3 · Dexie (IndexedDB) · SQLite (desktop, via rusqlite) · TanStack Query ·
Zustand · Zod 4 · Tauri 2 · Vitest · Playwright.

## Known limitations

- **Code signing** is configured but needs certificates. Releases built without them are
  marked in their notes: Windows SmartScreen warns once, and macOS needs right-click → Open.
- **Windows ARM64 and Linux ARM64** are best-effort builds. The Windows ARM64 build is
  cross-compiled and can't be launch-tested in CI.
- **Linux:** needs WebKitGTK 4.1 (see above). On some NVIDIA/Wayland setups WebKitGTK renders
  a blank window; starting Skele with `WEBKIT_DISABLE_DMABUF_RENDERER=1` fixes it.
- **Portable mode** on macOS isn't available: the `.zip` is a normal app bundle that uses the
  standard data folder.
- **Sync** between devices isn't built in. Use backups, or put exports in a folder you sync.
- **Spotify** needs your own Spotify developer app (see [docs/SPOTIFY.md](docs/SPOTIFY.md)).
- The web build and the desktop app keep separate data. Move a workspace between them with a
  `.skele` backup.

More detail is in [docs/STATUS.md](docs/STATUS.md).

## Contributing

Contributions are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md), and please follow the
[Code of Conduct](CODE_OF_CONDUCT.md). Report security issues privately as described in
[SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE). Third-party dependencies are under MIT, Apache-2.0, BSD, ISC and similar
permissive licenses (see [docs/LICENSES.md](docs/LICENSES.md)).
