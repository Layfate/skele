//! AI chat through the user's own command-line tools: Claude Code (`claude`) and Codex
//! (`codex`). Skele never sees a password or token: each tool uses the account it is already
//! signed in to. The page sends a prompt; this module runs the tool once per message, streams
//! its JSON output lines back over a channel, and can stop it. Only these two programs can be
//! started, never an arbitrary command, and every argument is built here from validated values.
//!
//! What a run may do is set by its access mode:
//! - `chat` (default): no tools at all, in a private empty folder (`<data dir>/ai`).
//! - `read`: read files in one folder the user picked (Claude: Read/Glob/Grep in `dontAsk`
//!   mode, which refuses reads outside the folder; Codex: its read-only sandbox).
//! - `edit`: also change files in that folder (Claude: `acceptEdits`, no shell; Codex: its
//!   `workspace-write` sandbox).
//!
//! Nothing ever waits for a permission prompt: anything a mode doesn't allow is refused
//! (`--permission-prompts none`) and reported back as a denial.

use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use tauri::ipc::Channel;
use tauri::State;

use crate::paths::DataLocation;

pub(crate) type CmdResult<T> = Result<T, String>;

/// Running CLI processes by run id, so a run can be stopped.
#[derive(Default, Clone)]
pub struct AiRuns(Arc<Mutex<HashMap<String, u32>>>);

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum Tool {
    Claude,
    Codex,
}

impl Tool {
    pub(crate) fn parse(s: &str) -> CmdResult<Tool> {
        match s {
            "claude" => Ok(Tool::Claude),
            "codex" => Ok(Tool::Codex),
            _ => Err(format!("Unknown tool: {s}")),
        }
    }
    pub(crate) fn name(self) -> &'static str {
        match self {
            Tool::Claude => "claude",
            Tool::Codex => "codex",
        }
    }
    pub(crate) fn label(self) -> &'static str {
        match self {
            Tool::Claude => "Claude Code",
            Tool::Codex => "Codex",
        }
    }
}

pub(crate) fn home() -> Option<PathBuf> {
    std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).map(PathBuf::from)
}

/// Claude Code's config folder (`CLAUDE_CONFIG_DIR`, else `~/.claude`).
pub(crate) fn claude_home() -> Option<PathBuf> {
    std::env::var_os("CLAUDE_CONFIG_DIR")
        .map(PathBuf::from)
        .or_else(|| home().map(|h| h.join(".claude")))
}

pub(crate) fn codex_home() -> Option<PathBuf> {
    std::env::var_os("CODEX_HOME")
        .map(PathBuf::from)
        .or_else(|| home().map(|h| h.join(".codex")))
}

/// Folders where the CLIs are commonly installed but that a GUI app's PATH may lack (macOS
/// apps started from Finder get a minimal PATH).
fn extra_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    let home = home();
    if cfg!(windows) {
        if let Some(appdata) = std::env::var_os("APPDATA") {
            dirs.push(PathBuf::from(appdata).join("npm"));
        }
        if let Some(local) = std::env::var_os("LOCALAPPDATA") {
            dirs.push(PathBuf::from(&local).join("Programs").join("Ollama"));
        }
        if let Some(h) = &home {
            dirs.push(h.join(".local").join("bin"));
            dirs.push(h.join(".bun").join("bin"));
        }
    } else {
        if let Some(h) = &home {
            for d in [
                ".local/bin",
                ".claude/local",
                ".npm-global/bin",
                ".bun/bin",
                ".volta/bin",
                ".cargo/bin",
            ] {
                dirs.push(h.join(d));
            }
            // nvm: newest installed Node version first.
            if let Ok(entries) = std::fs::read_dir(h.join(".nvm/versions/node")) {
                let mut versions: Vec<PathBuf> =
                    entries.flatten().map(|e| e.path().join("bin")).collect();
                versions.sort();
                versions.reverse();
                dirs.extend(versions);
            }
        }
        dirs.push(PathBuf::from("/opt/homebrew/bin"));
        dirs.push(PathBuf::from("/usr/local/bin"));
        dirs.push(PathBuf::from("/usr/bin"));
        if cfg!(target_os = "macos") {
            dirs.push(PathBuf::from("/Applications/Ollama.app/Contents/Resources"));
        }
    }
    dirs
}

pub(crate) fn search_dirs() -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).collect())
        .unwrap_or_default();
    for d in extra_dirs() {
        if !dirs.contains(&d) {
            dirs.push(d);
        }
    }
    dirs
}

/// PATH for the child: ours plus the extra folders (Codex's npm launcher needs `node`).
fn child_path(exe: &Path) -> Option<std::ffi::OsString> {
    let mut dirs = Vec::new();
    if let Some(parent) = exe.parent() {
        dirs.push(parent.to_path_buf());
    }
    dirs.extend(search_dirs());
    std::env::join_paths(dirs).ok()
}

/// Finds a program by name on PATH and in the common install folders (on Windows also
/// `.exe`, `.cmd` and `.bat`). Used for the CLIs, Ollama and MCP server commands.
pub(crate) fn which(name: &str) -> Option<PathBuf> {
    let as_path = Path::new(name);
    if as_path.is_absolute() {
        return as_path.is_file().then(|| as_path.to_path_buf());
    }
    if name.contains('/') || name.contains('\\') {
        return None;
    }
    let names: Vec<String> = if cfg!(windows) && as_path.extension().is_none() {
        ["exe", "cmd", "bat"]
            .iter()
            .map(|ext| format!("{name}.{ext}"))
            .collect()
    } else {
        vec![name.to_string()]
    };
    for dir in search_dirs() {
        for n in &names {
            let p = dir.join(n);
            if p.is_file() {
                return Some(p);
            }
        }
    }
    None
}

/// Finds the tool's executable: the user's override if set, else PATH and common folders.
pub(crate) fn find_tool(tool: Tool, custom: Option<&str>) -> Option<PathBuf> {
    if let Some(custom) = custom.map(str::trim).filter(|s| !s.is_empty()) {
        let p = PathBuf::from(custom);
        return p.is_file().then_some(p);
    }
    which(tool.name()).map(|p| prefer_native(tool, p))
}

/// npm installs Claude Code on Windows as a `.cmd` launcher around a real `claude.exe`;
/// starting the exe directly avoids cmd.exe argument quoting.
fn prefer_native(tool: Tool, path: PathBuf) -> PathBuf {
    if cfg!(windows)
        && tool == Tool::Claude
        && path
            .extension()
            .is_some_and(|e| e.eq_ignore_ascii_case("cmd"))
    {
        if let Some(dir) = path.parent() {
            let exe = dir
                .join("node_modules")
                .join("@anthropic-ai")
                .join("claude-code")
                .join("bin")
                .join("claude.exe");
            if exe.is_file() {
                return exe;
            }
        }
    }
    path
}

pub(crate) fn command(exe: &Path) -> Command {
    let mut cmd = Command::new(exe);
    if let Some(path) = child_path(exe) {
        cmd.env("PATH", path);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        // Own process group, so stopping a run also stops anything the tool started.
        cmd.process_group(0);
    }
    cmd
}

pub(crate) fn kill_tree(pid: u32) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let _ = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .creation_flags(0x0800_0000)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    #[cfg(unix)]
    {
        // The tool was started in its own process group (`process_group(0)`), whose id is its
        // pid: signal that group directly. Not via the `kill` program, which can read "-<pid>"
        // as an option and end up signalling pid -1, i.e. every process of this user.
        let Ok(pgid) = libc::pid_t::try_from(pid) else {
            return;
        };
        if pgid > 1 {
            // SAFETY: killpg only sends a signal; a group that's gone just returns ESRCH.
            unsafe {
                libc::killpg(pgid, libc::SIGTERM);
            }
        }
    }
}

/// Keeps a value safe to pass as a single command-line argument.
pub(crate) fn one_line(s: &str, max: usize) -> String {
    s.chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .take(max)
        .collect()
}

pub(crate) fn valid_token(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 120
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || "-_.:[]/".contains(c))
}

/// An MCP server name: letters, digits, `-` and `_` (both CLIs use it in tool names).
pub(crate) fn valid_server_name(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 64
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// Drops Windows' `\\?\` prefix from a canonical path; the CLIs don't all understand it.
pub(crate) fn plain_path(p: PathBuf) -> PathBuf {
    let s = p.to_string_lossy();
    if let Some(rest) = s.strip_prefix(r"\\?\") {
        if rest.chars().nth(1) == Some(':') {
            return PathBuf::from(rest);
        }
    }
    p
}

/// The folder a `read`/`edit` run works in. It must exist and be a folder, and it can't be
/// a drive root or the home folder itself (far too much to hand an agent).
pub(crate) fn validate_folder(raw: &str) -> CmdResult<PathBuf> {
    let raw = raw.trim();
    if raw.is_empty() {
        return Err("Choose a folder first.".into());
    }
    let p = Path::new(raw);
    if !p.is_absolute() {
        return Err("The folder must be a full path.".into());
    }
    let canon = plain_path(
        std::fs::canonicalize(p).map_err(|_| format!("The folder {raw} doesn't exist."))?,
    );
    if !canon.is_dir() {
        return Err(format!("{raw} isn't a folder."));
    }
    if canon.parent().is_none() {
        return Err("Pick a project folder, not a whole drive.".into());
    }
    if let Some(h) = home()
        .and_then(|h| std::fs::canonicalize(h).ok())
        .map(plain_path)
    {
        if h == canon {
            return Err(
                "Pick a project folder inside your home folder, not the home folder itself.".into(),
            );
        }
    }
    Ok(canon)
}

/// One MCP server Skele hands to a run (configured in Settings → AI → MCP servers).
#[derive(Deserialize, Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct McpServerSpec {
    pub name: String,
    /// "stdio", "http" or "sse".
    pub transport: String,
    pub command: String,
    pub args: Vec<String>,
    pub env: BTreeMap<String, String>,
    pub url: String,
    pub headers: BTreeMap<String, String>,
}

fn no_nul(s: &str) -> bool {
    !s.contains('\0')
}

impl McpServerSpec {
    pub(crate) fn validate(&self) -> CmdResult<()> {
        let bad = |what: &str| Err(format!("MCP server \"{}\": {what}", self.name));
        if !valid_server_name(&self.name) {
            return Err(format!(
                "Invalid MCP server name \"{}\": use letters, digits, - and _.",
                self.name
            ));
        }
        match self.transport.as_str() {
            "stdio" => {
                let c = self.command.trim();
                if c.is_empty() || c.len() > 1024 || c.chars().any(char::is_control) {
                    return bad("the command is missing or invalid.");
                }
                if self.args.len() > 64 || self.args.iter().any(|a| a.len() > 4096 || !no_nul(a)) {
                    return bad("too many or invalid arguments.");
                }
            }
            "http" | "sse" => {
                let u = self.url.trim();
                if !(u.starts_with("http://") || u.starts_with("https://"))
                    || u.len() > 2048
                    || u.chars().any(|c| c.is_whitespace() || c.is_control())
                {
                    return bad("the URL must start with http:// or https://.");
                }
                for (k, v) in &self.headers {
                    let key_ok = !k.is_empty()
                        && k.len() <= 128
                        && k.chars()
                            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
                    if !key_ok
                        || v.len() > 8192
                        || v.chars().any(|c| c == '\r' || c == '\n' || c == '\0')
                    {
                        return bad("invalid header.");
                    }
                }
            }
            _ => return bad("unknown transport."),
        }
        for (k, v) in &self.env {
            let key_ok = !k.is_empty()
                && k.len() <= 128
                && k.chars()
                    .next()
                    .is_some_and(|c| c.is_ascii_alphabetic() || c == '_')
                && k.chars().all(|c| c.is_ascii_alphanumeric() || c == '_');
            if !key_ok || v.len() > 16384 || !no_nul(v) {
                return bad("invalid environment variable.");
            }
        }
        Ok(())
    }

    /// Claude Code's `--mcp-config` entry.
    fn claude_json(&self) -> serde_json::Value {
        if self.transport == "stdio" {
            serde_json::json!({
                "type": "stdio",
                "command": self.command.trim(),
                "args": self.args,
                "env": self.env,
            })
        } else {
            serde_json::json!({
                "type": self.transport,
                "url": self.url.trim(),
                "headers": self.headers,
            })
        }
    }

    /// Codex `-c` overrides that define this server for one run.
    fn codex_overrides(&self) -> Vec<String> {
        let key = format!("mcp_servers.{}", self.name);
        let mut out = Vec::new();
        if self.transport == "stdio" {
            out.push(format!(
                "{key}.command={}",
                toml_string(self.command.trim())
            ));
            out.push(format!("{key}.args={}", toml_array(&self.args)));
            if !self.env.is_empty() {
                out.push(format!("{key}.env={}", toml_table(&self.env)));
            }
        } else {
            out.push(format!("{key}.url={}", toml_string(self.url.trim())));
            if !self.headers.is_empty() {
                out.push(format!("{key}.http_headers={}", toml_table(&self.headers)));
            }
        }
        out.push(format!("{key}.enabled=true"));
        out
    }
}

/// A TOML basic string (Codex parses `-c` values as TOML).
pub(crate) fn toml_string(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if c.is_control() => out.push_str(&format!("\\u{:04X}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

fn toml_array(items: &[String]) -> String {
    let parts: Vec<String> = items.iter().map(|s| toml_string(s)).collect();
    format!("[{}]", parts.join(", "))
}

fn toml_table(map: &BTreeMap<String, String>) -> String {
    let parts: Vec<String> = map
        .iter()
        .map(|(k, v)| format!("{} = {}", toml_string(k), toml_string(v)))
        .collect();
    format!("{{{}}}", parts.join(", "))
}

/// MCP servers configured in Codex's own `config.toml` (`[mcp_servers.<name>]` sections),
/// so a run can switch them off. Only plain names are returned.
pub(crate) fn codex_config_servers(config_toml: &str) -> Vec<String> {
    let mut names: Vec<String> = Vec::new();
    for line in config_toml.lines() {
        let t = line.trim();
        let Some(rest) = t.strip_prefix("[mcp_servers.") else {
            continue;
        };
        let name = if let Some(quoted) = rest.strip_prefix('"') {
            quoted.split('"').next().unwrap_or("")
        } else {
            rest.split(['.', ']']).next().unwrap_or("")
        };
        if valid_server_name(name) && !names.iter().any(|n| n == name) {
            names.push(name.to_string());
        }
    }
    names
}

/// Names of the MCP servers in Claude Code's user config (`~/.claude.json` → `mcpServers`).
pub(crate) fn claude_user_servers(claude_json: &str) -> Vec<String> {
    serde_json::from_str::<serde_json::Value>(claude_json)
        .ok()
        .and_then(|v| v.get("mcpServers").and_then(|m| m.as_object()).cloned())
        .map(|m| m.keys().filter(|k| valid_server_name(k)).cloned().collect())
        .unwrap_or_default()
}

fn claude_config_file() -> Option<PathBuf> {
    if let Some(dir) = std::env::var_os("CLAUDE_CONFIG_DIR") {
        return Some(PathBuf::from(dir).join(".claude.json"));
    }
    home().map(|h| h.join(".claude.json"))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliRunArgs {
    run_id: String,
    tool: String,
    prompt: String,
    model: Option<String>,
    effort: Option<String>,
    session_id: Option<String>,
    system_prompt: Option<String>,
    path: Option<String>,
    /// Don't keep a session on disk (used for the quick usage check).
    #[serde(default)]
    ephemeral: bool,
    /// "chat" (default), "read" or "edit".
    #[serde(default)]
    mode: Option<String>,
    /// The folder for "read" / "edit".
    #[serde(default)]
    folder: Option<String>,
    /// Allow web search and fetching pages.
    #[serde(default)]
    web: bool,
    /// MCP servers Skele adds for this run.
    #[serde(default)]
    mcp_servers: Vec<McpServerSpec>,
    /// Also use the CLI's own MCP servers, plugins and skills.
    #[serde(default)]
    use_cli_extensions: bool,
    /// Allow `/skill` commands (Claude Code) for this run.
    #[serde(default)]
    allow_skills: bool,
    /// Claude Code sub-agents: `{ "<name>": { "description", "prompt", "model"? } }`.
    #[serde(default)]
    agents: Option<serde_json::Value>,
    /// Images pasted into this message (base64).
    #[serde(default)]
    images: Vec<ImageInput>,
}

/// An image sent with a message: its type and its bytes as base64 (no `data:` prefix).
#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ImageInput {
    media_type: String,
    data: String,
}

const MAX_IMAGES: usize = 10;
/// Base64 length of one image (about 7.5 MB of image data).
const MAX_IMAGE_B64: usize = 10 * 1024 * 1024;

impl ImageInput {
    /// File extension for the image type, or an error for anything that isn't an image.
    fn extension(&self) -> CmdResult<&'static str> {
        match self.media_type.as_str() {
            "image/png" => Ok("png"),
            "image/jpeg" => Ok("jpg"),
            "image/gif" => Ok("gif"),
            "image/webp" => Ok("webp"),
            other => Err(format!("Unsupported image type: {other}")),
        }
    }
}

pub(crate) fn validate_images(images: &[ImageInput]) -> CmdResult<()> {
    if images.len() > MAX_IMAGES {
        return Err(format!("Send at most {MAX_IMAGES} images at a time."));
    }
    for img in images {
        img.extension()?;
        let ok = !img.data.is_empty()
            && img.data.len() <= MAX_IMAGE_B64
            && img
                .data
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'+' || b == b'/' || b == b'=');
        if !ok {
            return Err("An image is too large or isn't valid.".into());
        }
    }
    Ok(())
}

/// What's written to the CLI's stdin: the prompt, or (Claude Code with images) one
/// stream-json user message holding the images and the text.
pub(crate) fn stdin_payload(tool: Tool, a: &CliRunArgs) -> String {
    if tool != Tool::Claude || a.images.is_empty() {
        return a.prompt.clone();
    }
    let mut content: Vec<serde_json::Value> = a
        .images
        .iter()
        .map(|i| {
            serde_json::json!({
                "type": "image",
                "source": { "type": "base64", "media_type": i.media_type, "data": i.data },
            })
        })
        .collect();
    content.push(serde_json::json!({ "type": "text", "text": a.prompt }));
    let line = serde_json::json!({
        "type": "user",
        "message": { "role": "user", "content": content },
    });
    format!("{line}\n")
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliRunResult {
    exit_code: Option<i32>,
    stderr: String,
    cancelled: bool,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum Mode {
    Chat,
    Read,
    Edit,
}

impl Mode {
    fn parse(s: Option<&str>) -> CmdResult<Mode> {
        match s.unwrap_or("chat") {
            "" | "chat" => Ok(Mode::Chat),
            "read" => Ok(Mode::Read),
            "edit" => Ok(Mode::Edit),
            other => Err(format!("Unknown access mode: {other}")),
        }
    }
}

/// Files and names prepared outside `build_args` (so the argument building stays pure).
#[derive(Default)]
pub(crate) struct RunContext {
    /// Claude: file with the `--mcp-config` JSON.
    pub mcp_file: Option<PathBuf>,
    /// Claude: file with the `--agents` JSON.
    pub agents_file: Option<PathBuf>,
    /// The CLI's own MCP servers: switched off (Codex) or allowed (Claude) by name.
    pub cli_servers: Vec<String>,
    /// Codex: the message's images, written to files for `--image`.
    pub image_files: Vec<PathBuf>,
}

fn effort_for(tool: Tool, e: Option<&str>) -> Option<&str> {
    let allowed: &[&str] = match tool {
        Tool::Claude => &["low", "medium", "high", "xhigh", "max"],
        Tool::Codex => &["low", "medium", "high", "xhigh"],
    };
    e.filter(|e| allowed.contains(e))
}

pub(crate) fn build_args(tool: Tool, a: &CliRunArgs, ctx: &RunContext) -> CmdResult<Vec<String>> {
    let model = a.model.as_deref().map(str::trim).filter(|m| !m.is_empty());
    let effort = effort_for(tool, a.effort.as_deref());
    let session = a.session_id.as_deref().filter(|s| !s.is_empty());
    for v in [model, session].into_iter().flatten() {
        if !valid_token(v) {
            return Err(format!("Invalid value: {v}"));
        }
    }
    let mode = Mode::parse(a.mode.as_deref())?;
    for s in &a.mcp_servers {
        s.validate()?;
    }
    validate_images(&a.images)?;
    let mut args: Vec<String> = Vec::new();
    match tool {
        Tool::Claude => {
            args.extend(
                [
                    "-p",
                    "--output-format",
                    "stream-json",
                    "--verbose",
                    "--include-partial-messages",
                    // Never wait for a person: anything not allowed below is refused.
                    "--permission-prompts",
                    "none",
                ]
                .map(String::from),
            );
            let mut tools: Vec<&str> = match mode {
                Mode::Chat => vec![],
                Mode::Read => vec!["Read", "Glob", "Grep"],
                Mode::Edit => vec!["Read", "Glob", "Grep", "Edit", "Write", "NotebookEdit"],
            };
            let mut allowed: Vec<String> = Vec::new();
            if a.web {
                tools.extend(["WebSearch", "WebFetch"]);
                allowed.extend(["WebSearch".into(), "WebFetch".into()]);
            }
            if ctx.agents_file.is_some() {
                tools.push("Agent");
                allowed.push("Agent".into());
            }
            args.push("--tools".into());
            args.push(tools.join(","));
            args.push("--permission-mode".into());
            args.push(
                if mode == Mode::Edit {
                    "acceptEdits"
                } else {
                    "dontAsk"
                }
                .into(),
            );
            for s in &a.mcp_servers {
                allowed.push(format!("mcp__{}", s.name));
            }
            if a.use_cli_extensions {
                for s in &ctx.cli_servers {
                    allowed.push(format!("mcp__{s}"));
                }
            } else {
                args.push("--strict-mcp-config".into());
            }
            if let Some(f) = &ctx.mcp_file {
                args.push("--mcp-config".into());
                args.push(f.display().to_string());
            }
            if !allowed.is_empty() {
                args.push("--allowedTools".into());
                args.push(allowed.join(","));
            }
            if let Some(f) = &ctx.agents_file {
                args.push("--agents".into());
                args.push(f.display().to_string());
            }
            if !a.use_cli_extensions && !a.allow_skills {
                args.push("--disable-slash-commands".into());
            }
            if let Some(sp) = a.system_prompt.as_deref().filter(|s| !s.trim().is_empty()) {
                // Chat replaces Claude Code's coding prompt; tool modes keep it (it explains
                // the tools) and add Skele's.
                args.push(
                    if mode == Mode::Chat {
                        "--system-prompt"
                    } else {
                        "--append-system-prompt"
                    }
                    .into(),
                );
                args.push(one_line(sp, 8000));
            }
            if let Some(m) = model {
                args.push("--model".into());
                args.push(m.into());
            }
            if let Some(e) = effort {
                args.push("--effort".into());
                args.push(e.into());
            }
            if let Some(s) = session {
                args.push("--resume".into());
                args.push(s.into());
            }
            if a.ephemeral {
                args.push("--no-session-persistence".into());
            }
            if !a.images.is_empty() {
                // Images can only be sent as a stream-json message on stdin.
                args.push("--input-format".into());
                args.push("stream-json".into());
            }
        }
        Tool::Codex => {
            args.push("exec".into());
            if session.is_some() {
                args.push("resume".into());
            }
            args.extend(["--json", "--skip-git-repo-check"].map(String::from));
            let sandbox = if mode == Mode::Edit {
                "workspace-write"
            } else {
                "read-only"
            };
            let mut overrides = vec![
                format!("sandbox_mode={}", toml_string(sandbox)),
                format!("approval_policy={}", toml_string("never")),
                format!(
                    "web_search={}",
                    toml_string(if a.web { "live" } else { "disabled" })
                ),
            ];
            if !a.use_cli_extensions {
                // Codex has no "only these servers" switch: turn each configured one off.
                for s in &ctx.cli_servers {
                    if !a.mcp_servers.iter().any(|m| &m.name == s) {
                        overrides.push(format!("mcp_servers.{s}.enabled=false"));
                    }
                }
            }
            for s in &a.mcp_servers {
                overrides.extend(s.codex_overrides());
            }
            if let Some(e) = effort {
                overrides.push(format!("model_reasoning_effort={}", toml_string(e)));
            }
            for o in overrides {
                args.push("-c".into());
                args.push(o);
            }
            if !a.use_cli_extensions {
                // Connected apps (ChatGPT connectors) are tools too.
                args.push("--disable".into());
                args.push("apps".into());
            }
            if let Some(m) = model {
                args.push("-m".into());
                args.push(m.into());
            }
            if a.ephemeral {
                args.push("--ephemeral".into());
            }
            for f in &ctx.image_files {
                // `--image=<file>` (one value each) so the option can't swallow the session id.
                args.push(format!("--image={}", f.display()));
            }
            if let Some(s) = session {
                args.push(s.into());
            }
            args.push("-".into()); // prompt from stdin
        }
    }
    Ok(args)
}

/// Writes a private per-run file (MCP config, sub-agents) in `<data dir>/ai/runs`.
fn write_private(dir: &Path, name: &str, contents: &str) -> CmdResult<PathBuf> {
    write_private_bytes(dir, name, contents.as_bytes())
}

fn write_private_bytes(dir: &Path, name: &str, contents: &[u8]) -> CmdResult<PathBuf> {
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let path = dir.join(name);
    std::fs::write(&path, contents).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }
    Ok(path)
}

/// Removes the run's temporary files when the run ends, however it ends.
struct Cleanup(Vec<PathBuf>);
impl Drop for Cleanup {
    fn drop(&mut self) {
        for p in &self.0 {
            let _ = std::fs::remove_file(p);
        }
    }
}

/// Valid sub-agents only: a plain name, a description and a prompt each.
fn agents_json(v: &serde_json::Value) -> Option<String> {
    let obj = v.as_object()?;
    let mut out = serde_json::Map::new();
    for (name, def) in obj.iter().take(16) {
        let ok_name = !name.is_empty()
            && name.len() <= 64
            && name
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
        let desc = def
            .get("description")
            .and_then(|d| d.as_str())
            .unwrap_or("");
        let prompt = def.get("prompt").and_then(|d| d.as_str()).unwrap_or("");
        if !ok_name || desc.trim().is_empty() || prompt.trim().is_empty() {
            continue;
        }
        let mut agent = serde_json::json!({
            "description": desc.chars().take(1000).collect::<String>(),
            "prompt": prompt.chars().take(20000).collect::<String>(),
        });
        if let Some(m) = def
            .get("model")
            .and_then(|m| m.as_str())
            .filter(|m| valid_token(m))
        {
            agent["model"] = m.into();
        }
        out.insert(name.clone(), agent);
    }
    (!out.is_empty()).then(|| serde_json::Value::Object(out).to_string())
}

/// Runs one chat turn. Each stdout line (JSON) is sent to `on_event` as it arrives.
#[tauri::command]
pub async fn ai_cli_run(
    runs: State<'_, AiRuns>,
    location: State<'_, DataLocation>,
    args: CliRunArgs,
    on_event: Channel<String>,
) -> CmdResult<CliRunResult> {
    let tool = Tool::parse(&args.tool)?;
    if !valid_token(&args.run_id) {
        return Err("Invalid run id".into());
    }
    let exe = find_tool(tool, args.path.as_deref()).ok_or_else(|| {
        format!(
            "Couldn't find the `{}` command. Install it, or set its location in Settings → AI.",
            tool.name()
        )
    })?;
    let mode = Mode::parse(args.mode.as_deref())?;
    let private = location.root.join("ai");
    let workdir = match mode {
        Mode::Chat => {
            std::fs::create_dir_all(&private).map_err(|e| e.to_string())?;
            private.clone()
        }
        Mode::Read | Mode::Edit => validate_folder(args.folder.as_deref().unwrap_or(""))?,
    };

    let mut ctx = RunContext::default();
    let mut cleanup = Cleanup(Vec::new());
    let runs_dir = private.join("runs");
    match tool {
        Tool::Claude => {
            if !args.mcp_servers.is_empty() {
                for s in &args.mcp_servers {
                    s.validate()?;
                }
                let servers: serde_json::Map<String, serde_json::Value> = args
                    .mcp_servers
                    .iter()
                    .map(|s| (s.name.clone(), s.claude_json()))
                    .collect();
                let json = serde_json::json!({ "mcpServers": servers }).to_string();
                let f = write_private(&runs_dir, &format!("{}.mcp.json", args.run_id), &json)?;
                cleanup.0.push(f.clone());
                ctx.mcp_file = Some(f);
            }
            if let Some(json) = args.agents.as_ref().and_then(agents_json) {
                let f = write_private(&runs_dir, &format!("{}.agents.json", args.run_id), &json)?;
                cleanup.0.push(f.clone());
                ctx.agents_file = Some(f);
            }
            if args.use_cli_extensions {
                ctx.cli_servers = claude_config_file()
                    .and_then(|f| std::fs::read_to_string(f).ok())
                    .map(|t| claude_user_servers(&t))
                    .unwrap_or_default();
            }
        }
        Tool::Codex => {
            ctx.cli_servers = codex_home()
                .and_then(|h| std::fs::read_to_string(h.join("config.toml")).ok())
                .map(|t| codex_config_servers(&t))
                .unwrap_or_default();
            validate_images(&args.images)?;
            for (i, img) in args.images.iter().enumerate() {
                use base64::Engine;
                let bytes = base64::engine::general_purpose::STANDARD
                    .decode(img.data.as_bytes())
                    .map_err(|_| "An image isn't valid.".to_string())?;
                let name = format!("{}-{i}.{}", args.run_id, img.extension()?);
                let f = write_private_bytes(&runs_dir, &name, &bytes)?;
                cleanup.0.push(f.clone());
                ctx.image_files.push(f);
            }
        }
    }
    let cli_args = build_args(tool, &args, &ctx)?;
    let payload = stdin_payload(tool, &args);
    let runs = runs.inner().clone();

    tauri::async_runtime::spawn_blocking(move || -> CmdResult<CliRunResult> {
        let _cleanup = cleanup;
        let mut child = command(&exe)
            .args(&cli_args)
            .current_dir(&workdir)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Couldn't start {}: {e}", exe.display()))?;
        let pid = child.id();
        runs.0.lock().unwrap().insert(args.run_id.clone(), pid);

        let stdin = child.stdin.take();
        std::thread::spawn(move || {
            if let Some(mut stdin) = stdin {
                let _ = stdin.write_all(payload.as_bytes());
            }
        });
        let stderr = child.stderr.take();
        let stderr_reader = std::thread::spawn(move || {
            let mut buf = String::new();
            if let Some(mut s) = stderr {
                let _ = s.read_to_string(&mut buf);
            }
            tail(buf, 4000)
        });
        if let Some(stdout) = child.stdout.take() {
            for line in BufReader::new(stdout).lines() {
                let Ok(line) = line else { break };
                if line.trim().is_empty() {
                    continue;
                }
                if on_event.send(line).is_err() {
                    break;
                }
            }
        }
        let status = child.wait().map_err(|e| e.to_string())?;
        let cancelled = runs.0.lock().unwrap().remove(&args.run_id).is_none();
        Ok(CliRunResult {
            exit_code: status.code(),
            stderr: stderr_reader.join().unwrap_or_default(),
            cancelled,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// The last `max` bytes of `s` (that's where errors are), on a character boundary.
pub(crate) fn tail(mut s: String, max: usize) -> String {
    if s.len() > max {
        let cut = s.len() - max;
        let cut = (cut..s.len())
            .find(|i| s.is_char_boundary(*i))
            .unwrap_or(s.len());
        s = s[cut..].to_string();
    }
    s
}

/// Stops a running turn (and anything the tool started).
#[tauri::command]
pub fn ai_cli_cancel(runs: State<'_, AiRuns>, run_id: String) {
    let pid = runs.0.lock().unwrap().remove(&run_id);
    if let Some(pid) = pid {
        kill_tree(pid);
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliStatus {
    tool: String,
    path: Option<String>,
    version: Option<String>,
    error: Option<String>,
}

fn version_of(exe: &Path) -> (Option<String>, Option<String>) {
    match command(exe).arg("--version").stdin(Stdio::null()).output() {
        Ok(o) if o.status.success() => (
            Some(String::from_utf8_lossy(&o.stdout).trim().to_string()),
            None,
        ),
        Ok(o) => (
            None,
            Some(
                String::from_utf8_lossy(&o.stderr)
                    .trim()
                    .chars()
                    .take(400)
                    .collect(),
            ),
        ),
        Err(e) => (None, Some(e.to_string())),
    }
}

/// Whether each tool is installed, where, and which version. Also reports the `ollama`
/// program (its server is checked separately, see `ai_ollama.rs`).
#[tauri::command]
pub async fn ai_cli_status(paths: HashMap<String, String>) -> CmdResult<Vec<CliStatus>> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut out: Vec<CliStatus> = [Tool::Claude, Tool::Codex]
            .into_iter()
            .map(|tool| {
                let Some(exe) = find_tool(tool, paths.get(tool.name()).map(String::as_str)) else {
                    return CliStatus {
                        tool: tool.name().into(),
                        path: None,
                        version: None,
                        error: None,
                    };
                };
                let (version, error) = version_of(&exe);
                CliStatus {
                    tool: tool.name().into(),
                    path: Some(exe.display().to_string()),
                    version,
                    error,
                }
            })
            .collect();
        let ollama = crate::ai_ollama::find_ollama(paths.get("ollama").map(String::as_str));
        let (version, error) = ollama.as_deref().map(version_of).unwrap_or((None, None));
        out.push(CliStatus {
            tool: "ollama".into(),
            path: ollama.map(|p| p.display().to_string()),
            version,
            error,
        });
        out
    })
    .await
    .map_err(|e| e.to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliAuth {
    ok: bool,
    output: String,
}

/// Which account each tool is signed in to (`claude auth status --json`, `codex login status`).
#[tauri::command]
pub async fn ai_cli_auth(tool: String, path: Option<String>) -> CmdResult<CliAuth> {
    let tool = Tool::parse(&tool)?;
    let exe = find_tool(tool, path.as_deref())
        .ok_or_else(|| format!("Couldn't find the `{}` command.", tool.name()))?;
    let args: &'static [&'static str] = match tool {
        Tool::Claude => &["auth", "status", "--json"],
        Tool::Codex => &["login", "status"],
    };
    tauri::async_runtime::spawn_blocking(move || {
        let out = command(&exe)
            .args(args)
            .stdin(Stdio::null())
            .output()
            .map_err(|e| e.to_string())?;
        let mut text = String::from_utf8_lossy(&out.stdout).trim().to_string();
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        if !err.is_empty() {
            if !text.is_empty() {
                text.push('\n');
            }
            text.push_str(&err);
        }
        Ok(CliAuth {
            ok: out.status.success(),
            output: text.chars().take(4000).collect(),
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Sub-folders of `dir`, newest name first (Codex sorts sessions into YYYY/MM/DD folders).
fn dirs_desc(dir: &Path) -> Vec<PathBuf> {
    let mut v: Vec<PathBuf> = std::fs::read_dir(dir)
        .map(|r| {
            r.flatten()
                .map(|e| e.path())
                .filter(|p| p.is_dir())
                .collect()
        })
        .unwrap_or_default();
    v.sort();
    v.reverse();
    v
}

/// The newest rate-limit reading in Codex's session logs (`~/.codex/sessions`): how much of
/// the 5-hour and weekly limits is used. Codex records one after every turn.
pub fn latest_codex_rate_limits(home: &Path) -> Option<serde_json::Value> {
    let mut days = Vec::new();
    'outer: for year in dirs_desc(&home.join("sessions")) {
        for month in dirs_desc(&year) {
            days.extend(dirs_desc(&month));
            if days.len() >= 14 {
                break 'outer;
            }
        }
    }
    for day in days.into_iter().take(14) {
        let mut files: Vec<(std::time::SystemTime, PathBuf)> = std::fs::read_dir(&day)
            .map(|r| {
                r.flatten()
                    .filter(|e| e.path().extension().is_some_and(|x| x == "jsonl"))
                    .filter_map(|e| Some((e.metadata().ok()?.modified().ok()?, e.path())))
                    .collect()
            })
            .unwrap_or_default();
        files.sort();
        files.reverse();
        for (_, file) in files.into_iter().take(20) {
            let Ok(text) = std::fs::read_to_string(&file) else {
                continue;
            };
            for line in text.lines().rev() {
                if !line.contains("\"rate_limits\"") {
                    continue;
                }
                let Ok(v) = serde_json::from_str::<serde_json::Value>(line) else {
                    continue;
                };
                let limits = &v["payload"]["rate_limits"];
                if limits.is_object() {
                    return Some(
                        serde_json::json!({ "rateLimits": limits, "timestamp": v["timestamp"] }),
                    );
                }
            }
        }
    }
    None
}

#[tauri::command]
pub async fn ai_codex_usage() -> CmdResult<Option<serde_json::Value>> {
    tauri::async_runtime::spawn_blocking(|| codex_home().and_then(|h| latest_codex_rate_limits(&h)))
        .await
        .map_err(|e| e.to_string())
}

/// Models Codex offers to this account, from its own cache (`~/.codex/models_cache.json`).
pub fn codex_models_from(cache: &str) -> Vec<serde_json::Value> {
    let Ok(v) = serde_json::from_str::<serde_json::Value>(cache) else {
        return Vec::new();
    };
    v["models"]
        .as_array()
        .map(|models| {
            models
                .iter()
                .filter(|m| m["visibility"].as_str().is_none_or(|vis| vis == "list"))
                .filter_map(|m| {
                    let slug = m["slug"].as_str().filter(|s| valid_token(s))?;
                    Some(serde_json::json!({
                        "id": slug,
                        "label": m["display_name"].as_str().unwrap_or(slug),
                        "hint": m["description"].as_str().unwrap_or(""),
                    }))
                })
                .collect()
        })
        .unwrap_or_default()
}

#[tauri::command]
pub async fn ai_codex_models() -> CmdResult<Vec<serde_json::Value>> {
    tauri::async_runtime::spawn_blocking(|| {
        codex_home()
            .and_then(|h| std::fs::read_to_string(h.join("models_cache.json")).ok())
            .map(|t| codex_models_from(&t))
            .unwrap_or_default()
    })
    .await
    .map_err(|e| e.to_string())
}

/// Native folder picker for the folder a chat may read or edit.
#[tauri::command]
pub async fn ai_pick_folder(app: tauri::AppHandle) -> CmdResult<Option<String>> {
    use tauri_plugin_dialog::DialogExt;
    let Some(picked) = app.dialog().file().blocking_pick_folder() else {
        return Ok(None);
    };
    let path = picked.into_path().map_err(|e| e.to_string())?;
    validate_folder(&path.display().to_string()).map(|p| Some(p.display().to_string()))
}

/// Checks a folder typed or pasted by the user (same rules as the picker).
#[tauri::command]
pub fn ai_check_folder(path: String) -> CmdResult<String> {
    validate_folder(&path).map(|p| p.display().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run_args(tool: &str, session: Option<&str>, model: Option<&str>) -> CliRunArgs {
        CliRunArgs {
            run_id: "r1".into(),
            tool: tool.into(),
            prompt: "hi".into(),
            model: model.map(String::from),
            effort: Some("high".into()),
            session_id: session.map(String::from),
            system_prompt: Some("Be\nhelpful".into()),
            path: None,
            ephemeral: false,
            mode: None,
            folder: None,
            web: false,
            mcp_servers: vec![],
            use_cli_extensions: false,
            allow_skills: false,
            agents: None,
            images: vec![],
        }
    }

    fn png() -> ImageInput {
        ImageInput {
            media_type: "image/png".into(),
            data: "iVBORw0KGgo=".into(),
        }
    }

    #[test]
    fn claude_images_go_as_stream_json() {
        let mut a = run_args("claude", None, None);
        a.images = vec![png()];
        let args = build(Tool::Claude, &a);
        assert!(pair(&args, "--input-format", "stream-json"));
        let line: serde_json::Value =
            serde_json::from_str(stdin_payload(Tool::Claude, &a).trim()).unwrap();
        assert_eq!(line["type"], "user");
        let content = line["message"]["content"].as_array().unwrap();
        assert_eq!(content[0]["type"], "image");
        assert_eq!(content[0]["source"]["media_type"], "image/png");
        assert_eq!(content[1]["text"], "hi");
        // Without images the prompt is sent as plain text.
        let plain = run_args("claude", None, None);
        assert_eq!(stdin_payload(Tool::Claude, &plain), "hi");
        assert!(!build(Tool::Claude, &plain).contains(&"--input-format".to_string()));
    }

    #[test]
    fn codex_images_are_files_before_the_session() {
        let a = run_args("codex", Some("sess-1"), None);
        let ctx = RunContext {
            image_files: vec![PathBuf::from("img-0.png")],
            ..Default::default()
        };
        let args = build_args(Tool::Codex, &a, &ctx).unwrap();
        let img = args.iter().position(|x| x == "--image=img-0.png").unwrap();
        let sess = args.iter().position(|x| x == "sess-1").unwrap();
        assert!(img < sess);
        assert_eq!(args.last().unwrap(), "-");
    }

    #[test]
    fn rejects_bad_images() {
        let mut bad = png();
        bad.media_type = "text/html".into();
        assert!(validate_images(&[bad]).is_err());
        let mut junk = png();
        junk.data = "<script>".into();
        assert!(validate_images(&[junk]).is_err());
        assert!(validate_images(&vec![png(); 11]).is_err());
        assert!(validate_images(&[png()]).is_ok());
    }

    fn build(tool: Tool, a: &CliRunArgs) -> Vec<String> {
        build_args(tool, a, &RunContext::default()).unwrap()
    }

    fn pair(a: &[String], k: &str, v: &str) -> bool {
        a.windows(2).any(|w| w[0] == k && w[1] == v)
    }

    #[test]
    fn claude_chat_has_no_tools_and_resumes() {
        let a = build(
            Tool::Claude,
            &run_args("claude", Some("abc-123"), Some("sonnet")),
        );
        assert!(pair(&a, "--tools", ""));
        assert!(pair(&a, "--resume", "abc-123"));
        assert!(pair(&a, "--system-prompt", "Be helpful"));
        assert!(pair(&a, "--effort", "high"));
        assert!(pair(&a, "--permission-mode", "dontAsk"));
        assert!(pair(&a, "--permission-prompts", "none"));
        assert!(a.contains(&"--strict-mcp-config".to_string()));
        assert!(a.contains(&"--disable-slash-commands".to_string()));
        assert!(!a.contains(&"--allowedTools".to_string()));
    }

    #[test]
    fn claude_modes_choose_tools_and_permissions() {
        let mut r = run_args("claude", None, None);
        r.mode = Some("read".into());
        let a = build(Tool::Claude, &r);
        assert!(pair(&a, "--tools", "Read,Glob,Grep"));
        assert!(pair(&a, "--permission-mode", "dontAsk"));
        assert!(pair(&a, "--append-system-prompt", "Be helpful"));

        r.mode = Some("edit".into());
        r.web = true;
        let a = build(Tool::Claude, &r);
        assert!(pair(
            &a,
            "--tools",
            "Read,Glob,Grep,Edit,Write,NotebookEdit,WebSearch,WebFetch"
        ));
        assert!(pair(&a, "--permission-mode", "acceptEdits"));
        assert!(pair(&a, "--allowedTools", "WebSearch,WebFetch"));
        assert!(!a.iter().any(|x| x.contains("Bash")));

        r.mode = Some("root".into());
        assert!(build_args(Tool::Claude, &r, &RunContext::default()).is_err());
    }

    #[test]
    fn claude_mcp_servers_agents_and_extensions() {
        let mut r = run_args("claude", None, None);
        r.mcp_servers = vec![McpServerSpec {
            name: "fetch".into(),
            transport: "stdio".into(),
            command: "uvx".into(),
            args: vec!["mcp-server-fetch".into()],
            ..Default::default()
        }];
        let ctx = RunContext {
            mcp_file: Some(PathBuf::from("m.json")),
            agents_file: Some(PathBuf::from("a.json")),
            cli_servers: vec!["blender".into()],
            ..Default::default()
        };
        let a = build_args(Tool::Claude, &r, &ctx).unwrap();
        assert!(pair(&a, "--mcp-config", "m.json"));
        assert!(pair(&a, "--agents", "a.json"));
        assert!(pair(&a, "--tools", "Agent"));
        assert!(pair(&a, "--allowedTools", "Agent,mcp__fetch"));
        assert!(a.contains(&"--strict-mcp-config".to_string()));

        r.use_cli_extensions = true;
        let a = build_args(Tool::Claude, &r, &ctx).unwrap();
        assert!(pair(&a, "--allowedTools", "Agent,mcp__fetch,mcp__blender"));
        assert!(!a.contains(&"--strict-mcp-config".to_string()));
        assert!(!a.contains(&"--disable-slash-commands".to_string()));
    }

    #[test]
    fn codex_args_are_sandboxed_and_resume() {
        let a = build(Tool::Codex, &run_args("codex", Some("0199-ab"), None));
        assert_eq!(&a[..2], ["exec", "resume"]);
        assert!(pair(&a, "-c", "sandbox_mode=\"read-only\""));
        assert!(pair(&a, "-c", "approval_policy=\"never\""));
        assert!(pair(&a, "-c", "web_search=\"disabled\""));
        assert!(pair(&a, "--disable", "apps"));
        assert_eq!(a[a.len() - 2..], ["0199-ab", "-"]);
        let fresh = build(Tool::Codex, &run_args("codex", None, None));
        assert_eq!(fresh[1], "--json");

        let mut e = run_args("codex", None, None);
        e.mode = Some("edit".into());
        e.web = true;
        let a = build(Tool::Codex, &e);
        assert!(pair(&a, "-c", "sandbox_mode=\"workspace-write\""));
        assert!(pair(&a, "-c", "web_search=\"live\""));
    }

    #[test]
    fn codex_switches_off_its_own_servers_and_adds_skeles() {
        let mut r = run_args("codex", None, None);
        r.mcp_servers = vec![McpServerSpec {
            name: "docs".into(),
            transport: "http".into(),
            url: "https://example.com/mcp".into(),
            headers: BTreeMap::from([("Authorization".into(), "Bearer \"x\"".into())]),
            ..Default::default()
        }];
        let ctx = RunContext {
            cli_servers: vec!["blender".into(), "docs".into()],
            ..Default::default()
        };
        let a = build_args(Tool::Codex, &r, &ctx).unwrap();
        assert!(pair(&a, "-c", "mcp_servers.blender.enabled=false"));
        assert!(!a.contains(&"mcp_servers.docs.enabled=false".to_string()));
        assert!(pair(
            &a,
            "-c",
            "mcp_servers.docs.url=\"https://example.com/mcp\""
        ));
        assert!(pair(
            &a,
            "-c",
            "mcp_servers.docs.http_headers={\"Authorization\" = \"Bearer \\\"x\\\"\"}"
        ));
        r.use_cli_extensions = true;
        let a = build_args(Tool::Codex, &r, &ctx).unwrap();
        assert!(!a.contains(&"mcp_servers.blender.enabled=false".to_string()));
        assert!(!a.contains(&"apps".to_string()));
    }

    #[test]
    fn reads_server_names_from_cli_configs() {
        let toml = "model = \"x\"\n[mcp_servers.blender]\ncommand = \"uvx\"\n[mcp_servers.blender.env]\nA = \"1\"\n[mcp_servers.\"Roblox_Studio\"]\n[mcp_servers.\"bad name\"]\n[profiles.x]\n";
        assert_eq!(codex_config_servers(toml), vec!["blender", "Roblox_Studio"]);
        let json = r#"{"numStartups":3,"mcpServers":{"fetch":{"command":"uvx"},"bad name":{}}}"#;
        assert_eq!(claude_user_servers(json), vec!["fetch"]);
        assert!(claude_user_servers("not json").is_empty());
    }

    #[test]
    fn validates_mcp_servers() {
        let ok = McpServerSpec {
            name: "files".into(),
            transport: "stdio".into(),
            command: "npx".into(),
            env: BTreeMap::from([("API_KEY".into(), "v".into())]),
            ..Default::default()
        };
        assert!(ok.validate().is_ok());
        let mut bad = ok.clone();
        bad.name = "a.b".into();
        assert!(bad.validate().is_err());
        let mut bad = ok.clone();
        bad.env.insert("1X".into(), "v".into());
        assert!(bad.validate().is_err());
        let http = McpServerSpec {
            name: "h".into(),
            transport: "http".into(),
            url: "file:///etc/passwd".into(),
            ..Default::default()
        };
        assert!(http.validate().is_err());
        let mut hdr = http.clone();
        hdr.url = "https://x.dev/mcp".into();
        hdr.headers.insert("X".into(), "a\r\nInjected: 1".into());
        assert!(hdr.validate().is_err());
    }

    #[test]
    fn toml_strings_escape() {
        assert_eq!(toml_string("a\"b\\c\nd"), "\"a\\\"b\\\\c\\nd\"");
        assert_eq!(toml_string("\u{1}"), "\"\\u0001\"");
    }

    #[test]
    fn folder_rules() {
        let dir = tempfile::tempdir().unwrap();
        let ok = validate_folder(&dir.path().display().to_string()).unwrap();
        assert!(ok.is_dir());
        assert!(validate_folder("relative/path").is_err());
        assert!(validate_folder(&dir.path().join("missing").display().to_string()).is_err());
        let file = dir.path().join("f.txt");
        std::fs::write(&file, "x").unwrap();
        assert!(validate_folder(&file.display().to_string()).is_err());
        let root = if cfg!(windows) { "C:\\" } else { "/" };
        assert!(validate_folder(root).is_err());
        if let Some(h) = home() {
            assert!(validate_folder(&h.display().to_string()).is_err());
        }
    }

    #[test]
    fn sub_agents_are_cleaned() {
        let v = serde_json::json!({
            "reviewer": { "description": "Reviews", "prompt": "You review.", "model": "sonnet" },
            "no prompt": { "description": "x" },
            "bad name!": { "description": "x", "prompt": "y" },
        });
        let out: serde_json::Value = serde_json::from_str(&agents_json(&v).unwrap()).unwrap();
        assert_eq!(out.as_object().unwrap().len(), 1);
        assert_eq!(out["reviewer"]["model"], "sonnet");
        assert!(agents_json(&serde_json::json!({})).is_none());
    }

    #[test]
    fn reads_codex_models() {
        let cache = r#"{"models":[{"slug":"gpt-x","display_name":"GPT X","description":"Fast","visibility":"list"},{"slug":"hidden","visibility":"hide"},{"slug":"bad slug"}]}"#;
        let m = codex_models_from(cache);
        assert_eq!(m.len(), 1);
        assert_eq!(m[0]["id"], "gpt-x");
        assert!(codex_models_from("{}").is_empty());
    }

    #[test]
    fn finds_newest_codex_rate_limits() {
        let home = tempfile::tempdir().unwrap();
        let day = home
            .path()
            .join("sessions")
            .join("2026")
            .join("11")
            .join("14");
        std::fs::create_dir_all(&day).unwrap();
        let line = |pct: u32| {
            serde_json::json!({
                "timestamp": format!("t{pct}"),
                "type": "event_msg",
                "payload": { "type": "token_count", "rate_limits": { "primary": { "used_percent": pct } } }
            })
            .to_string()
        };
        let text = format!("{}\n{}\n{{\"x\":1}}\n", line(10), line(17));
        std::fs::write(day.join("a.jsonl"), text).unwrap();
        let found = latest_codex_rate_limits(home.path()).unwrap();
        assert_eq!(found["rateLimits"]["primary"]["used_percent"], 17);
        assert_eq!(found["timestamp"], "t17");
        assert!(latest_codex_rate_limits(&home.path().join("missing")).is_none());
    }

    #[test]
    fn ephemeral_runs_keep_no_session() {
        let mut a = run_args("claude", None, None);
        a.ephemeral = true;
        assert!(build(Tool::Claude, &a).contains(&"--no-session-persistence".to_string()));
        let mut c = run_args("codex", None, None);
        c.ephemeral = true;
        assert!(build(Tool::Codex, &c).contains(&"--ephemeral".to_string()));
    }

    /// Runs the real CLI with the arguments Skele builds (opt-in: it uses your account).
    /// `cargo test live_ -- --ignored --nocapture`
    fn live(
        tool: Tool,
        mut a: CliRunArgs,
        ctx: RunContext,
        cwd: &Path,
    ) -> (String, String, Option<i32>) {
        a.model = Some(if tool == Tool::Claude { "haiku" } else { "" }.into())
            .filter(|m: &String| !m.is_empty());
        a.effort = Some("low".into());
        a.ephemeral = true;
        let exe = find_tool(tool, None).expect("CLI not installed");
        let args = build_args(tool, &a, &ctx).unwrap();
        let mut child = command(&exe)
            .args(&args)
            .current_dir(cwd)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        child
            .stdin
            .take()
            .unwrap()
            .write_all(stdin_payload(tool, &a).as_bytes())
            .unwrap();
        let out = child.wait_with_output().unwrap();
        (
            String::from_utf8_lossy(&out.stdout).to_string(),
            String::from_utf8_lossy(&out.stderr).to_string(),
            out.status.code(),
        )
    }

    #[test]
    #[ignore]
    fn live_claude_read_mode_mcp_and_agents() {
        let dir = tempfile::tempdir().unwrap();
        let folder = validate_folder(&dir.path().display().to_string()).unwrap();
        std::fs::write(folder.join("note.txt"), "the secret word is pineapple").unwrap();
        let mut a = run_args("claude", None, None);
        a.prompt = "Read note.txt and reply with only the secret word.".into();
        a.mode = Some("read".into());
        a.mcp_servers = vec![McpServerSpec {
            name: "skele-test".into(),
            transport: "stdio".into(),
            command: "node".into(),
            args: vec!["-e".into(), "process.stdin.resume()".into()],
            ..Default::default()
        }];
        let runs = folder.join(".runs");
        let mcp = write_private(
            &runs,
            "t.mcp.json",
            &serde_json::json!({ "mcpServers": { "skele-test": a.mcp_servers[0].claude_json() } })
                .to_string(),
        )
        .unwrap();
        let agents = write_private(
            &runs,
            "t.agents.json",
            &agents_json(
                &serde_json::json!({ "helper": { "description": "Helps", "prompt": "You help." } }),
            )
            .unwrap(),
        )
        .unwrap();
        let ctx = RunContext {
            mcp_file: Some(mcp),
            agents_file: Some(agents),
            cli_servers: vec![],
            ..Default::default()
        };
        let (out, err, code) = live(Tool::Claude, a, ctx, &folder);
        println!("{err}");
        assert_eq!(code, Some(0), "{err}");
        let init = out
            .lines()
            .find(|l| l.contains("\"subtype\":\"init\""))
            .expect("no init event");
        let init: serde_json::Value = serde_json::from_str(init).unwrap();
        let tools: Vec<&str> = init["tools"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|t| t.as_str())
            .collect();
        assert!(
            tools.contains(&"Read") && !tools.contains(&"Bash") && !tools.contains(&"Write"),
            "{tools:?}"
        );
        assert!(init["agents"]
            .as_array()
            .unwrap()
            .iter()
            .any(|x| x == "helper"));
        assert!(init["mcp_servers"]
            .as_array()
            .unwrap()
            .iter()
            .any(|s| s["name"] == "skele-test"));
        let result = out
            .lines()
            .rev()
            .find(|l| l.contains("\"type\":\"result\""))
            .unwrap();
        assert!(result.to_lowercase().contains("pineapple"), "{result}");
    }

    #[test]
    #[ignore]
    fn live_codex_read_only_with_overrides() {
        let dir = tempfile::tempdir().unwrap();
        let folder = validate_folder(&dir.path().display().to_string()).unwrap();
        std::fs::write(folder.join("note.txt"), "the secret word is mango").unwrap();
        let mut a = run_args("codex", None, None);
        a.prompt = "Read note.txt in the current folder and reply with only the secret word. Don't change any files.".into();
        a.mode = Some("read".into());
        a.mcp_servers = vec![McpServerSpec {
            name: "skele-test".into(),
            transport: "http".into(),
            url: "https://example.invalid/mcp".into(),
            headers: BTreeMap::from([("X-Test".into(), "a \"quoted\" value".into())]),
            ..Default::default()
        }];
        let cli_servers = codex_home()
            .and_then(|h| std::fs::read_to_string(h.join("config.toml")).ok())
            .map(|t| codex_config_servers(&t))
            .unwrap_or_default();
        let (out, err, code) = live(
            Tool::Codex,
            a,
            RunContext {
                cli_servers,
                ..Default::default()
            },
            &folder,
        );
        println!(
            "{out}
{err}"
        );
        assert_eq!(code, Some(0), "{err}");
        assert!(out.to_lowercase().contains("mango"), "{out}");
        assert!(out.contains("turn.completed"));
        assert_eq!(
            std::fs::read_dir(&folder).unwrap().count(),
            1,
            "Codex changed files in read-only mode"
        );
    }

    /// Stopping a run signals only that run's process group (CI caught `kill -TERM -<pid>`
    /// signalling every process of the user on Linux).
    #[cfg(unix)]
    #[test]
    fn kill_tree_stops_only_the_group() {
        let mut child = command(Path::new("/bin/sh"))
            .args(["-c", "sleep 30 & sleep 30"])
            .spawn()
            .unwrap();
        let started = std::time::Instant::now();
        kill_tree(child.id());
        let status = child.wait().unwrap();
        assert!(!status.success());
        assert!(started.elapsed() < std::time::Duration::from_secs(10));
        kill_tree(0); // ignored, never "every process"
        kill_tree(1);
    }

    #[test]
    fn rejects_unsafe_values() {
        let ctx = RunContext::default();
        assert!(build_args(
            Tool::Claude,
            &run_args("claude", Some("x; rm -rf /"), None),
            &ctx
        )
        .is_err());
        assert!(build_args(Tool::Codex, &run_args("codex", None, Some("a b")), &ctx).is_err());
        assert!(Tool::parse("bash").is_err());
    }

    /// A 16×16 solid red PNG.
    const RED_PNG: &str = "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAF0lEQVR4nGP4z8BAEiJN9aiGUQ1DSgMAkPn/Afnh+ngAAAAASUVORK5CYII=";

    #[test]
    #[ignore]
    fn live_claude_sees_an_image() {
        let folder = tempfile::tempdir().unwrap();
        let mut a = run_args("claude", None, None);
        a.prompt = "What single colour fills this image? Answer with one lowercase word.".into();
        a.images = vec![ImageInput {
            media_type: "image/png".into(),
            data: RED_PNG.into(),
        }];
        let (out, err, code) = live(Tool::Claude, a, RunContext::default(), folder.path());
        println!("{err}");
        assert_eq!(code, Some(0));
        assert!(out.to_lowercase().contains("red"), "{out}");
    }

    #[test]
    #[ignore]
    fn live_codex_sees_an_image() {
        let folder = tempfile::tempdir().unwrap();
        let file = folder.path().join("red.png");
        use base64::Engine;
        std::fs::write(
            &file,
            base64::engine::general_purpose::STANDARD
                .decode(RED_PNG)
                .unwrap(),
        )
        .unwrap();
        let mut a = run_args("codex", None, None);
        a.prompt =
            "What single colour fills the attached image? Answer with one lowercase word.".into();
        let ctx = RunContext {
            image_files: vec![file],
            ..Default::default()
        };
        let (out, err, code) = live(Tool::Codex, a, ctx, folder.path());
        println!("{err}");
        assert_eq!(code, Some(0));
        assert!(out.to_lowercase().contains("red"), "{out}");
    }
}
