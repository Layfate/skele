# Implementation status

Status as of 2026-11-13, after the local-first conversion. "Verified" means covered by
automated tests and/or exercised in a real browser against the running app. Anything not
verified says so.

## Verification summary

| Check | Result |
|---|---|
| `npm run typecheck` | ✅ clean |
| `npm run lint` | ✅ clean |
| `npm test` (Vitest, fake IndexedDB) | ✅ 65 tests in 8 files |
| `npm run test:e2e` (Playwright, Chromium) | ✅ 12 tests, stable across repeated runs |
| `npm run build` (static export) | ✅ 16 routes, all static |
| `npm audit --omit=dev` | ✅ 0 vulnerabilities |
| Production build, offline | ✅ service worker installs; reload and navigation work offline |
| Legacy data | ✅ both PostgreSQL exports import, with counts matching SQL |

## Phase 1: No accounts ✅

Auth, sessions, invitations, members, roles and the API layer are removed. First launch opens a
welcome screen (create, sample workspace, open a backup, import Markdown). People are plain
names. Verified by e2e tests.

## Phase 2: Local persistence and migration ✅

- Dexie/IndexedDB store, one database per workspace and a registry. Strict-durability
  transactions, cross-tab refresh through BroadcastChannel.
- `.skele` backup and restore (zip, sha256-checked attachments, schema validation, reference
  repair), import as a new workspace, and up to 12 automatic recovery points.
- `tools/legacy-export.mjs` exported both real workspaces from PostgreSQL. The PostgreSQL data
  directory was left untouched. See [MIGRATION.md](MIGRATION.md).

## Phase 3: Notes ✅

`[[wiki links]]` with autocomplete and create-on-link, backlinks, unlinked mentions, `#tags`
and page properties, outline, daily notes, templates, Markdown source mode, and split view.
Verified by unit tests and e2e (link → reload → backlink).

## Phase 4: Productivity ✅ (mostly)

- Dashboard, My tasks (All/Inbox), projects, list/board/calendar views, databases.
- ✅ Task bulk actions: Ctrl/⌘- and Shift-select, then set status, priority, due date or
  assignee, or delete. Verified by e2e.
- ✅ Notes linked to tasks: the task sheet has a "Note" field and "New note", and the page
  details panel lists linked tasks. Verified by e2e.
- ✅ Customisable shortcuts, compact/comfortable density (checked in the production build).
- ◐ No right-click context menus yet. Actions live in the "…" menus.

## Phase 5: Spotify ◐

PKCE flow, token refresh, error classification (Premium, no device, rate limit), mini,
floating and expanded players, playlists, search, recently played and device switching.
**Covered only by unit tests with mocked HTTP. Not tested against a live Spotify account.**
Connecting from the desktop window isn't supported. See [SPOTIFY.md](SPOTIFY.md).

## Phase 6: Graph, import/export ✅

Graph view (d3-force; global/local; tag and folder filters). Markdown import (folders and
Obsidian vaults) and export (Obsidian-compatible, lossless round-trip comment). Both are
available on the welcome screen and in Settings → Data & backup. The Markdown export is
verified by e2e. The folder-picker import is covered by unit tests (`importMarkdownEntries`)
but not driven through the browser's directory picker.

## Phase 7: Desktop and open source ◐

- ✅ MIT license, README, CONTRIBUTING, CODE_OF_CONDUCT, SECURITY, CHANGELOG, issue and PR
  templates, CI workflow (typecheck, lint, test, build, audit, e2e).
- ◐ Tauri now bundles `./out` (no remote URL). **Not compiled.** No Rust toolchain was
  available. The desktop release workflow is untested.
- ✗ Desktop "vault folder" storage (SQLite or files in a folder you choose) is not
  implemented. The desktop app uses the webview's IndexedDB.

## Known gaps / next steps

1. Compile and smoke-test the Tauri app on Windows and macOS.
2. Test Spotify end to end with a real account (Premium and Free).
3. Context menus for tasks, pages and records.
4. Optional vault-folder storage adapter for the desktop app.
5. Real-time collaboration and sync are out of scope for local-first v1. A future option is
   CRDT-based (Yjs) sync between your own devices.
6. Large databases filter in memory. Virtualise tables above a few thousand records.
