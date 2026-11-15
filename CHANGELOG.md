# Changelog

All notable changes are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.2.1] - 2026-11-15

### Added

- **Images in AI chats**: paste with **Ctrl+V** or **Alt+V** (as in Claude Code), or use the
  image button. Screenshots, copied images and image files copied in File Explorer all work.
  Images are scaled down to what models look at (1568 px) and sent to Claude Code, Codex, the
  Claude and OpenAI APIs and Ollama vision models; click one in the chat to see it full size.
- **Effort from low to max**: the effort picker is now a Faster ↔ Smarter scale with Claude
  Code's five levels (low, medium, high, xhigh, max), adjustable with ← →. Providers that stop
  lower use their highest level (Codex xhigh, OpenAI high). `/effort [level]` sets it.
- **Model versions**: the model menu names each model with its version (Opus 5.5, Sonnet 5.5,
  Fable 5.2, Haiku 5.5), shows which model Claude Code's "Default" is, and has **More models**
  for earlier versions. Each reply shows the exact model and effort it used, and the model is
  told which model and effort it's running with. `/model` and `/effort` open the pickers.
- **Plugins and skills in `/`**: the `/` menu lists everything Claude Code can run, including
  plugin skills and plugin commands (e.g. `/anthropic-skills:voxel-pet-design-prompts`), with
  descriptions and the plugin's name; type part of a name to find it. Skele reads the list
  from Claude Code's own startup report, using its local `/context` command, so no usage is
  spent. New `/plugins` command lists loaded plugins and what they add.
- **Spotify timeline**: click or drag the song's progress bar to jump to any point (a bubble
  shows the time), or use ← → (5 s, Shift for 15 s), Home and End. Works in the Spotify app on
  Windows (Free accounts) and with Premium.



### Added

- **AI chat** (sidebar → Chat, `Ctrl/⌘ Shift O`). Chat with Claude or Codex, attach pages as
  context, switch provider or model mid-chat, see reasoning, stop, regenerate, edit a message,
  and save a reply as a page. Chats are kept per workspace on this device (not in backups).
  - Desktop app: uses the **Claude Code** and **Codex** command-line tools you're already
    signed in to, with no API key (`src-tauri/src/ai.rs`). Claude Code runs with no tools;
    Codex runs in its read-only sandbox in a private folder.
  - Anywhere: your own **Anthropic** or **OpenAI** API key (Settings → AI).
  - Type `/` in the message box for Skele's own commands: `/usage` (Claude Code and Codex
    plan limits, with reset times), `/status` (accounts, versions, this chat's model), `/new`,
    `/help`. They're answered by Skele and never sent to a model.
- **AI workspace** on top of AI chat (see [docs/AI.md](docs/AI.md)):
  - **Ollama** as a provider for local models (desktop and browser): detection, start, model
    download/delete, context window, and a **local fallback** that answers when Claude Code,
    Codex or an API is at its usage limit, signed out, offline or not installed.
  - **Access modes** per chat for Claude Code and Codex: chat only, read files, or edit files
    in a folder you choose, plus web search. Refused tool uses are shown under the reply.
  - **MCP server manager** (Settings → AI → MCP servers): presets, custom servers, JSON import,
    connection test, per-chat servers. The CLIs' own servers are listed with secrets masked.
  - **Plugin manager** for Claude Code and Codex plugins and marketplaces, through the CLIs.
  - **Skills manager**: create, edit, import and delete `SKILL.md` skills; `/skill` in chat.
  - **Agents**: `@mention` one or several (they answer in parallel), a default agent per chat,
    and Claude Code sub-agents.
  - Slash commands `/compact`, `/model`, `/mode`, `/mcp`, `/skills`, `/agents`.
  - Context optimization: de-duplicated page text, `/compact` summaries, automatic
    summarizing for API and local models, and a context meter.
  - Usage: tokens and cost per reply, a per-day usage history per provider, and a warning
    near Claude Code / Codex plan limits.
  - Codex's model list (from its own cache) in the model menu; Claude Code's Fable alias.
- **Spotify Free on Windows**: the player plays, pauses and skips in the Spotify app on this
  computer through Windows' media controls, with its track, cover art and progress. It works
  with Free accounts and without connecting Spotify; Premium keeps the full Web API player.
- **Colour themes** (Settings → Appearance): Skele, Claude, ChatGPT, VS Code, GitHub, One,
  Nord, Dracula, Catppuccin, Tokyo Night, Rosé Pine, Solarized and Gruvbox, each with a light
  and a dark version. A theme brings its own accent, or keep any accent colour.

### Changed

- AI providers show their real logos (Claude, Codex, OpenAI, Ollama).
- Codex chats no longer pick up the MCP servers and app connectors configured in Codex
  itself unless you turn on *Use Claude Code's and Codex's own extensions*.
- Errors from the desktop app's own commands are shown as-is instead of "Something went wrong".
- New Skele logo everywhere (app, favicon, desktop icons, README). No black anywhere: icons are
  transparent, and the iOS home-screen and Android maskable icons, which can't be transparent,
  use Skele's indigo instead of a black tile.

### Fixed

- Linux and macOS: stopping an AI reply could signal every process of the user (the `kill`
  program read the process group as an option). Skele now signals only that reply's own
  process group.
- The model menu could open taller than the space above the message box, hiding the first
  models; it now fits the window and scrolls.
- Windows: the app icon could keep the old logo with a black background from a cached build.

## [0.1.0] - 2026-11-13

First public release.

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

- Desktop app for Windows, macOS and Linux (Tauri 2): workspaces in SQLite files on disk,
  installers plus a Windows portable zip that keeps everything in `SkeleData/` beside the
  executable, native dialogs, single-instance, remembered window size and position, and
  in-app updates from GitHub Releases. See [docs/DESKTOP.md](docs/DESKTOP.md).
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
