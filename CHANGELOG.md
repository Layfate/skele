# Changelog

All notable changes are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed: Skele is now local-first and open source

- **No accounts, no server.** Sign-up, sign-in, sessions, invitations, workspace members and
  roles are gone. Skele opens to a welcome screen, and all data is stored on the device
  (IndexedDB, one database per workspace).
- The app builds to static files (`npm run build` → `./out`). It works offline as a PWA and is
  bundled into the Tauri desktop app instead of loading a remote URL.
- Routes are now static: pages are `/page/?id=…`, projects `/project/?id=…`.
- PostgreSQL, Prisma, Better Auth, nodemailer and the S3 client were removed. A standalone
  exporter (`tools/legacy-export.mjs`) converts old server data to `.skele.json`. See
  [docs/MIGRATION.md](docs/MIGRATION.md).
- Assignees, project leads and comment authors are plain names instead of user accounts.

### Added

- `.skele` backup and restore (zip + sha256-checked attachments), import as a new workspace,
  and up to 12 automatic recovery points per workspace.
- Obsidian-style notes: `[[wiki links]]` with autocomplete, backlinks, unlinked mentions,
  `#tags`, page properties, outline, daily notes, templates, Markdown source mode, and a
  split view.
- Markdown import (folders and Obsidian vaults, with attachments and links resolved) and
  Markdown export. Exports carry a hidden lossless copy so an unedited round-trip loses nothing.
- Graph view (global and local, filtered by tag and folder), Notes, Databases and Calendar
  overviews.
- Task bulk actions (multi-select with Ctrl/⌘ and Shift, then set status, priority, due date
  or assignee, or delete), and notes linked to tasks.
- Customisable keyboard shortcuts, interface density, a command palette with templates, daily
  notes and workspace switching.
- Optional Spotify integration (PKCE, bring your own client ID): sidebar mini player, floating
  player, playlists, search, recently played and device switching.
- MIT license, contribution guide, code of conduct, security policy, issue and PR templates,
  and CI.

### Fixed

- Empty pages imported from older versions no longer show "Some content couldn't be displayed".
