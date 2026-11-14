# Security policy

## Reporting a vulnerability

Please **don't open a public issue** for security problems. Use GitHub's private
vulnerability reporting instead (**Security → Report a vulnerability** on the repository).
Include the steps to reproduce, the affected version, and the impact as you understand it.
You'll get an acknowledgement within a week.

## Supported versions

Only the latest release gets security fixes.

## Security model

Skele has no server and no accounts, so the attack surface is the content Skele opens and
renders on your device:

- **Imported files** (`.skele`, `.skele.json`, Markdown folders) are validated against a
  schema, size-limited, and checksummed (sha256 for backup attachments). Documents are
  sanitised (URL allow-list, depth limits, safe colours) before storage and before rendering.
- **Attachments** are checked by magic bytes against an allow-list. Executable and HTML types
  are rejected, and so is SVG.
- **Links:** only `http(s)`, `mailto` and Skele's internal `skele-file:` references are allowed.
  In the desktop app, external links open in the system browser.
- **Spotify** uses OAuth 2.0 Authorization Code with PKCE. There is no client secret. Tokens
  stay in the local app registry, and backups and Markdown exports never include them.
- **AI (desktop app):** Skele runs only the Claude Code and Codex CLIs, with arguments built
  from validated values in Rust, and never reads their credentials. Each chat's access mode
  (chat only, read files, edit files) limits what they may do, and nothing waits for a
  permission prompt: anything else is refused. Plugin and skill management call fixed CLI
  subcommands; skill files are only written inside the CLIs' skills folders. MCP servers you
  add run with your permissions, so only add ones you trust. See [docs/AI.md](docs/AI.md).
- **Service worker** (web build only) caches the app's own static files. It never caches
  third-party requests.

Things that are out of scope: anyone with access to your unlocked device or browser profile can
read your workspaces, the same as with any local app. Encrypt your disk and protect exported
backups.
