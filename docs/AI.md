# AI workspace

Skele's AI chat (sidebar → **Chat**, `Ctrl/⌘ Shift O`) can use:

| Provider | Where | Sign-in |
|---|---|---|
| **Claude Code** (`claude`) | Desktop app | The account the CLI is already signed in to |
| **Codex** (`codex`) | Desktop app | The account the CLI is already signed in to |
| **Ollama** (local models) | Desktop app and browser | None: runs on this computer |
| **Claude API** | Anywhere | Your Anthropic API key |
| **OpenAI API** | Anywhere | Your OpenAI API key |
| **OpenRouter** | Anywhere | Your OpenRouter API key (hundreds of models, some free) |

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

The Claude API, OpenAI API and OpenRouter get the same modes through Skele's own tools
(`src/features/ai/tools.ts`, run by `src-tauri/src/ai_tools.rs`): **Read files** gives them
`list_files`, `read_file` and `search_files` in the chat's folder, **Edit files** adds
`write_file` and `edit_file` (exact, unique replacements). They never run commands. Every path
is resolved inside the folder in Rust (no `..`, no links out of it) and the folder is checked
like the CLIs'. Arguments are checked against each tool's schema before it runs, and a reply
stops after 30 rounds of tool calls. OpenRouter models that can't call tools answer without
them (the reply says so). Ollama models only chat.

Plus, per chat:

- **Web search**: Claude Code's `WebSearch`/`WebFetch`; Codex `web_search = "live"`; the
  Claude API's `web_search_20260209` tool; OpenAI's `web_search`; OpenRouter's web plugin
  (billed from OpenRouter credits).
- **MCP servers**: the Skele-managed servers you tick (see below). API models call them
  through the desktop app, which keeps one session per server open until Skele quits
  (`ai_mcp_tools` / `ai_mcp_call`); servers that need an OAuth sign-in, and older SSE
  servers, can't be used by API models yet.

Nothing ever waits for a permission prompt: every run passes `--permission-prompts none`
(Claude Code) or `approval_policy = "never"` (Codex), so anything the mode doesn't allow is
refused. Claude Code reports refused tool uses; Skele shows them under the reply ("Not
allowed in this chat"). The folder must exist and can't be a drive root or your home folder
itself; it's checked again in the desktop app's Rust code on every run.

The CLIs are started only by `src-tauri/src/ai.rs`, which builds every argument from validated
values (model names, session ids, server names, TOML values for Codex). The page can't run an
arbitrary command.

## Your workspace

With **Settings → AI → Providers → Let the AI see this workspace** on (the default):

- Every provider is told the titles of the workspace's pages and databases (most recently
  edited first, up to 250), so it knows what the user is referring to.
- Pages and databases a message names are attached to it automatically, like the Pages
  button: `[[Title]]` links, and titles that appear in the text as whole words (at least 4
  characters, not generic words like "Notes"; longer titles win; at most 5). They show with a
  dashed outline on the message.
- The Claude API, OpenAI API and OpenRouter also get `search_workspace`, `list_pages` and
  `read_page` tools (`src/features/ai/workspace.ts`), so they can look things up themselves.

Pages go to the model as Markdown (without the embedded original that exports carry);
databases as a table of their rows (up to 300). Nothing is sent until a message is.

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
`codex plugin …`): list installed plugins (the listing is cut down to the fields the page
shows in Rust, `slim_plugin_list`, since Claude Code's full answer runs to megabytes), enable/disable/update them (Claude Code), browse
and install from marketplaces, and add, update or remove marketplaces. When a Claude Code
marketplace declares an install command, Skele shows the command and asks before accepting
it (`--accept-command <sha256>`).

## Skills

**Settings → AI → Skills** lists the `SKILL.md` folders in `~/.claude/skills` and
`~/.codex/skills` (or `$CLAUDE_CONFIG_DIR` / `$CODEX_HOME`). You can create a skill (for
Claude Code, Codex or both), edit its `SKILL.md`, import a skill folder (no links, at most
500 files and 50 MB) or delete one. Type `/` and a skill's name in a chat to use it (Codex
receives it as `$name`).

The `/` menu shows everything Claude Code itself can run: its own skills, your skills, and the
skills and commands of its plugins (namespaced, e.g. `/anthropic-skills:pdf`), with their
descriptions and plugin name. Skele gets the list from Claude Code's startup report
(`ai_claude_catalog` runs `claude -p` with its local `/context` command, which never reaches
the model, and stops it as soon as the `init` event arrives), keeps the last answer, and adds
descriptions from the `SKILL.md` / `commands/*.md` files on disk. `/plugins` lists the
plugins Claude Code loaded and what each adds.

## Models and effort

The model menu names Claude Code's models with their versions (the `opus`, `sonnet`, `fable`
and `haiku` aliases always point at the newest: Opus 5.5, Sonnet 5.5, Fable 5.2, Haiku 5.5),
shows which model "Default" is (from the same startup report) and offers earlier versions
under **More models**. Replies show the exact model that answered (Claude Code reports it)
and the effort used.

Effort has Claude Code's five levels: low, medium, high, xhigh, max. Providers that stop lower
use their highest level: Codex `xhigh`, OpenAI API `high`; Ollama has no effort setting.
`/model` and `/effort` without arguments open the pickers; `/effort high` sets it directly.

## Images

Paste an image with **Ctrl+V** or **Alt+V**, or use the image button (up to 10 per message).
Alt+V reads the system clipboard directly (on Windows through the Win32 clipboard in
`src-tauri/src/clipboard.rs`: a PNG, a bitmap such as a screenshot, or an image file copied in
File Explorer), which also covers pastes the webview doesn't turn into a file. Images are
scaled to at most 1568 px on the long side and stored on the message as base64.

| Provider | How images are sent |
|---|---|
| Claude Code | One `--input-format stream-json` user message with image blocks |
| Codex | Written to temporary files in Skele's data folder, passed with `--image=<file>`, removed after the run |
| Claude API / OpenAI API | Image content blocks (`image` / `input_image`) |
| OpenRouter | `image_url` content parts (models with image input only) |
| Ollama | The message's `images` (vision models only) |

Claude Code and Codex get the images of the message they answer; API and local models get the
images of every message in the history they're sent.

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
`/effort [level]`, `/mode [chat|read|edit]`, `/mcp`, `/skills`, `/plugins`, `/agents`, `/new`,
`/help`. Any other `/name` is a skill (or plugin command) and goes to the CLI.

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

## OpenRouter

**Settings → AI → Providers**: add an OpenRouter key (openrouter.ai/keys); Skele checks it and
shows what it has spent and what's left. **OpenRouter model** then lists every text model from
OpenRouter's public model list (cached for an hour), searchable, with prices, context window
and image support, and a **Free only** filter. The model menu shows the recently used ones and
all of them under **More models**; `/model <provider/model>` works too.

Requests go to `https://openrouter.ai/api/v1/chat/completions` (streamed, OpenAI-compatible)
with plain `fetch`, so it works in the browser as well. Reasoning is sent only to models that
accept it, at the chosen effort lowered to the nearest level the model lists; with *Show
reasoning* off it's requested with `exclude: true`. Images go only to models that take image
input; the others are told an image was attached. The context budget is three quarters of
the model's window (at most 150K tokens). Replies record OpenRouter's reported cost.

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
| `src-tauri/src/ai_ext.rs` | Plugins and marketplaces, the CLIs' MCP lists (masked), MCP connection test, skills, Claude Code's catalog |
| `src-tauri/src/ai_tools.rs` | File tools and MCP sessions for API models |
| `src/features/ai/tools.ts` | The tools an API model gets per chat, argument checks |
| `src/features/ai/workspace.ts` | Workspace index, pages named in a message, pages and databases as text, workspace tools |
| `src-tauri/src/clipboard.rs` | Alt+V: the clipboard image (Windows) |
| `src/features/ai/images.ts` | Pasted images: decoding, downscaling, clipboard |
| `src-tauri/src/ai_ollama.rs` | Ollama status, models, streaming chat, downloads, start |
| `src/features/ai/run.ts` | One turn: provider/agent/model, history, CLI catch-up, skills, `/compact` |
| `src/features/ai/fallback.ts` | The local fallback |
| `src/features/ai/context.ts` | Context fitting and summaries |
| `src/features/ai/limits.ts` | Plan limits, error kinds, usage ledger |
| `src/features/ai/extensions.ts` | MCP registry and presets, plugins, skills |
| `src/features/ai/agents.ts` | Agents, @mentions, Claude Code sub-agents |
| `src/features/ai/providers/` | Claude Code / Codex stream parsers, Ollama, Claude API, OpenAI API, OpenRouter |

Tests: `tests/unit/ai.test.ts`, `tests/unit/ai-workspace.test.ts`, `tests/e2e/ai.spec.ts`,
and `cargo test` (including opt-in live tests that run the real CLIs:
`cargo test live_ -- --ignored`).
