# Skele desktop app (Tauri 2)

The desktop app is a native window around the same static build as the web app (`./out`,
embedded in the executable). It loads nothing from the internet, works fully offline, and
stores workspaces in **SQLite files** on disk instead of the webview's IndexedDB.

```
src-tauri/
  tauri.conf.json          app metadata, window, CSP, bundles, updater public key
  capabilities/            what the page may call (least privilege)
  src/lib.rs               startup: data folder, plugins, main window
  src/paths.rs             data folder selection (installed / portable / SKELE_DATA_DIR)
  src/storage.rs           SQLite engine: tables, transactions, attachments, migrations, backups
  src/commands.rs          commands the page calls (storage, save dialog, app info)
  src/oauth.rs             loopback redirect for the Spotify sign-in
src/data/adapters/sqlite.ts   the page's side of the storage engine
src/lib/desktop.ts            small bridge (app info, save dialog, external links)
src/features/desktop/         Settings → Desktop app, update checks
```

## Data

### Location

| | Data folder |
|---|---|
| Windows | `%APPDATA%\dev.skele.desktop\` |
| macOS | `~/Library/Application Support/dev.skele.desktop/` |
| Linux | `$XDG_DATA_HOME/dev.skele.desktop/` (usually `~/.local/share/dev.skele.desktop/`) |
| Portable | `SkeleData/` next to the executable |
| Override | the folder in the `SKELE_DATA_DIR` environment variable |

User data is never written to the installation directory. **Settings → Desktop app** shows
the folder in use and opens it.

### Layout

```
skele.sqlite3                     workspace list, preferences, integration tokens, recovery-point index
recovery-points/<id>              compressed recovery points (up to 12 per workspace)
workspaces/<workspace id>/
  workspace.sqlite3               pages, notes, tasks, projects, databases, … (one table each)
  attachments/<file id>           attachment bytes, exactly as uploaded
backups/                          copies made automatically before a format migration
webview/                          (portable / SKELE_DATA_DIR only) the webview's own profile
window-state.json                 (portable / SKELE_DATA_DIR only) window size and position
```

Each table has two columns, `key` and `data` (the row as JSON), plus expression indexes on
the fields Skele looks rows up by. You can open the files with any SQLite tool; close Skele
first if you want to change anything. The JSON row shapes are the same as in `.skele` backups
([DATA-FORMAT.md](DATA-FORMAT.md)).

### Safety

- **Durability:** every save is a SQLite transaction in WAL mode with `synchronous=FULL`, so a
  saved change survives a crash or power cut. A save that touches several records (moving a
  page tree, restoring a backup) is all-or-nothing.
- **Attachments** are written to a temporary file, flushed, and renamed into place *before*
  the record pointing at them is saved. Files that end up unreferenced (after a crash, say)
  are cleaned up on a later start.
- **Updates and uninstalling never touch the data folder.** The NSIS uninstaller offers an
  opt-in *Delete the application data* checkbox, which is off by default.
- **Format migrations:** the layout version is stored in `PRAGMA user_version`. Before a
  migration, Skele writes a consistent copy of the file (`VACUUM INTO`) to `backups/` and runs
  the migration in a transaction. If it fails, the original file is unchanged. A file written
  by a *newer* Skele is refused with a message instead of being opened. Adding tables or
  indexes is non-destructive and doesn't need a migration.
- **Recovery points** and `.skele` backups work exactly as in the web app. Before installing an
  in-app update, Skele takes a recovery point of the open workspace.

### Portable mode

A file named `skele-portable.txt` next to the executable switches Skele to portable mode:
data, the webview profile and the window state go to `SkeleData/` beside it, and nothing is
written to the user profile. The Windows portable zip ships with the marker. For the Linux
tarball, create the file yourself. The folder must be writable; if it isn't (a read-only
medium, `Program Files`), Skele says so and exits rather than losing writes. Portable copies
don't install updates; Settings links to the release page instead.

### Web app ↔ desktop

The web app (IndexedDB) and the desktop app (SQLite) keep separate data. To move a workspace,
export a `.skele` backup in one and open it from the welcome screen (or Settings → Data &
backup → Import) in the other.

## Native integration

- **Window:** size, position and maximised state are remembered: by `tauri-plugin-window-state`
  in installed copies, and in `window-state.json` inside the data folder for portable copies
  and `SKELE_DATA_DIR` (the plugin always writes to the user profile).
  Light/dark follows the system unless you pick a theme in Settings.
- **Single instance:** starting Skele again focuses the running window
  (`tauri-plugin-single-instance`), so two copies never write to the same files.
- **macOS:** the standard app menu (About, Hide, Quit, Edit with copy/paste, Window) and Dock
  icon come from Tauri's default menu.
- **File dialogs:** exports (`.skele` backups, Markdown zips) open a native save dialog.
  Imports use the system's open dialog.
- **Links** to websites open in the default browser.
- **Keyboard shortcuts** use ⌘ on macOS and Ctrl elsewhere, and are customisable in Settings.
- **Spotify:** the sign-in opens in your browser and returns to
  `http://127.0.0.1:<port>/callback`, which Skele listens on only during the sign-in (port
  43827, or a free port the OS picks if 43827 is taken). See [SPOTIFY.md](SPOTIFY.md).

## Security

- The page has no general file-system, shell or process access. It can call only Skele's own
  commands (storage, save via a dialog the user confirms, app info, opening the data folder)
  plus the plugin permissions in `src-tauri/capabilities/`: dialogs, opening http(s) links,
  restart, and the updater.
- Storage commands validate table, field and file names. Attachment keys can't contain path
  separators, so nothing can be written outside the data folder.
- A Content Security Policy limits the page to its own bundled scripts. Network access is
  limited to Spotify's API; update checks go through the updater plugin in Rust, not the page.
- Updates must be signed with Skele's updater key (minisign). The public key is in
  `tauri.conf.json`; an update with a bad signature is rejected.

## Updates

See [RELEASING.md](RELEASING.md#in-app-updates) for how update files are produced. In the
app:

- **Settings → Desktop app → Updates:** check now, see the new version and its notes,
  download with progress, install, restart. Failures leave the current version as it was and
  offer *Try again* and a link to the release page.
- Automatic checks run once a day in the background and can be turned off. They are silent when
  offline or when GitHub is unreachable.
- *Skip this version* silences the reminder for that version.
- Per platform: the Windows installer updates in place (NSIS or MSI, matching how Skele was
  installed); macOS replaces the app bundle; Linux updates the AppImage. `.deb`, `.rpm`,
  tarball and portable copies are updated by installing the new package, and Settings says so.
- Builds without a configured update source (local builds) say so and don't check.

## Develop and build

Prerequisites: Rust (stable) and the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/):

- **Windows:** Visual Studio 2022 Build Tools with "Desktop development with C++", and
  WebView2 (part of Windows 11).
- **macOS:** Xcode Command Line Tools (`xcode-select --install`).
- **Linux (Debian/Ubuntu):** `sudo apt install libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf build-essential`

```bash
npm run desktop:dev       # dev server + app window with hot reload
npm run desktop:build     # installers for this system → src-tauri/target/release/bundle/
npm run test:rust         # Rust tests (storage engine, paths, commands, loopback sign-in)
npm run test:desktop      # Windows: drives the built app over WebView2's DevTools protocol
```

`cargo build` on its own builds a development binary that loads `http://127.0.0.1:3000`. Use
the Tauri CLI (`npm run desktop:build`) for a binary with the app embedded.

Icons are generated from `src-tauri/app-icon.png` (1024×1024) with `npm run desktop:icons`.
