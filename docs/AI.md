# AI workspace

Skele's AI chat (sidebar → **Chat**, `Ctrl/⌘ Shift O`) can use:

| Provider | Where | Sign-in |
|---|---|---|
| **Claude Code** (`claude`) | Desktop app | The account the CLI is already signed in to |
| **Codex** (`codex`) | Desktop app | The account the CLI is already signed in to |
| **Ollama** (local models) | Desktop app and browser | None: runs on this computer |
| **Claude API** | Anywhere | Your Anthropic API key |
| **OpenAI API** | Anywhere | Your OpenAI API key |

Skele finds installed tools automatically (PATH plus the usual install folders, including
npm, nvm, Homebrew, Volta, Bun and Ollama's own locations on Windows, macOS and Linux).
**Settings → AI → Providers** shows what was found, the version, and lets you point to a
custom location.

Skele never reads the CLIs' passwords or tokens. It runs the official command-line tools,
which use their own sign-in. API keys you enter are stored on this device only, outside
your workspaces and backups.

## What the AI may do: access modes

Each chat has a shield button below the message box (Claude Code and Codex only):

| Mode | Claude Code | Codex |
|---|---|---|
| **Chat only** (default) | No tools at all; Skele's own system prompt | Read-only sandbox in an empty private folder |
| **Read files** | `Read`, `Glob`, `Grep` in the chosen folder, `dontAsk` permission mode (reads outside the folder are refused) | Read-only sandbox in the chosen folder |
| **Edit files** | Also `Edit`, `Write`, `NotebookEdit`, `acceptEdits` mode. **No shell** | `workspace-write` sandbox in the chosen folder (commands run sandboxed, no network) |

Plus, per chat:

- **Web search**: Claude Code's `WebSearch`/`WebFetch`; Codex `web_search = "live"`.
- **MCP servers**: the Skele-managed servers you tick (see below).

Nothing ever waits for a permission prompt: every run passes `--permission-prompts none`
(Claude Code) or `approval_policy = "never"` (Codex), so anything the mode doesn't allow is
refused. Claude Code reports refused tool uses; Skele shows them under the reply ("Not
allowed in this chat"). The folder must exist and can't be a drive root or your home folder
itself; it's checked again in the desktop app's Rust code on every run.

The CLIs are started only by `src-tauri/src/ai.rs`, which builds every argument from validated
values (model names, session ids, server names, TOML values for Codex). The page can't run an
arbitrary command.

## MCP servers

**Settings → AI → MCP servers** manages servers Skele hands to Claude Code and Codex:

- **Add from list**: Filesystem, Fetch, Memory, Sequential thinking, Time, Git, Playwright,
  Context7 and GitHub, with the right command for your OS (`cmd /c npx …` on Windows).
- **Custom server**: a local program (stdio) or an HTTP/SSE URL, with environment variables
  or headers.
- **Paste JSON**: the `mcpServers` block from a README, Claude Desktop, Cursor or VS Code.
- **Test** starts the server (or connects to it), opens an MCP session and lists its tools.

Skele passes servers per chat (Claude Code: a temporary `--mcp-config` file in Skele's data
folder, removed after the run; Codex: `-c mcp_servers.<name>…` overrides). It never edits
the CLIs' own configuration. Servers already configured in Claude Code or Codex are listed
read-only, with secrets masked. By default chats don't use them (Codex's are switched off
per run, and so are its app connectors). Turn on **Use Claude Code's and Codex's own
extensions** under Providers to let chats use them, along with the CLIs' plugins and skills.

Servers run on your computer with your permissions: only add ones you trust. Servers that
sign in with OAuth need a one-time `claude mcp login <name>` / `codex mcp login <name>`.

## Plugins

**Settings → AI → Plugins** uses each CLI's own plugin commands (`claude plugin …`,
`codex plugin …`): list installed plugins, enable/disable/update them (Claude Code), browse
and install from marketplaces, and add, update or remove marketplaces. When a Claude Code
marketplace declares an install command, Skele shows the command and asks before accepting
it (`--accept-command <sha256>`).

## Skills

**Settings → AI → Skills** lists the `SKILL.md` folders in `~/.claude/skills` and
`~/.codex/skills` (or `$CLAUDE_CONFIG_DIR` / `$CODEX_HOME`). You can create a skill (for
Claude Code, Codex or both), edit its `SKILL.md`, import a skill folder (no links, at most
500 files and 50 MB) or delete one. Type `/` and a skill's name in a chat to use it (Codex
receives it as `$name`).

## Agents (multi-agent)

**Settings → AI → Agents**: assistants with their own instructions and, optionally, their
own provider and model. In a chat:

- Type `@name` to ask an agent; mention several (`@reviewer @editor …`) and they answer in
  parallel, side by side. Each agent keeps its own CLI session and is told what the others
  said.
- The **@** button sets the agent that answers a chat by default.
- Agents marked **Claude Code can delegate to it** are passed to Claude Code as sub-agents
  (`--agents`), so it can hand parts of a task to them.

## Slash commands

Skele answers these itself: `/usage`, `/status`, `/compact`, `/model [name]`,
`/mode [chat|read|edit]`, `/mcp`, `/skills`, `/agents`, `/new`, `/help`. Any other `/name`
is a skill and goes to the CLI.

## Context

- Page text attached more than once is sent only with its newest copy.
- `/compact` summarizes the conversation so far; the summary replaces the earlier messages,
  and Claude Code / Codex sessions start over from it.
- For API and local models, long conversations are summarized automatically before they
  stop fitting (Settings → AI → Providers → *Summarize long conversations automatically*).
  If that fails, the oldest messages are left out, and the model is told so.
- When you switch provider or agent mid-chat, the CLI is caught up on what it missed.
- The message box shows how full the context window is once it's worth knowing.

## Usage limits and the local fallback

- `/usage` and **Settings → AI → Usage** show Claude Code's and Codex's plan limits (5-hour
  and weekly windows, with reset times), plus the tokens each provider used in Skele per
  day, as the providers reported them (kept on this device for 120 days).
- A chip next to the send button warns when a plan limit is nearly used (90% by default).
- With **Answer with the local model instead** on and an Ollama model chosen, a reply goes
  to the local model when the provider is known to be over its limit (no request is spent),
  or when it fails because it's at a limit, signed out, offline or not installed. The reply
  says so.

## Local models (Ollama)

**Settings → AI → Local models** finds Ollama, starts it if it's installed but not running,
lists, downloads (with progress) and deletes models, and sets the context window. In the
desktop app Skele talks to Ollama from Rust (`src-tauri/src/ai_ollama.rs`), so no content
security policy or CORS changes are needed. In a browser, Ollama must allow the site's origin
(`OLLAMA_ORIGINS`) unless Skele is served from localhost.

## Where things are stored

Chats, AI settings, agents, MCP servers and the usage history are kept in the app registry
on this device (IndexedDB), never in workspace backups or exports. Claude Code and Codex
keep their own session files as they normally do.

## Code map

| | |
|---|---|
| `src-tauri/src/ai.rs` | Runs the CLIs: access modes, MCP/sub-agent files, Codex isolation, detection, folder checks |
| `src-tauri/src/ai_ext.rs` | Plugins and marketplaces, the CLIs' MCP lists (masked), MCP connection test, skills |
| `src-tauri/src/ai_ollama.rs` | Ollama status, models, streaming chat, downloads, start |
| `src/features/ai/run.ts` | One turn: provider/agent/model, history, CLI catch-up, skills, `/compact` |
| `src/features/ai/fallback.ts` | The local fallback |
| `src/features/ai/context.ts` | Context fitting and summaries |
| `src/features/ai/limits.ts` | Plan limits, error kinds, usage ledger |
| `src/features/ai/extensions.ts` | MCP registry and presets, plugins, skills |
| `src/features/ai/agents.ts` | Agents, @mentions, Claude Code sub-agents |
| `src/features/ai/providers/` | Claude Code / Codex stream parsers, Ollama, Claude API, OpenAI API |

Tests: `tests/unit/ai.test.ts`, `tests/unit/ai-workspace.test.ts`, `tests/e2e/ai.spec.ts`,
and `cargo test` (including opt-in live tests that run the real CLIs:
`cargo test live_ -- --ignored`).
