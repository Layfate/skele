//! Tools for the API models (Claude API, OpenAI API, OpenRouter), which, unlike Claude Code
//! and Codex, can't touch this computer on their own. The page runs the model's tool loop and
//! calls these:
//!
//! - File tools in the chat's folder: list, read and search ("read" mode), plus write and
//!   edit ("edit" mode). Every path is resolved inside the folder (no `..` or links out of
//!   it), the folder is checked like the CLIs' (`validate_folder`), and nothing runs commands.
//! - MCP servers: a session per server stays open between calls (stdio servers keep running
//!   until Skele quits; HTTP servers keep their session id), so a turn with ten tool calls
//!   doesn't start the server ten times.

use serde::Serialize;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Component, Path, PathBuf};
use std::process::{Child, ChildStdin, Stdio};
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant};

use crate::ai::{
    command, home, kill_tree, plain_path, tail, validate_folder, which, CmdResult, McpServerSpec,
};
use crate::ai_ext::{initialize_request, rpc_from_body};

// ── Files ───────────────────────────────────────────────────────────────────────────────

const SKIP_DIRS: &[&str] = &[
    ".git",
    "node_modules",
    "target",
    "dist",
    "build",
    ".next",
    "out",
    "__pycache__",
    ".venv",
    "venv",
    ".cache",
];
const MAX_READ: u64 = 400 * 1024;
const MAX_WRITE: usize = 5 * 1024 * 1024;

/// `rel` (relative to `root`, or absolute inside it) as a path inside `root`. Links that
/// lead out of the folder are refused too (checked on the nearest part that exists).
pub fn resolve_in(root: &Path, rel: &str) -> CmdResult<PathBuf> {
    let rel = rel.trim();
    let given = Path::new(if rel.is_empty() { "." } else { rel });
    let joined = if given.is_absolute() {
        given.to_path_buf()
    } else {
        root.join(given)
    };
    let mut out = PathBuf::new();
    for c in joined.components() {
        match c {
            Component::ParentDir => {
                if !out.pop() {
                    return Err(format!("{rel} is outside the chat's folder."));
                }
            }
            Component::CurDir => {}
            other => out.push(other.as_os_str()),
        }
    }
    let out = plain_path(out);
    if !out.starts_with(root) {
        return Err(format!("{rel} is outside the chat's folder."));
    }
    let mut existing = out.as_path();
    while !existing.exists() {
        existing = existing
            .parent()
            .ok_or_else(|| format!("{rel} is outside the chat's folder."))?;
    }
    let canon = plain_path(std::fs::canonicalize(existing).map_err(|e| e.to_string())?);
    if !canon.starts_with(root) {
        return Err(format!("{rel} leads outside the chat's folder."));
    }
    Ok(out)
}

fn rel_of(root: &Path, p: &Path) -> String {
    p.strip_prefix(root)
        .unwrap_or(p)
        .to_string_lossy()
        .replace('\\', "/")
}

fn is_binary(bytes: &[u8]) -> bool {
    bytes.iter().take(8000).any(|b| *b == 0)
}

/// Files under `dir`, breadth first, skipping build and dependency folders.
fn walk(
    dir: &Path,
    max_depth: usize,
    max: usize,
    mut visit: impl FnMut(&Path, bool, usize) -> bool,
) {
    let mut queue = std::collections::VecDeque::from([(dir.to_path_buf(), 0usize)]);
    let mut seen = 0;
    while let Some((d, depth)) = queue.pop_front() {
        let Ok(entries) = std::fs::read_dir(&d) else {
            continue;
        };
        let mut entries: Vec<_> = entries.flatten().collect();
        entries.sort_by_key(|e| e.file_name());
        for e in entries {
            let name = e.file_name().to_string_lossy().to_string();
            let Ok(ft) = e.file_type() else { continue };
            if ft.is_symlink() {
                continue;
            }
            let is_dir = ft.is_dir();
            if is_dir && SKIP_DIRS.contains(&name.as_str()) {
                continue;
            }
            seen += 1;
            if seen > max || !visit(&e.path(), is_dir, depth) {
                return;
            }
            if is_dir && depth + 1 < max_depth {
                queue.push_back((e.path(), depth + 1));
            }
        }
    }
}

fn arg<'a>(args: &'a serde_json::Value, key: &str) -> Option<&'a str> {
    args[key].as_str()
}

fn need<'a>(args: &'a serde_json::Value, key: &str) -> CmdResult<&'a str> {
    arg(args, key).ok_or_else(|| format!("Missing \"{key}\"."))
}

/// Runs one file tool in `root`. `write` allows write_file and edit_file ("edit" mode).
pub fn file_tool(
    root: &Path,
    write: bool,
    tool: &str,
    args: &serde_json::Value,
) -> CmdResult<String> {
    match tool {
        "list_files" => {
            let dir = resolve_in(root, arg(args, "path").unwrap_or("."))?;
            if !dir.is_dir() {
                return Err(format!("{} isn't a folder.", rel_of(root, &dir)));
            }
            let mut lines = Vec::new();
            let mut more = false;
            walk(&dir, 3, 400, |p, is_dir, depth| {
                if lines.len() >= 400 {
                    more = true;
                    return false;
                }
                let indent = "  ".repeat(depth);
                let name = p
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_default();
                lines.push(if is_dir {
                    format!("{indent}{name}/")
                } else {
                    let size = p.metadata().map(|m| m.len()).unwrap_or(0);
                    format!("{indent}{name} ({size} bytes)")
                });
                true
            });
            if lines.is_empty() {
                return Ok("(empty folder)".into());
            }
            if more {
                lines.push("… (more files not shown; list a subfolder)".into());
            }
            Ok(lines.join("\n"))
        }
        "read_file" => {
            let p = resolve_in(root, need(args, "path")?)?;
            if !p.is_file() {
                return Err(format!("{} isn't a file.", rel_of(root, &p)));
            }
            let len = p.metadata().map(|m| m.len()).unwrap_or(0);
            let mut bytes = Vec::new();
            std::fs::File::open(&p)
                .and_then(|f| f.take(MAX_READ).read_to_end(&mut bytes))
                .map_err(|e| e.to_string())?;
            if is_binary(&bytes) {
                return Err(format!(
                    "{} is a binary file ({len} bytes).",
                    rel_of(root, &p)
                ));
            }
            let text = String::from_utf8_lossy(&bytes);
            let offset = args["offset"].as_u64().unwrap_or(1).max(1) as usize;
            let limit = args["limit"].as_u64().unwrap_or(2000).clamp(1, 5000) as usize;
            let all: Vec<&str> = text.lines().collect();
            let shown: Vec<String> = all
                .iter()
                .enumerate()
                .skip(offset - 1)
                .take(limit)
                .map(|(i, l)| format!("{:>5}\t{}", i + 1, l))
                .collect();
            let mut out = shown.join("\n");
            let last = offset - 1 + shown.len();
            if last < all.len() || len > MAX_READ {
                out.push_str(&format!(
                    "\n… (showing lines {offset}-{last}; the file has {}{} lines. Use offset to read more.)",
                    all.len(),
                    if len > MAX_READ { "+" } else { "" }
                ));
            }
            Ok(out)
        }
        "search_files" => {
            let query = need(args, "query")?.to_lowercase();
            if query.trim().is_empty() {
                return Err("The search is empty.".into());
            }
            let dir = resolve_in(root, arg(args, "path").unwrap_or("."))?;
            let mut hits = Vec::new();
            walk(&dir, 12, 20_000, |p, is_dir, _| {
                if hits.len() >= 200 {
                    return false;
                }
                let rel = rel_of(root, p);
                if rel.to_lowercase().contains(&query) {
                    hits.push(format!("{rel}{}", if is_dir { "/" } else { "" }));
                }
                if is_dir || p.metadata().map(|m| m.len() > 1_000_000).unwrap_or(true) {
                    return true;
                }
                let Ok(bytes) = std::fs::read(p) else {
                    return true;
                };
                if is_binary(&bytes) {
                    return true;
                }
                for (i, line) in String::from_utf8_lossy(&bytes).lines().enumerate() {
                    if line.to_lowercase().contains(&query) {
                        let l: String = line.trim().chars().take(200).collect();
                        hits.push(format!("{rel}:{}: {l}", i + 1));
                        if hits.len() >= 200 {
                            break;
                        }
                    }
                }
                true
            });
            Ok(if hits.is_empty() {
                "No matches.".into()
            } else if hits.len() >= 200 {
                format!(
                    "{}\n… (first 200 matches; search a subfolder or a longer phrase)",
                    hits.join("\n")
                )
            } else {
                hits.join("\n")
            })
        }
        "write_file" | "edit_file" if !write => {
            Err("This chat can only read files. Switch it to Edit files to change them.".into())
        }
        "write_file" => {
            let p = resolve_in(root, need(args, "path")?)?;
            let content = need(args, "content")?;
            if content.len() > MAX_WRITE {
                return Err("That's too much to write at once (5 MB at most).".into());
            }
            if p.is_dir() {
                return Err(format!("{} is a folder.", rel_of(root, &p)));
            }
            if let Some(parent) = p.parent() {
                std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            let existed = p.exists();
            std::fs::write(&p, content).map_err(|e| e.to_string())?;
            Ok(format!(
                "{} {} ({} bytes).",
                if existed { "Replaced" } else { "Created" },
                rel_of(root, &p),
                content.len()
            ))
        }
        "edit_file" => {
            let p = resolve_in(root, need(args, "path")?)?;
            let old = need(args, "old_text")?;
            let new = need(args, "new_text")?;
            if old.is_empty() {
                return Err("old_text is empty; use write_file to create a file.".into());
            }
            let text = std::fs::read_to_string(&p)
                .map_err(|e| format!("Couldn't read {}: {e}", rel_of(root, &p)))?;
            // Files with Windows line endings: match the model's \n text against \r\n.
            let (old, new) = if !text.contains(old) && text.contains("\r\n") {
                (
                    old.replace("\r\n", "\n").replace('\n', "\r\n"),
                    new.replace("\r\n", "\n").replace('\n', "\r\n"),
                )
            } else {
                (old.to_string(), new.to_string())
            };
            match text.matches(&old).count() {
                0 => Err(format!("old_text wasn't found in {}. Read the file again and copy the text exactly.", rel_of(root, &p))),
                1 => {
                    std::fs::write(&p, text.replacen(&old, &new, 1)).map_err(|e| e.to_string())?;
                    Ok(format!("Edited {}.", rel_of(root, &p)))
                }
                n => Err(format!("old_text appears {n} times in {}; include more surrounding text so it's unique.", rel_of(root, &p))),
            }
        }
        _ => Err(format!("Unknown file tool: {tool}")),
    }
}

/// One file tool call from an API model's turn.
#[tauri::command]
pub async fn ai_file_tool(
    folder: String,
    write: bool,
    tool: String,
    args: serde_json::Value,
) -> CmdResult<String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = validate_folder(&folder)?;
        file_tool(&root, write, &tool, &args)
    })
    .await
    .map_err(|e| e.to_string())?
}

// ── MCP sessions ────────────────────────────────────────────────────────────────────────

struct StdioSession {
    child: Child,
    stdin: ChildStdin,
    rx: mpsc::Receiver<serde_json::Value>,
    next: u64,
    stderr: Arc<Mutex<String>>,
}

impl Drop for StdioSession {
    fn drop(&mut self) {
        kill_tree(self.child.id());
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

impl StdioSession {
    fn start(spec: &McpServerSpec) -> CmdResult<Self> {
        let exe = which(spec.command.trim())
            .ok_or_else(|| format!("Couldn't find `{}`.", spec.command.trim()))?;
        let mut cmd = command(&exe);
        cmd.args(&spec.args)
            .envs(&spec.env)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        if let Some(h) = home() {
            cmd.current_dir(h);
        }
        let mut child = cmd
            .spawn()
            .map_err(|e| format!("Couldn't start the MCP server {}: {e}", spec.name))?;
        let stdin = child.stdin.take().ok_or("No stdin")?;
        let (tx, rx) = mpsc::channel();
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
        let stderr = Arc::new(Mutex::new(String::new()));
        if let Some(err) = child.stderr.take() {
            let buf = stderr.clone();
            std::thread::spawn(move || {
                for line in BufReader::new(err).lines().map_while(Result::ok) {
                    if let Ok(mut b) = buf.lock() {
                        b.push_str(&line);
                        b.push('\n');
                        if b.len() > 4000 {
                            *b = tail(std::mem::take(&mut *b), 2000);
                        }
                    }
                }
            });
        }
        let mut s = StdioSession {
            child,
            stdin,
            rx,
            next: 1,
            stderr,
        };
        // npx / uvx may download the server first.
        let init = s.request_raw(initialize_request(), 1, Duration::from_secs(90))?;
        if let Some(msg) = init["error"]["message"].as_str() {
            return Err(format!("{}: {msg}", spec.name));
        }
        s.next = 2;
        s.send(&serde_json::json!({ "jsonrpc": "2.0", "method": "notifications/initialized" }))?;
        Ok(s)
    }

    fn alive(&mut self) -> bool {
        matches!(self.child.try_wait(), Ok(None))
    }

    fn send(&mut self, v: &serde_json::Value) -> CmdResult<()> {
        writeln!(self.stdin, "{v}")
            .and_then(|_| self.stdin.flush())
            .map_err(|e| format!("The MCP server stopped: {e}"))
    }

    fn request_raw(
        &mut self,
        msg: serde_json::Value,
        id: u64,
        timeout: Duration,
    ) -> CmdResult<serde_json::Value> {
        self.send(&msg)?;
        let deadline = Instant::now() + timeout;
        loop {
            let left = deadline
                .checked_duration_since(Instant::now())
                .ok_or_else(|| {
                    let err = self
                        .stderr
                        .lock()
                        .map(|e| e.trim().to_string())
                        .unwrap_or_default();
                    format!(
                        "The MCP server didn't answer in time.{}",
                        if err.is_empty() {
                            String::new()
                        } else {
                            format!("\n{}", tail(err, 600))
                        }
                    )
                })?;
            let v = self.rx.recv_timeout(left.min(Duration::from_millis(500)));
            match v {
                Ok(v) if v["id"].as_u64() == Some(id) && v.get("method").is_none() => return Ok(v),
                Ok(v) => {
                    // A request from the server (ping, roots/list…): answer so it isn't left waiting.
                    if let (Some(method), Some(rid)) = (v["method"].as_str(), v.get("id")) {
                        let reply = if method == "ping" {
                            serde_json::json!({ "jsonrpc": "2.0", "id": rid, "result": {} })
                        } else if method == "roots/list" {
                            serde_json::json!({ "jsonrpc": "2.0", "id": rid, "result": { "roots": [] } })
                        } else {
                            serde_json::json!({ "jsonrpc": "2.0", "id": rid, "error": { "code": -32601, "message": "Not supported by Skele" } })
                        };
                        let _ = self.send(&reply);
                    }
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {
                    if !self.alive() {
                        let err = self
                            .stderr
                            .lock()
                            .map(|e| e.trim().to_string())
                            .unwrap_or_default();
                        return Err(format!(
                            "The MCP server stopped.{}",
                            if err.is_empty() {
                                String::new()
                            } else {
                                format!("\n{}", tail(err, 600))
                            }
                        ));
                    }
                }
                Err(mpsc::RecvTimeoutError::Disconnected) => {
                    return Err("The MCP server stopped.".into())
                }
            }
        }
    }

    fn request(
        &mut self,
        method: &str,
        params: serde_json::Value,
        timeout: Duration,
    ) -> CmdResult<serde_json::Value> {
        let id = self.next;
        self.next += 1;
        self.request_raw(
            serde_json::json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params }),
            id,
            timeout,
        )
    }
}

/// Open MCP sessions, by server (its whole configuration, so an edited server starts afresh).
type StdioMap = Arc<Mutex<HashMap<String, Arc<Mutex<StdioSession>>>>>;

#[derive(Default)]
pub struct McpPool {
    stdio: StdioMap,
    http: Mutex<HashMap<String, Option<String>>>,
}

fn stdio_session(map: &StdioMap, spec: &McpServerSpec) -> CmdResult<Arc<Mutex<StdioSession>>> {
    let key = serde_json::to_string(spec).unwrap_or_default();
    if let Some(s) = map.lock().map_err(|e| e.to_string())?.get(&key).cloned() {
        if s.lock().map(|mut s| s.alive()).unwrap_or(false) {
            return Ok(s);
        }
    }
    let s = Arc::new(Mutex::new(StdioSession::start(spec)?));
    map.lock()
        .map_err(|e| e.to_string())?
        .insert(key, s.clone());
    Ok(s)
}

fn stdio_request(
    map: &StdioMap,
    spec: &McpServerSpec,
    method: &str,
    params: serde_json::Value,
    timeout: Duration,
) -> CmdResult<serde_json::Value> {
    let s = stdio_session(map, spec)?;
    let mut s = s.lock().map_err(|e| e.to_string())?;
    s.request(method, params, timeout)
}

impl McpPool {
    /// Stops every stdio server (when Skele quits).
    pub fn close_all(&self) {
        if let Ok(mut m) = self.stdio.lock() {
            m.clear();
        }
    }

    async fn http_request(
        &self,
        spec: &McpServerSpec,
        method: &str,
        params: serde_json::Value,
        timeout: Duration,
    ) -> CmdResult<serde_json::Value> {
        if spec.transport != "http" {
            return Err(format!("{}: older SSE servers can't be used by API models yet. Use the server's Streamable HTTP address.", spec.name));
        }
        if rustls::crypto::CryptoProvider::get_default().is_none() {
            let _ = rustls::crypto::ring::default_provider().install_default();
        }
        let client = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .timeout(timeout)
            .build()
            .map_err(|e| e.to_string())?;
        let mut headers = reqwest::header::HeaderMap::new();
        for (k, v) in &spec.headers {
            if let (Ok(k), Ok(v)) = (
                reqwest::header::HeaderName::from_bytes(k.as_bytes()),
                reqwest::header::HeaderValue::from_str(v),
            ) {
                headers.insert(k, v);
            }
        }
        let url = spec.url.trim().to_string();
        let post = |body: serde_json::Value, session: Option<String>| {
            let mut req = client
                .post(&url)
                .headers(headers.clone())
                .header("Accept", "application/json, text/event-stream")
                .json(&body);
            if let Some(s) = session {
                req = req.header("Mcp-Session-Id", s);
            }
            req.send()
        };
        let key = serde_json::to_string(spec).unwrap_or_default();
        for attempt in 0..2 {
            let cached = self
                .http
                .lock()
                .map_err(|e| e.to_string())?
                .get(&key)
                .cloned();
            let session = match cached {
                Some(s) => s,
                None => {
                    let r = post(initialize_request(), None)
                        .await
                        .map_err(|e| format!("{}: {e}", spec.name))?;
                    if r.status() == 401 || r.status() == 403 {
                        return Err(format!(
                            "{} needs you to sign in (OAuth), which API models can't do yet.",
                            spec.name
                        ));
                    }
                    if !r.status().is_success() {
                        return Err(format!("{} answered {}", spec.name, r.status()));
                    }
                    let s = r
                        .headers()
                        .get("mcp-session-id")
                        .and_then(|v| v.to_str().ok())
                        .map(String::from);
                    let _ = r.text().await;
                    let _ = post(serde_json::json!({ "jsonrpc": "2.0", "method": "notifications/initialized" }), s.clone()).await;
                    self.http
                        .lock()
                        .map_err(|e| e.to_string())?
                        .insert(key.clone(), s.clone());
                    s
                }
            };
            let r = post(serde_json::json!({ "jsonrpc": "2.0", "id": 7, "method": method, "params": params }), session)
                .await
                .map_err(|e| format!("{}: {e}", spec.name))?;
            // An expired session: start a new one once.
            if (r.status() == 404 || r.status() == 400) && attempt == 0 {
                self.http.lock().map_err(|e| e.to_string())?.remove(&key);
                continue;
            }
            if !r.status().is_success() {
                return Err(format!("{} answered {}", spec.name, r.status()));
            }
            let body = r.text().await.unwrap_or_default();
            return rpc_from_body(&body, 7)
                .ok_or_else(|| format!("{} sent an answer Skele couldn't read.", spec.name));
        }
        Err(format!("{}: couldn't start a session.", spec.name))
    }

    async fn request(
        &self,
        spec: McpServerSpec,
        method: &'static str,
        params: serde_json::Value,
        timeout: Duration,
    ) -> CmdResult<serde_json::Value> {
        spec.validate()?;
        if spec.transport == "stdio" {
            // Blocking reads: run on a worker thread with its own handle on the session map.
            let map = self.stdio.clone();
            return tauri::async_runtime::spawn_blocking(move || {
                stdio_request(&map, &spec, method, params, timeout)
            })
            .await
            .map_err(|e| e.to_string())?;
        }
        self.http_request(&spec, method, params, timeout).await
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpTool {
    name: String,
    description: String,
    input_schema: serde_json::Value,
}

/// The tools an MCP server offers (starting it or opening a session if needed).
#[tauri::command]
pub async fn ai_mcp_tools(
    pool: tauri::State<'_, McpPool>,
    server: McpServerSpec,
) -> CmdResult<Vec<McpTool>> {
    let v = pool
        .request(
            server,
            "tools/list",
            serde_json::json!({}),
            Duration::from_secs(90),
        )
        .await?;
    if let Some(msg) = v["error"]["message"].as_str() {
        return Err(msg.to_string());
    }
    Ok(v["result"]["tools"]
        .as_array()
        .map(|a| {
            a.iter()
                .take(100)
                .filter_map(|t| {
                    Some(McpTool {
                        name: t["name"].as_str()?.to_string(),
                        description: t["description"]
                            .as_str()
                            .unwrap_or("")
                            .chars()
                            .take(1000)
                            .collect(),
                        input_schema: if t["inputSchema"].is_object() {
                            t["inputSchema"].clone()
                        } else {
                            serde_json::json!({ "type": "object", "properties": {} })
                        },
                    })
                })
                .collect()
        })
        .unwrap_or_default())
}

/// The text of an MCP tool result (`content` blocks), for the model.
pub fn mcp_result_text(result: &serde_json::Value) -> String {
    let mut parts = Vec::new();
    for c in result["content"].as_array().into_iter().flatten() {
        match c["type"].as_str() {
            Some("text") => parts.push(c["text"].as_str().unwrap_or("").to_string()),
            Some("image") => parts.push("[image]".into()),
            Some("resource") => parts.push(
                c["resource"]["text"]
                    .as_str()
                    .map(String::from)
                    .unwrap_or_else(|| {
                        format!("[resource {}]", c["resource"]["uri"].as_str().unwrap_or(""))
                    }),
            ),
            Some("resource_link") => {
                parts.push(format!("[link {}]", c["uri"].as_str().unwrap_or("")))
            }
            _ => {}
        }
    }
    if parts.is_empty() {
        if let Some(s) = result.get("structuredContent") {
            parts.push(s.to_string());
        }
    }
    let text = parts.join("\n");
    if text.len() > 100_000 {
        let mut cut = 100_000;
        while !text.is_char_boundary(cut) {
            cut -= 1;
        }
        format!(
            "{}\n… (cut off: the result was {} characters)",
            &text[..cut],
            text.len()
        )
    } else {
        text
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpCall {
    text: String,
    is_error: bool,
}

/// Calls one MCP tool.
#[tauri::command]
pub async fn ai_mcp_call(
    pool: tauri::State<'_, McpPool>,
    server: McpServerSpec,
    tool: String,
    args: serde_json::Value,
) -> CmdResult<McpCall> {
    let args = if args.is_object() {
        args
    } else {
        serde_json::json!({})
    };
    let v = pool
        .request(
            server,
            "tools/call",
            serde_json::json!({ "name": tool, "arguments": args }),
            Duration::from_secs(300),
        )
        .await?;
    if let Some(msg) = v["error"]["message"].as_str() {
        return Ok(McpCall {
            text: msg.to_string(),
            is_error: true,
        });
    }
    Ok(McpCall {
        text: mcp_result_text(&v["result"]),
        is_error: v["result"]["isError"].as_bool().unwrap_or(false),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root() -> PathBuf {
        let d = std::env::temp_dir().join(format!(
            "skele-tools-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(d.join("src")).unwrap();
        plain_path(std::fs::canonicalize(&d).unwrap())
    }

    #[test]
    fn file_tools_stay_inside_the_folder() {
        let root = temp_root();
        assert!(resolve_in(&root, "../escape.txt").is_err());
        assert!(resolve_in(&root, "src/../../escape.txt").is_err());
        assert!(resolve_in(&root, "C:/Windows/win.ini").is_err() || !cfg!(windows));
        assert!(resolve_in(&root, "/etc/passwd").is_err());
        assert_eq!(
            resolve_in(&root, "src/a.ts").unwrap(),
            root.join("src").join("a.ts")
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn reads_writes_edits_searches_and_lists() {
        let root = temp_root();
        let j = |v: serde_json::Value| v;
        // Read-only chats can't write.
        assert!(file_tool(
            &root,
            false,
            "write_file",
            &j(serde_json::json!({ "path": "a.txt", "content": "x" }))
        )
        .is_err());
        assert!(file_tool(
            &root,
            true,
            "write_file",
            &j(serde_json::json!({ "path": "src/a.txt", "content": "hello\r\nworld\r\n" }))
        )
        .unwrap()
        .starts_with("Created"));
        let read = file_tool(
            &root,
            false,
            "read_file",
            &j(serde_json::json!({ "path": "src/a.txt" })),
        )
        .unwrap();
        assert!(read.contains("    1\thello") && read.contains("    2\tworld"));
        // \n text matches a \r\n file.
        file_tool(&root, true, "edit_file", &j(serde_json::json!({ "path": "src/a.txt", "old_text": "hello\nworld", "new_text": "hi\nthere" }))).unwrap();
        assert_eq!(
            std::fs::read_to_string(root.join("src/a.txt")).unwrap(),
            "hi\r\nthere\r\n"
        );
        assert!(file_tool(
            &root,
            true,
            "edit_file",
            &j(serde_json::json!({ "path": "src/a.txt", "old_text": "nope", "new_text": "x" }))
        )
        .is_err());
        let found = file_tool(
            &root,
            false,
            "search_files",
            &j(serde_json::json!({ "query": "THERE" })),
        )
        .unwrap();
        assert!(found.contains("src/a.txt:2: there"), "{found}");
        std::fs::create_dir_all(root.join("node_modules/x")).unwrap();
        let list = file_tool(&root, false, "list_files", &j(serde_json::json!({}))).unwrap();
        assert!(
            list.contains("src/") && list.contains("a.txt") && !list.contains("node_modules"),
            "{list}"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn reads_mcp_tool_results() {
        let r = serde_json::json!({ "content": [{ "type": "text", "text": "a" }, { "type": "image", "data": "x" }, { "type": "text", "text": "b" }] });
        assert_eq!(mcp_result_text(&r), "a\n[image]\nb");
        assert_eq!(
            mcp_result_text(&serde_json::json!({ "content": [], "structuredContent": { "n": 1 } })),
            "{\"n\":1}"
        );
    }
}
