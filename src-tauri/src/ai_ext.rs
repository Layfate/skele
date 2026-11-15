//! Extensions for the AI workspace: plugins and plugin marketplaces (through the CLIs' own
//! `plugin` commands), the MCP servers each CLI already has configured (read-only, secrets
//! masked), a connection test for MCP servers, and skills (`SKILL.md` folders in
//! `~/.claude/skills` and `~/.codex/skills`).
//!
//! Like `ai.rs`, nothing here runs an arbitrary command line: each action maps to one fixed
//! CLI subcommand, and every value passed to it is validated first (never starting with `-`,
//! so it can't be read as an option). Skill files are only ever written inside the two
//! skills folders.

use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::time::{Duration, Instant};

use crate::ai::{
    claude_home, codex_home, command, find_tool, home, kill_tree, tail, which, CmdResult,
    McpServerSpec, Tool,
};

// ── Running a CLI subcommand ────────────────────────────────────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Captured {
    ok: bool,
    code: Option<i32>,
    stdout: String,
    stderr: String,
    timed_out: bool,
}

/// Runs a command to completion (or until `timeout`), capturing its output.
fn capture(mut cmd: Command, timeout: Duration) -> CmdResult<Captured> {
    let mut child = cmd
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Couldn't start the command: {e}"))?;
    let read = |s: Option<Box<dyn Read + Send>>| {
        std::thread::spawn(move || {
            let mut buf = Vec::new();
            if let Some(mut s) = s {
                let _ = s.read_to_end(&mut buf);
            }
            String::from_utf8_lossy(&buf).to_string()
        })
    };
    let out = read(
        child
            .stdout
            .take()
            .map(|s| Box::new(s) as Box<dyn Read + Send>),
    );
    let err = read(
        child
            .stderr
            .take()
            .map(|s| Box::new(s) as Box<dyn Read + Send>),
    );
    let start = Instant::now();
    let mut timed_out = false;
    let status = loop {
        if let Some(s) = child.try_wait().map_err(|e| e.to_string())? {
            break Some(s);
        }
        if start.elapsed() > timeout {
            timed_out = true;
            kill_tree(child.id());
            let _ = child.wait();
            break None;
        }
        std::thread::sleep(Duration::from_millis(100));
    };
    let code = status.and_then(|s| s.code());
    Ok(Captured {
        ok: status.is_some_and(|s| s.success()),
        code,
        stdout: tail(out.join().unwrap_or_default(), 2_000_000),
        stderr: tail(strip_ansi(&err.join().unwrap_or_default()), 8000),
        timed_out,
    })
}

fn strip_ansi(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\x1b' && chars.peek() == Some(&'[') {
            chars.next();
            for d in chars.by_ref() {
                if d.is_ascii_alphabetic() {
                    break;
                }
            }
        } else {
            out.push(c);
        }
    }
    out
}

/// `plugin` / `plugin@marketplace`.
fn valid_plugin_id(s: &str) -> bool {
    let part = |p: &str| {
        !p.is_empty()
            && p.len() <= 100
            && p.chars().next().is_some_and(|c| c.is_ascii_alphanumeric())
            && p.chars()
                .all(|c| c.is_ascii_alphanumeric() || "._-".contains(c))
    };
    match s.split_once('@') {
        Some((a, b)) => part(a) && part(b),
        None => part(s),
    }
}

fn valid_name(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 100
        && s.chars().next().is_some_and(|c| c.is_ascii_alphanumeric())
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || "._-".contains(c))
}

/// A marketplace source: `owner/repo[@ref]`, an https/ssh Git URL, or a local folder.
fn valid_source(s: &str) -> bool {
    let s = s.trim();
    if s.is_empty() || s.len() > 500 || s.starts_with('-') || s.chars().any(|c| c.is_control()) {
        return false;
    }
    if s.starts_with("https://") || s.starts_with("git@") || s.starts_with("ssh://") {
        return !s.chars().any(char::is_whitespace);
    }
    if Path::new(s).is_absolute() {
        return Path::new(s).is_dir();
    }
    // owner/repo[@ref]
    let (repo, reference) = s.split_once('@').unwrap_or((s, ""));
    let mut parts = repo.split('/');
    let (Some(owner), Some(name), None) = (parts.next(), parts.next(), parts.next()) else {
        return false;
    };
    valid_name(owner) && valid_name(name) && (reference.is_empty() || valid_name(reference))
}

#[derive(Deserialize, Debug)]
#[serde(tag = "action", rename_all = "camelCase")]
pub enum ManageAction {
    PluginList,
    #[serde(rename_all = "camelCase")]
    PluginInstall {
        id: String,
        /// Claude Code: accept the install command a marketplace declares, by its sha256
        /// (shown to the user first).
        accept_command: Option<String>,
    },
    PluginUninstall {
        id: String,
    },
    PluginEnable {
        id: String,
    },
    PluginDisable {
        id: String,
    },
    PluginUpdate {
        id: String,
    },
    MarketplaceList,
    MarketplaceAdd {
        source: String,
    },
    MarketplaceRemove {
        name: String,
    },
    MarketplaceUpdate,
}

/// The CLI arguments for one management action (pure, so it can be tested).
fn manage_args(tool: Tool, action: &ManageAction) -> CmdResult<Vec<String>> {
    let id_ok = |id: &str| {
        if valid_plugin_id(id) {
            Ok(id.to_string())
        } else {
            Err(format!("Invalid plugin id: {id}"))
        }
    };
    let unsupported = || Err(format!("{} doesn't support that.", tool.label()));
    let v = |a: &[&str]| a.iter().map(|s| s.to_string()).collect::<Vec<_>>();
    Ok(match (tool, action) {
        (_, ManageAction::PluginList) => v(&["plugin", "list", "--json", "--available"]),
        (Tool::Claude, ManageAction::PluginInstall { id, accept_command }) => {
            let mut a = v(&["plugin", "install", &id_ok(id)?, "--json"]);
            if let Some(sha) = accept_command {
                if sha.len() != 64 || !sha.chars().all(|c| c.is_ascii_hexdigit()) {
                    return Err("Invalid command checksum".into());
                }
                a.push("--accept-command".into());
                a.push(sha.clone());
            }
            a
        }
        (Tool::Codex, ManageAction::PluginInstall { id, .. }) => {
            v(&["plugin", "add", &id_ok(id)?, "--json"])
        }
        (Tool::Claude, ManageAction::PluginUninstall { id }) => {
            v(&["plugin", "uninstall", &id_ok(id)?, "--json"])
        }
        (Tool::Codex, ManageAction::PluginUninstall { id }) => {
            v(&["plugin", "remove", &id_ok(id)?])
        }
        (Tool::Claude, ManageAction::PluginEnable { id }) => {
            v(&["plugin", "enable", &id_ok(id)?, "--json"])
        }
        (Tool::Claude, ManageAction::PluginDisable { id }) => {
            v(&["plugin", "disable", &id_ok(id)?, "--json"])
        }
        (Tool::Claude, ManageAction::PluginUpdate { id }) => {
            v(&["plugin", "update", &id_ok(id)?, "--json"])
        }
        (Tool::Codex, ManageAction::PluginEnable { .. })
        | (Tool::Codex, ManageAction::PluginDisable { .. })
        | (Tool::Codex, ManageAction::PluginUpdate { .. }) => return unsupported(),
        (_, ManageAction::MarketplaceList) => v(&["plugin", "marketplace", "list", "--json"]),
        (_, ManageAction::MarketplaceAdd { source }) => {
            if !valid_source(source) {
                return Err("Use owner/repo, a Git URL, or a local folder.".into());
            }
            v(&["plugin", "marketplace", "add", source.trim()])
        }
        (_, ManageAction::MarketplaceRemove { name }) => {
            if !valid_name(name) {
                return Err(format!("Invalid marketplace name: {name}"));
            }
            v(&["plugin", "marketplace", "remove", name])
        }
        (Tool::Claude, ManageAction::MarketplaceUpdate) => v(&["plugin", "marketplace", "update"]),
        (Tool::Codex, ManageAction::MarketplaceUpdate) => v(&["plugin", "marketplace", "upgrade"]),
    })
}

/// Lists, installs, removes, enables or disables plugins and marketplaces with the CLI.
#[tauri::command]
pub async fn ai_cli_manage(
    tool: String,
    path: Option<String>,
    action: ManageAction,
) -> CmdResult<Captured> {
    let tool = Tool::parse(&tool)?;
    let args = manage_args(tool, &action)?;
    let exe = find_tool(tool, path.as_deref())
        .ok_or_else(|| format!("Couldn't find the `{}` command.", tool.name()))?;
    // Installs fetch from the network (Git clones); listing is quick.
    let timeout = match action {
        ManageAction::PluginList | ManageAction::MarketplaceList => Duration::from_secs(60),
        _ => Duration::from_secs(300),
    };
    tauri::async_runtime::spawn_blocking(move || {
        let mut cmd = command(&exe);
        cmd.args(&args);
        if let Some(h) = home() {
            cmd.current_dir(h);
        }
        capture(cmd, timeout)
    })
    .await
    .map_err(|e| e.to_string())?
}

// ── MCP servers the CLIs already have ───────────────────────────────────────────────────

const MASK: &str = "••••••";

/// Replaces secret values (env vars, headers, tokens) with a mask, keeping the keys.
pub fn mask_secrets(v: &mut serde_json::Value) {
    match v {
        serde_json::Value::Object(map) => {
            for (k, val) in map.iter_mut() {
                let key = k.to_ascii_lowercase();
                let secret_map = matches!(
                    key.as_str(),
                    "env" | "headers" | "http_headers" | "env_http_headers"
                );
                if secret_map {
                    if let serde_json::Value::Object(inner) = val {
                        for (_, x) in inner.iter_mut() {
                            *x = MASK.into();
                        }
                        continue;
                    }
                }
                if (key.contains("token") || key.contains("secret") || key.contains("password"))
                    && val.is_string()
                {
                    *val = MASK.into();
                    continue;
                }
                mask_secrets(val);
            }
        }
        serde_json::Value::Array(items) => items.iter_mut().for_each(mask_secrets),
        _ => {}
    }
}

/// `{ name, transport, command, args, url }` for each server in Claude Code's user config.
pub fn claude_servers_from(claude_json: &str) -> Vec<serde_json::Value> {
    let Ok(v) = serde_json::from_str::<serde_json::Value>(claude_json) else {
        return Vec::new();
    };
    let Some(servers) = v.get("mcpServers").and_then(|m| m.as_object()) else {
        return Vec::new();
    };
    servers
        .iter()
        .map(|(name, s)| {
            let transport = s["type"].as_str().unwrap_or(if s.get("url").is_some() {
                "http"
            } else {
                "stdio"
            });
            let mut out = serde_json::json!({
                "name": name,
                "transport": transport,
                "command": s["command"],
                "args": s["args"],
                "url": s["url"],
                "envKeys": s["env"].as_object().map(|e| e.keys().cloned().collect::<Vec<_>>()),
                "enabled": true,
            });
            mask_secrets(&mut out);
            out
        })
        .collect()
}

/// MCP servers configured in Claude Code (user scope) or Codex, with secrets masked.
#[tauri::command]
pub async fn ai_cli_mcp_list(
    tool: String,
    path: Option<String>,
) -> CmdResult<Vec<serde_json::Value>> {
    let tool = Tool::parse(&tool)?;
    tauri::async_runtime::spawn_blocking(move || match tool {
        Tool::Claude => {
            let file = std::env::var_os("CLAUDE_CONFIG_DIR")
                .map(|d| PathBuf::from(d).join(".claude.json"))
                .or_else(|| home().map(|h| h.join(".claude.json")));
            Ok(file
                .and_then(|f| std::fs::read_to_string(f).ok())
                .map(|t| claude_servers_from(&t))
                .unwrap_or_default())
        }
        Tool::Codex => {
            let exe = find_tool(tool, path.as_deref()).ok_or("Couldn't find the `codex` command.")?;
            let mut cmd = command(&exe);
            cmd.args(["mcp", "list", "--json"]);
            let out = capture(cmd, Duration::from_secs(30))?;
            if !out.ok {
                return Err(out.stderr.trim().to_string());
            }
            let mut v: serde_json::Value =
                serde_json::from_str(out.stdout.trim()).map_err(|e| e.to_string())?;
            mask_secrets(&mut v);
            Ok(v
                .as_array()
                .cloned()
                .unwrap_or_default()
                .into_iter()
                .map(|s| {
                    let t = &s["transport"];
                    serde_json::json!({
                        "name": s["name"],
                        "transport": t["type"].as_str().map(|x| if x == "streamable_http" { "http" } else { x }).unwrap_or("stdio"),
                        "command": t["command"],
                        "args": t["args"],
                        "url": t["url"],
                        "envKeys": t["env"].as_object().map(|e| e.keys().cloned().collect::<Vec<_>>()),
                        "enabled": s["enabled"].as_bool().unwrap_or(true),
                    })
                })
                .collect())
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

// ── MCP connection test ─────────────────────────────────────────────────────────────────

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct McpTest {
    ok: bool,
    server: Option<String>,
    version: Option<String>,
    tools: Vec<String>,
    error: Option<String>,
    /// The server wants a sign-in (OAuth) first.
    auth_required: bool,
}

fn initialize_request() -> serde_json::Value {
    serde_json::json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "protocolVersion": "2025-06-18",
            "capabilities": {},
            "clientInfo": { "name": "skele", "version": env!("CARGO_PKG_VERSION") },
        },
    })
}

fn read_init(result: &serde_json::Value, test: &mut McpTest) {
    test.server = result["serverInfo"]["name"].as_str().map(String::from);
    test.version = result["serverInfo"]["version"].as_str().map(String::from);
}

fn read_tools(result: &serde_json::Value) -> Vec<String> {
    result["tools"]
        .as_array()
        .map(|t| {
            t.iter()
                .filter_map(|x| x["name"].as_str().map(String::from))
                .take(200)
                .collect()
        })
        .unwrap_or_default()
}

fn test_stdio(spec: &McpServerSpec) -> McpTest {
    let mut test = McpTest::default();
    let Some(exe) = which(spec.command.trim()) else {
        test.error = Some(format!(
            "Couldn't find `{}`. Install it, or use its full path.",
            spec.command.trim()
        ));
        return test;
    };
    let mut cmd = command(&exe);
    cmd.args(&spec.args)
        .envs(&spec.env)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(h) = home() {
        cmd.current_dir(h);
    }
    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            test.error = Some(format!("Couldn't start the server: {e}"));
            return test;
        }
    };
    let pid = child.id();
    let mut stdin = child.stdin.take();
    let (tx, rx) = mpsc::channel::<serde_json::Value>();
    if let Some(out) = child.stdout.take() {
        std::thread::spawn(move || {
            for line in BufReader::new(out).lines().map_while(Result::ok) {
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(&line) {
                    if tx.send(v).is_err() {
                        break;
                    }
                }
            }
        });
    }
    let stderr = child.stderr.take();
    let err_reader = std::thread::spawn(move || {
        let mut buf = String::new();
        if let Some(mut s) = stderr {
            let _ = s.read_to_string(&mut buf);
        }
        tail(buf, 1500)
    });
    let mut send = |v: serde_json::Value| {
        if let Some(s) = stdin.as_mut() {
            let _ = writeln!(s, "{v}");
            let _ = s.flush();
        }
    };
    let wait_for = |id: u64, timeout: Duration| -> Option<serde_json::Value> {
        let deadline = Instant::now() + timeout;
        loop {
            let left = deadline.checked_duration_since(Instant::now())?;
            let v = rx.recv_timeout(left).ok()?;
            if v["id"].as_u64() == Some(id) {
                return Some(v);
            }
        }
    };

    send(initialize_request());
    // npx / uvx may download the server first.
    match wait_for(1, Duration::from_secs(90)) {
        Some(v) if v.get("result").is_some() => {
            read_init(&v["result"], &mut test);
            send(serde_json::json!({ "jsonrpc": "2.0", "method": "notifications/initialized" }));
            send(serde_json::json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/list" }));
            if let Some(t) = wait_for(2, Duration::from_secs(20)) {
                test.tools = read_tools(&t["result"]);
            }
            test.ok = true;
        }
        Some(v) => {
            test.error = Some(
                v["error"]["message"]
                    .as_str()
                    .unwrap_or("The server refused to start a session.")
                    .to_string(),
            );
        }
        None => {
            test.error = Some(
                "The server didn't answer (it may have crashed or be waiting for input).".into(),
            );
        }
    }
    drop(stdin);
    kill_tree(pid);
    let _ = child.kill();
    let _ = child.wait();
    if !test.ok {
        let err = err_reader.join().unwrap_or_default();
        let err = strip_ansi(err.trim());
        if !err.is_empty() {
            let msg = test.error.take().unwrap_or_default();
            test.error = Some(format!("{msg}\n{err}").trim().to_string());
        }
    }
    test
}

/// The JSON-RPC message with `id` in an MCP HTTP response (plain JSON or an SSE stream).
fn rpc_from_body(body: &str, id: u64) -> Option<serde_json::Value> {
    let direct = serde_json::from_str::<serde_json::Value>(body.trim()).ok();
    if let Some(v) = direct {
        if v["id"].as_u64() == Some(id) {
            return Some(v);
        }
    }
    body.lines()
        .filter_map(|l| l.strip_prefix("data:"))
        .filter_map(|d| serde_json::from_str::<serde_json::Value>(d.trim()).ok())
        .find(|v| v["id"].as_u64() == Some(id))
}

async fn test_http(spec: &McpServerSpec) -> McpTest {
    let mut test = McpTest::default();
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }
    let client = match reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(30))
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            test.error = Some(e.to_string());
            return test;
        }
    };
    let url = spec.url.trim();
    let mut headers = reqwest::header::HeaderMap::new();
    for (k, v) in &spec.headers {
        if let (Ok(k), Ok(v)) = (
            reqwest::header::HeaderName::from_bytes(k.as_bytes()),
            reqwest::header::HeaderValue::from_str(v),
        ) {
            headers.insert(k, v);
        }
    }
    if spec.transport == "sse" {
        // Legacy SSE servers: check the event stream opens.
        return match client
            .get(url)
            .headers(headers)
            .header("Accept", "text/event-stream")
            .send()
            .await
        {
            Ok(r) if r.status().is_success() => McpTest { ok: true, ..test },
            Ok(r) if r.status() == 401 || r.status() == 403 => McpTest {
                auth_required: true,
                error: Some("The server needs you to sign in.".into()),
                ..test
            },
            Ok(r) => McpTest {
                error: Some(format!("The server answered {}", r.status())),
                ..test
            },
            Err(e) => McpTest {
                error: Some(e.to_string()),
                ..test
            },
        };
    }
    let post = |body: serde_json::Value, session: Option<String>| {
        let mut req = client
            .post(url)
            .headers(headers.clone())
            .header("Accept", "application/json, text/event-stream")
            .json(&body);
        if let Some(s) = session {
            req = req.header("Mcp-Session-Id", s);
        }
        req.send()
    };
    let resp = match post(initialize_request(), None).await {
        Ok(r) => r,
        Err(e) => {
            test.error = Some(if e.is_connect() {
                format!("Couldn't connect to {url}.")
            } else {
                e.to_string()
            });
            return test;
        }
    };
    if resp.status() == 401 || resp.status() == 403 {
        test.auth_required = true;
        test.error = Some("The server needs you to sign in (OAuth). Sign in once with the CLI: `claude mcp login <name>` or `codex mcp login <name>`.".into());
        return test;
    }
    if !resp.status().is_success() {
        test.error = Some(format!("The server answered {}", resp.status()));
        return test;
    }
    let session = resp
        .headers()
        .get("mcp-session-id")
        .and_then(|v| v.to_str().ok())
        .map(String::from);
    let body = resp.text().await.unwrap_or_default();
    let Some(init) = rpc_from_body(&body, 1) else {
        test.error = Some("That doesn't look like an MCP server.".into());
        return test;
    };
    if let Some(msg) = init["error"]["message"].as_str() {
        test.error = Some(msg.to_string());
        return test;
    }
    read_init(&init["result"], &mut test);
    test.ok = true;
    let _ = post(
        serde_json::json!({ "jsonrpc": "2.0", "method": "notifications/initialized" }),
        session.clone(),
    )
    .await;
    if let Ok(r) = post(
        serde_json::json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/list" }),
        session,
    )
    .await
    {
        let body = r.text().await.unwrap_or_default();
        if let Some(t) = rpc_from_body(&body, 2) {
            test.tools = read_tools(&t["result"]);
        }
    }
    test
}

/// Starts the server (or connects to it), opens an MCP session and lists its tools.
#[tauri::command]
pub async fn ai_mcp_test(server: McpServerSpec) -> CmdResult<McpTest> {
    server.validate()?;
    if server.transport == "stdio" {
        tauri::async_runtime::spawn_blocking(move || test_stdio(&server))
            .await
            .map_err(|e| e.to_string())
    } else {
        Ok(test_http(&server).await)
    }
}

// ── Skills ──────────────────────────────────────────────────────────────────────────────

const SKILL_FILE: &str = "SKILL.md";
const MAX_SKILL_BYTES: usize = 256 * 1024;

fn skills_root(tool: Tool) -> CmdResult<PathBuf> {
    match tool {
        Tool::Claude => claude_home(),
        Tool::Codex => codex_home(),
    }
    .map(|h| h.join("skills"))
    .ok_or_else(|| "Couldn't find your home folder.".into())
}

/// Skill folder names: lowercase letters, digits and hyphens (the Agent Skills format).
pub fn valid_skill_name(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 64
        && s.chars()
            .next()
            .is_some_and(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
        && s.chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

fn skill_dir(tool: Tool, name: &str) -> CmdResult<PathBuf> {
    if !valid_skill_name(name) {
        return Err(format!(
            "Invalid skill name \"{name}\": use lowercase letters, digits and hyphens."
        ));
    }
    Ok(skills_root(tool)?.join(name))
}

/// `name` and `description` from a SKILL.md's YAML front matter (also folded `>` values).
pub fn front_matter(text: &str) -> (Option<String>, Option<String>) {
    let text = text.trim_start_matches('\u{feff}');
    let mut lines = text.lines();
    if lines.next().map(str::trim) != Some("---") {
        return (None, None);
    }
    let body: Vec<&str> = lines.take_while(|l| l.trim() != "---").collect();
    let field = |key: &str| -> Option<String> {
        let i = body
            .iter()
            .position(|l| l.strip_prefix(key).is_some_and(|r| r.starts_with(':')))?;
        let value = body[i][key.len() + 1..].trim();
        if matches!(value, ">" | "|" | ">-" | "|-" | ">+" | "|+") {
            let joined: Vec<&str> = body[i + 1..]
                .iter()
                .take_while(|l| l.starts_with(' ') || l.starts_with('\t') || l.trim().is_empty())
                .map(|l| l.trim())
                .filter(|l| !l.is_empty())
                .collect();
            return Some(joined.join(" ")).filter(|s| !s.is_empty());
        }
        let unquoted = value
            .strip_prefix('"')
            .and_then(|v| v.strip_suffix('"'))
            .or_else(|| value.strip_prefix('\'').and_then(|v| v.strip_suffix('\'')))
            .unwrap_or(value);
        Some(unquoted.to_string()).filter(|s| !s.is_empty())
    };
    (field("name"), field("description"))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillInfo {
    tool: String,
    /// Folder name (what `/name` invokes).
    name: String,
    title: Option<String>,
    description: Option<String>,
    path: String,
    /// The folder is a link (e.g. a synced skills folder); Skele doesn't delete those.
    linked: bool,
}

fn list_skills(tool: Tool, root: &Path) -> Vec<SkillInfo> {
    let Ok(entries) = std::fs::read_dir(root) else {
        return Vec::new();
    };
    let mut out: Vec<SkillInfo> = entries
        .flatten()
        .filter_map(|e| {
            let path = e.path();
            let file = path.join(SKILL_FILE);
            if !file.is_file() {
                return None;
            }
            let name = e.file_name().to_string_lossy().to_string();
            let text = std::fs::read_to_string(&file).unwrap_or_default();
            let (title, description) = front_matter(&text);
            Some(SkillInfo {
                tool: tool.name().into(),
                name,
                title,
                description,
                path: path.display().to_string(),
                linked: e.file_type().map(|t| t.is_symlink()).unwrap_or(false),
            })
        })
        .collect();
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

#[tauri::command]
pub async fn ai_skills_list() -> CmdResult<Vec<SkillInfo>> {
    tauri::async_runtime::spawn_blocking(|| {
        let mut all = Vec::new();
        for tool in [Tool::Claude, Tool::Codex] {
            if let Ok(root) = skills_root(tool) {
                all.extend(list_skills(tool, &root));
            }
        }
        all
    })
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ai_skill_read(tool: String, name: String) -> CmdResult<String> {
    let dir = skill_dir(Tool::parse(&tool)?, &name)?;
    let text = std::fs::read_to_string(dir.join(SKILL_FILE)).map_err(|e| e.to_string())?;
    if text.len() > MAX_SKILL_BYTES * 2 {
        return Err("This skill is too large to edit here.".into());
    }
    Ok(text)
}

/// Checks a SKILL.md before it's saved: size, and front matter with a description.
pub fn check_skill(content: &str) -> CmdResult<()> {
    if content.len() > MAX_SKILL_BYTES {
        return Err("Skills can be at most 256 KB.".into());
    }
    if content.contains('\0') {
        return Err("The skill contains invalid characters.".into());
    }
    match front_matter(content) {
        (_, Some(_)) => Ok(()),
        _ => Err("A skill starts with front matter that has a description, e.g.\n---\nname: my-skill\ndescription: What it does and when to use it\n---".into()),
    }
}

/// Creates or replaces a skill's SKILL.md (other files in its folder are kept).
#[tauri::command]
pub async fn ai_skill_write(tool: String, name: String, content: String) -> CmdResult<String> {
    let dir = skill_dir(Tool::parse(&tool)?, &name)?;
    check_skill(&content)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let tmp = dir.join(".SKILL.md.skele-tmp");
    std::fs::write(&tmp, content.as_bytes()).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, dir.join(SKILL_FILE)).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        e.to_string()
    })?;
    Ok(dir.display().to_string())
}

#[tauri::command]
pub async fn ai_skill_delete(tool: String, name: String) -> CmdResult<()> {
    let dir = skill_dir(Tool::parse(&tool)?, &name)?;
    let meta =
        std::fs::symlink_metadata(&dir).map_err(|_| format!("There's no skill called {name}."))?;
    if meta.file_type().is_symlink() {
        return Err("This skill is a link to another folder; remove it there.".into());
    }
    if !dir.join(SKILL_FILE).is_file() {
        return Err(format!("{name} isn't a skill folder."));
    }
    std::fs::remove_dir_all(&dir).map_err(|e| e.to_string())
}

/// Copies a skill folder into the skills folder: no links, at most 500 files and 50 MB.
pub fn copy_skill(from: &Path, to: &Path) -> CmdResult<()> {
    fn walk(
        from: &Path,
        to: &Path,
        depth: usize,
        files: &mut usize,
        bytes: &mut u64,
    ) -> CmdResult<()> {
        if depth > 10 {
            return Err("The skill folder is nested too deeply.".into());
        }
        std::fs::create_dir_all(to).map_err(|e| e.to_string())?;
        for e in std::fs::read_dir(from)
            .map_err(|e| e.to_string())?
            .flatten()
        {
            let ft = e.file_type().map_err(|e| e.to_string())?;
            let name = e.file_name();
            if ft.is_symlink() || name.to_string_lossy().starts_with(".git") {
                continue;
            }
            let target = to.join(&name);
            if ft.is_dir() {
                walk(&e.path(), &target, depth + 1, files, bytes)?;
            } else if ft.is_file() {
                *files += 1;
                *bytes += e.metadata().map(|m| m.len()).unwrap_or(0);
                if *files > 500 || *bytes > 50 * 1024 * 1024 {
                    return Err("The skill folder is too large (over 500 files or 50 MB).".into());
                }
                std::fs::copy(e.path(), &target).map_err(|e| e.to_string())?;
            }
        }
        Ok(())
    }
    let (mut files, mut bytes) = (0, 0);
    let result = walk(from, to, 0, &mut files, &mut bytes);
    if result.is_err() {
        let _ = std::fs::remove_dir_all(to);
    }
    result
}

/// Picks a folder that contains a SKILL.md and copies it into the tool's skills folder.
/// Returns the new skill's name, or `None` if the user cancelled.
#[tauri::command]
pub async fn ai_skill_import(app: tauri::AppHandle, tool: String) -> CmdResult<Option<String>> {
    use tauri_plugin_dialog::DialogExt;
    let tool = Tool::parse(&tool)?;
    let Some(picked) = app.dialog().file().blocking_pick_folder() else {
        return Ok(None);
    };
    let from = picked.into_path().map_err(|e| e.to_string())?;
    let text = std::fs::read_to_string(from.join(SKILL_FILE))
        .map_err(|_| "That folder has no SKILL.md, so it isn't a skill.".to_string())?;
    check_skill(&text)?;
    let folder = from
        .file_name()
        .map(|n| n.to_string_lossy().to_lowercase().replace([' ', '_'], "-"))
        .unwrap_or_default();
    let name = match front_matter(&text).0 {
        Some(n) if valid_skill_name(&n) => n,
        _ if valid_skill_name(&folder) => folder,
        _ => {
            return Err("Rename the folder to lowercase letters, digits and hyphens first.".into())
        }
    };
    let to = skill_dir(tool, &name)?;
    if to.exists() {
        return Err(format!("There's already a skill called {name}."));
    }
    tauri::async_runtime::spawn_blocking(move || copy_skill(&from, &to))
        .await
        .map_err(|e| e.to_string())??;
    Ok(Some(name))
}

// ── What Claude Code offers: skills, plugin skills and commands, its default model ─────

/// What Claude Code reports when it starts (its `init` event), plus descriptions found on
/// disk for the skills and plugin commands it lists.
#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeCatalog {
    /// The model a chat with no model chosen uses, e.g. `claude-opus-5-5`.
    model: Option<String>,
    version: Option<String>,
    /// Skills it can run, plugin skills namespaced (`plugin:skill`).
    skills: Vec<String>,
    /// All slash commands (built-in, skills, plugin commands).
    commands: Vec<String>,
    /// Loaded plugins: `{ name, path, source }`.
    plugins: Vec<serde_json::Value>,
    /// Description per skill or command name (the part after `plugin:`).
    descriptions: std::collections::BTreeMap<String, String>,
    error: Option<String>,
}

fn str_list(v: &serde_json::Value) -> Vec<String> {
    v.as_array()
        .map(|a| {
            a.iter()
                .filter_map(|x| x.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default()
}

pub fn catalog_from_init(init: &serde_json::Value) -> ClaudeCatalog {
    ClaudeCatalog {
        model: init["model"].as_str().map(String::from),
        version: init["claude_code_version"].as_str().map(String::from),
        skills: str_list(&init["skills"]),
        commands: str_list(&init["slash_commands"]),
        plugins: init["plugins"].as_array().cloned().unwrap_or_default(),
        ..Default::default()
    }
}

/// Descriptions of skills (`*/SKILL.md`) and commands (`commands/*.md`) under `root`, a few
/// levels deep (plugin caches nest them under marketplace/plugin/version folders).
pub fn collect_descriptions(
    root: &Path,
    depth: usize,
    out: &mut std::collections::BTreeMap<String, String>,
    budget: &mut usize,
) {
    let Ok(entries) = std::fs::read_dir(root) else {
        return;
    };
    for e in entries.flatten() {
        if *budget == 0 {
            return;
        }
        *budget -= 1;
        let path = e.path();
        let name = e.file_name().to_string_lossy().to_string();
        if name.starts_with('.') || name == "node_modules" {
            continue;
        }
        if !path.is_dir() {
            continue;
        }
        let skill = path.join(SKILL_FILE);
        if skill.is_file() {
            if let Ok(text) = std::fs::read_to_string(&skill) {
                if let (_, Some(d)) = front_matter(&text) {
                    out.entry(name.clone()).or_insert(d);
                }
            }
            continue;
        }
        if name == "commands" {
            for c in std::fs::read_dir(&path).into_iter().flatten().flatten() {
                let p = c.path();
                if p.extension().and_then(|x| x.to_str()) != Some("md") {
                    continue;
                }
                let Some(stem) = p.file_stem().map(|s| s.to_string_lossy().to_string()) else {
                    continue;
                };
                if let Ok(text) = std::fs::read_to_string(&p) {
                    if let (_, Some(d)) = front_matter(&text) {
                        out.entry(stem).or_insert(d);
                    }
                }
            }
            continue;
        }
        if depth > 0 {
            collect_descriptions(&path, depth - 1, out, budget);
        }
    }
}

fn claude_descriptions() -> std::collections::BTreeMap<String, String> {
    let mut out = std::collections::BTreeMap::new();
    let Some(h) = claude_home() else {
        return out;
    };
    let mut budget = 20_000;
    collect_descriptions(&h.join("skills"), 3, &mut out, &mut budget);
    // Depth 0 on the config folder itself picks up personal `commands/*.md`.
    collect_descriptions(&h, 0, &mut out, &mut budget);
    for sub in ["cache", "synced", "marketplaces"] {
        collect_descriptions(&h.join("plugins").join(sub), 6, &mut out, &mut budget);
    }
    out
}

/// Starts Claude Code just long enough to read what it offers. It's asked to run `/context`,
/// a local command that never reaches the model (no usage is spent); Skele stops it as soon
/// as the `init` event arrives.
#[tauri::command]
pub async fn ai_claude_catalog(
    location: tauri::State<'_, crate::paths::DataLocation>,
    path: Option<String>,
) -> CmdResult<ClaudeCatalog> {
    let exe = find_tool(Tool::Claude, path.as_deref())
        .ok_or_else(|| "Claude Code isn't installed.".to_string())?;
    let workdir = location.root.join("ai");
    tauri::async_runtime::spawn_blocking(move || -> CmdResult<ClaudeCatalog> {
        std::fs::create_dir_all(&workdir).map_err(|e| e.to_string())?;
        let mut child = command(&exe)
            .args([
                "-p",
                "--output-format",
                "stream-json",
                "--verbose",
                "--tools",
                "",
                "--permission-prompts",
                "none",
                "--strict-mcp-config",
                "--no-session-persistence",
            ])
            .current_dir(&workdir)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("Couldn't start Claude Code: {e}"))?;
        let pid = child.id();
        if let Some(mut stdin) = child.stdin.take() {
            let _ = stdin.write_all(b"/context");
        }
        let stdout = child.stdout.take();
        let (tx, rx) = mpsc::channel::<serde_json::Value>();
        std::thread::spawn(move || {
            let Some(stdout) = stdout else { return };
            for line in BufReader::new(stdout).lines() {
                let Ok(line) = line else { break };
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(&line) {
                    if v["type"] == "system" && v["subtype"] == "init" {
                        let _ = tx.send(v);
                        break;
                    }
                }
            }
        });
        let init = rx.recv_timeout(Duration::from_secs(45));
        kill_tree(pid);
        let _ = child.kill();
        let _ = child.wait();
        let mut catalog = match init {
            Ok(v) => catalog_from_init(&v),
            Err(_) => ClaudeCatalog {
                error: Some("Claude Code didn't start in time.".into()),
                ..Default::default()
            },
        };
        catalog.descriptions = claude_descriptions();
        Ok(catalog)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_claude_init_event_and_skill_descriptions() {
        let init = serde_json::json!({
            "type": "system", "subtype": "init", "model": "claude-opus-5-5",
            "claude_code_version": "2.1.325",
            "skills": ["simplify", "anthropic-skills:pdf"],
            "slash_commands": ["simplify", "context", "anthropic-skills:pdf"],
            "plugins": [{ "name": "remotion", "path": "x", "source": "remotion@remotion" }],
        });
        let c = catalog_from_init(&init);
        assert_eq!(c.model.as_deref(), Some("claude-opus-5-5"));
        assert_eq!(c.skills, vec!["simplify", "anthropic-skills:pdf"]);
        assert_eq!(c.commands.len(), 3);
        assert_eq!(c.plugins.len(), 1);

        let dir = tempfile::tempdir().unwrap();
        let skill = dir
            .path()
            .join("mkt")
            .join("plug")
            .join("1.0")
            .join("skills")
            .join("pdf");
        std::fs::create_dir_all(&skill).unwrap();
        std::fs::write(
            skill.join("SKILL.md"),
            "---\nname: pdf\ndescription: Work with PDFs\n---\nBody",
        )
        .unwrap();
        let cmds = dir
            .path()
            .join("mkt")
            .join("plug")
            .join("1.0")
            .join("commands");
        std::fs::create_dir_all(&cmds).unwrap();
        std::fs::write(
            cmds.join("deploy.md"),
            "---\ndescription: Ship it\n---\nDo it",
        )
        .unwrap();
        let mut out = std::collections::BTreeMap::new();
        let mut budget = 1000;
        collect_descriptions(dir.path(), 6, &mut out, &mut budget);
        assert_eq!(out.get("pdf").map(String::as_str), Some("Work with PDFs"));
        assert_eq!(out.get("deploy").map(String::as_str), Some("Ship it"));
    }

    #[test]
    fn management_commands_are_fixed_and_validated() {
        let a = manage_args(
            Tool::Claude,
            &ManageAction::PluginInstall {
                id: "superpowers@dir".into(),
                accept_command: None,
            },
        )
        .unwrap();
        assert_eq!(a, ["plugin", "install", "superpowers@dir", "--json"]);
        let a = manage_args(
            Tool::Codex,
            &ManageAction::PluginInstall {
                id: "gmail@curated".into(),
                accept_command: None,
            },
        )
        .unwrap();
        assert_eq!(a, ["plugin", "add", "gmail@curated", "--json"]);
        assert!(manage_args(
            Tool::Claude,
            &ManageAction::PluginInstall {
                id: "--force".into(),
                accept_command: None
            }
        )
        .is_err());
        assert!(manage_args(
            Tool::Claude,
            &ManageAction::PluginInstall {
                id: "x".into(),
                accept_command: Some("nothex".into())
            }
        )
        .is_err());
        let sha = "a".repeat(64);
        let a = manage_args(
            Tool::Claude,
            &ManageAction::PluginInstall {
                id: "x".into(),
                accept_command: Some(sha.clone()),
            },
        )
        .unwrap();
        assert_eq!(a[a.len() - 2..], ["--accept-command".to_string(), sha]);
        assert!(manage_args(Tool::Codex, &ManageAction::PluginDisable { id: "x".into() }).is_err());
        assert_eq!(
            manage_args(Tool::Codex, &ManageAction::MarketplaceUpdate).unwrap(),
            ["plugin", "marketplace", "upgrade"]
        );
    }

    #[test]
    fn marketplace_sources() {
        assert!(valid_source("anthropics/claude-plugins-official"));
        assert!(valid_source("owner/repo@v1.2"));
        assert!(valid_source("https://github.com/o/r.git"));
        assert!(!valid_source("-x"));
        assert!(!valid_source("https://a b"));
        assert!(!valid_source("just-a-name"));
        assert!(!valid_source("a/b/c"));
        let dir = tempfile::tempdir().unwrap();
        assert!(valid_source(&dir.path().display().to_string()));
    }

    #[test]
    fn masks_secrets() {
        let mut v = serde_json::json!({
            "name": "x",
            "transport": { "env": { "API_KEY": "secret" }, "http_headers": { "Authorization": "Bearer t" }, "bearer_token": "t", "args": ["a"] },
        });
        mask_secrets(&mut v);
        assert_eq!(v["transport"]["env"]["API_KEY"], MASK);
        assert_eq!(v["transport"]["http_headers"]["Authorization"], MASK);
        assert_eq!(v["transport"]["bearer_token"], MASK);
        assert_eq!(v["transport"]["args"][0], "a");
        let claude = r#"{"oauthAccount":{"x":1},"mcpServers":{"fetch":{"command":"uvx","args":["mcp-server-fetch"],"env":{"K":"v"}},"remote":{"type":"http","url":"https://x/mcp","headers":{"A":"b"}}}}"#;
        let list = claude_servers_from(claude);
        assert_eq!(list.len(), 2);
        let text = serde_json::to_string(&list).unwrap();
        assert!(!text.contains("\"v\"") && !text.contains("oauth"));
        assert!(text.contains("\"envKeys\":[\"K\"]"));
    }

    #[test]
    fn reads_front_matter() {
        let s = "---\nname: pdf-tools\ndescription: \"Fill PDF forms\"\n---\n# Body";
        assert_eq!(
            front_matter(s),
            (Some("pdf-tools".into()), Some("Fill PDF forms".into()))
        );
        let folded = "---\nname: x\ndescription: >\n  Long text\n  continues\nother: 1\n---\n";
        assert_eq!(
            front_matter(folded).1.as_deref(),
            Some("Long text continues")
        );
        assert_eq!(front_matter("# no front matter"), (None, None));
        assert!(check_skill(s).is_ok());
        assert!(check_skill("---\nname: x\n---\n").is_err());
    }

    #[test]
    fn skill_names_and_copy() {
        assert!(valid_skill_name("my-skill-2"));
        assert!(!valid_skill_name("../etc"));
        assert!(!valid_skill_name("My Skill"));
        assert!(!valid_skill_name("-x"));
        let src = tempfile::tempdir().unwrap();
        std::fs::write(src.path().join(SKILL_FILE), "---\ndescription: d\n---").unwrap();
        std::fs::create_dir_all(src.path().join("scripts")).unwrap();
        std::fs::write(src.path().join("scripts").join("run.py"), "print(1)").unwrap();
        let dst = tempfile::tempdir().unwrap();
        let to = dst.path().join("copied");
        copy_skill(src.path(), &to).unwrap();
        assert!(to.join("scripts").join("run.py").is_file());
        let skills = list_skills(Tool::Claude, dst.path());
        assert_eq!(skills.len(), 1);
        assert_eq!(skills[0].description.as_deref(), Some("d"));
    }

    #[test]
    fn finds_rpc_in_sse_bodies() {
        let sse = "event: message\ndata: {\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"serverInfo\":{\"name\":\"s\"}}}\n\n";
        assert_eq!(
            rpc_from_body(sse, 1).unwrap()["result"]["serverInfo"]["name"],
            "s"
        );
        assert!(rpc_from_body(sse, 2).is_none());
        assert!(rpc_from_body("{\"id\":2,\"result\":{}}", 2).is_some());
    }

    /// A tiny MCP server (Node) that answers initialize and tools/list.
    #[test]
    fn tests_a_stdio_mcp_server() {
        if which("node").is_none() {
            eprintln!("node not installed; skipping");
            return;
        }
        let script = [
            "const rl = require('readline').createInterface({ input: process.stdin });",
            "rl.on('line', (l) => {",
            "  const m = JSON.parse(l);",
            "  if (m.method === 'initialize') console.log(JSON.stringify({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'fake', version: '1.2.3' } } }));",
            "  if (m.method === 'tools/list') console.log(JSON.stringify({ jsonrpc: '2.0', id: m.id, result: { tools: [{ name: 'echo' }, { name: 'add' }] } }));",
            "});",
        ]
        .join("\n");
        let spec = McpServerSpec {
            name: "fake".into(),
            transport: "stdio".into(),
            command: "node".into(),
            args: vec!["-e".into(), script],
            ..Default::default()
        };
        let t = test_stdio(&spec);
        assert!(t.ok, "{:?}", t.error);
        assert_eq!(t.server.as_deref(), Some("fake"));
        assert_eq!(t.version.as_deref(), Some("1.2.3"));
        assert_eq!(t.tools, ["echo", "add"]);

        let broken = McpServerSpec {
            args: vec![
                "-e".into(),
                "console.error('boom: missing API key'); process.exit(1)".into(),
            ],
            ..spec
        };
        let t = test_stdio(&broken);
        assert!(!t.ok);
        assert!(t.error.unwrap().contains("missing API key"));
        let missing = McpServerSpec {
            command: "definitely-not-a-program-xyz".into(),
            ..Default::default()
        };
        assert!(test_stdio(&missing)
            .error
            .unwrap()
            .contains("Couldn't find"));
    }

    #[test]
    fn strips_ansi() {
        assert_eq!(strip_ansi("\x1b[31merror\x1b[0m!"), "error!");
    }
}
