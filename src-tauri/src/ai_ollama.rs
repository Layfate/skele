//! Local AI through Ollama (<https://ollama.com>). Ollama runs its own server on this computer
//! (`http://127.0.0.1:11434` by default); Skele talks to it from here rather than from the
//! page, so the desktop app needs no network exception in its content security policy and
//! Ollama's browser-origin rules don't apply. Only Ollama's `/api/*` endpoints on the
//! configured address are ever requested. Nothing leaves the computer unless the user points
//! Skele at an Ollama server elsewhere.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::ipc::Channel;
use tauri::State;

use crate::ai::{command, which, CmdResult};

pub const DEFAULT_URL: &str = "http://127.0.0.1:11434";

/// Streaming Ollama requests by run id; setting the flag stops one.
#[derive(Default, Clone)]
pub struct OllamaRuns(Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>);

/// The `ollama` program: the user's override, else PATH and the usual install folders.
pub fn find_ollama(custom: Option<&str>) -> Option<PathBuf> {
    if let Some(c) = custom.map(str::trim).filter(|s| !s.is_empty()) {
        let p = PathBuf::from(c);
        return p.is_file().then_some(p);
    }
    which("ollama")
}

/// `http(s)://host[:port]` with nothing after it (a trailing slash is dropped).
pub fn base_url(raw: Option<&str>) -> CmdResult<String> {
    let s = raw
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(DEFAULT_URL);
    let s = s.trim_end_matches('/');
    let rest = s
        .strip_prefix("http://")
        .or_else(|| s.strip_prefix("https://"))
        .ok_or("The Ollama address must start with http:// or https://")?;
    let host_ok = !rest.is_empty()
        && rest.len() <= 255
        && rest
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || ".-:[]".contains(c));
    if !host_ok {
        return Err("The Ollama address should look like http://127.0.0.1:11434".into());
    }
    Ok(s.to_string())
}

fn valid_model(m: &str) -> bool {
    !m.is_empty()
        && m.len() <= 200
        && m.chars()
            .all(|c| c.is_ascii_alphanumeric() || "-_.:/@".contains(c))
}

fn client(timeout: Option<Duration>) -> CmdResult<reqwest::Client> {
    // reqwest is built without a default TLS provider (shared with the updater).
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }
    let mut b = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(5))
        .no_proxy();
    if let Some(t) = timeout {
        b = b.timeout(t);
    }
    b.build().map_err(|e| e.to_string())
}

fn friendly(e: reqwest::Error, base: &str) -> String {
    if e.is_connect() {
        format!("Ollama isn't running at {base}. Start the Ollama app (or `ollama serve`) and try again.")
    } else if e.is_timeout() {
        "Ollama took too long to answer.".into()
    } else {
        format!("Ollama: {e}")
    }
}

/// Ollama's error body is `{"error": "..."}`.
async fn error_body(resp: reqwest::Response) -> String {
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    serde_json::from_str::<serde_json::Value>(&text)
        .ok()
        .and_then(|v| v["error"].as_str().map(String::from))
        .unwrap_or_else(|| format!("Ollama answered {status}"))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OllamaStatus {
    /// Path of the `ollama` program, if installed here.
    binary: Option<String>,
    running: bool,
    version: Option<String>,
    url: String,
}

#[tauri::command]
pub async fn ai_ollama_status(
    url: Option<String>,
    path: Option<String>,
) -> CmdResult<OllamaStatus> {
    let base = base_url(url.as_deref())?;
    let binary = find_ollama(path.as_deref()).map(|p| p.display().to_string());
    let http = client(Some(Duration::from_secs(4)))?;
    let version = match http.get(format!("{base}/api/version")).send().await {
        Ok(r) if r.status().is_success() => r
            .json::<serde_json::Value>()
            .await
            .ok()
            .and_then(|v| v["version"].as_str().map(String::from)),
        _ => None,
    };
    Ok(OllamaStatus {
        binary,
        running: version.is_some(),
        version,
        url: base,
    })
}

/// Installed models (`/api/tags`), as Ollama reports them.
#[tauri::command]
pub async fn ai_ollama_models(url: Option<String>) -> CmdResult<serde_json::Value> {
    let base = base_url(url.as_deref())?;
    let resp = client(Some(Duration::from_secs(10)))?
        .get(format!("{base}/api/tags"))
        .send()
        .await
        .map_err(|e| friendly(e, &base))?;
    if !resp.status().is_success() {
        return Err(error_body(resp).await);
    }
    let v: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    Ok(v["models"].clone())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OllamaChatArgs {
    run_id: String,
    url: Option<String>,
    model: String,
    /// `[{ role: "system" | "user" | "assistant", content }]`
    messages: Vec<serde_json::Value>,
    /// Context window in tokens (`num_ctx`).
    num_ctx: Option<u32>,
    /// Ask thinking models to think (and stream it separately).
    think: Option<bool>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamResult {
    cancelled: bool,
}

fn register(runs: &OllamaRuns, id: &str) -> CmdResult<Arc<AtomicBool>> {
    if !crate::ai::valid_token(id) {
        return Err("Invalid run id".into());
    }
    let flag = Arc::new(AtomicBool::new(false));
    runs.0.lock().unwrap().insert(id.to_string(), flag.clone());
    Ok(flag)
}

/// Sends each newline-delimited JSON object of a streaming response to `on_event`.
async fn pump(
    mut resp: reqwest::Response,
    stop: &AtomicBool,
    on_event: &Channel<String>,
) -> CmdResult<bool> {
    let mut buf: Vec<u8> = Vec::new();
    loop {
        if stop.load(Ordering::Relaxed) {
            return Ok(true);
        }
        let chunk = match tokio_timeout(resp.chunk()).await {
            Some(c) => c.map_err(|e| e.to_string())?,
            None => continue, // no data for a moment: check the stop flag again
        };
        let Some(chunk) = chunk else { break };
        buf.extend_from_slice(&chunk);
        while let Some(i) = buf.iter().position(|b| *b == b'\n') {
            let line: Vec<u8> = buf.drain(..=i).collect();
            let line = String::from_utf8_lossy(&line).trim().to_string();
            if !line.is_empty() && on_event.send(line).is_err() {
                return Ok(true);
            }
        }
    }
    let rest = String::from_utf8_lossy(&buf).trim().to_string();
    if !rest.is_empty() {
        let _ = on_event.send(rest);
    }
    Ok(stop.load(Ordering::Relaxed))
}

/// Waits up to half a second for the next chunk, so a stop request is noticed quickly even
/// while a model is still loading.
async fn tokio_timeout<F: std::future::Future>(f: F) -> Option<F::Output> {
    tokio::time::timeout(Duration::from_millis(500), f)
        .await
        .ok()
}

/// One chat turn; Ollama's NDJSON lines are streamed to `on_event`.
#[tauri::command]
pub async fn ai_ollama_chat(
    runs: State<'_, OllamaRuns>,
    args: OllamaChatArgs,
    on_event: Channel<String>,
) -> CmdResult<StreamResult> {
    let base = base_url(args.url.as_deref())?;
    if !valid_model(&args.model) {
        return Err("Choose an Ollama model first.".into());
    }
    let runs = runs.inner().clone();
    let stop = register(&runs, &args.run_id)?;
    let mut body = serde_json::json!({
        "model": args.model,
        "messages": args.messages,
        "stream": true,
    });
    if let Some(n) = args.num_ctx.filter(|n| (512..=1_048_576).contains(n)) {
        body["options"] = serde_json::json!({ "num_ctx": n });
    }
    if let Some(t) = args.think {
        body["think"] = t.into();
    }
    let result = async {
        let mut send = Box::pin(
            client(None)?
                .post(format!("{base}/api/chat"))
                .json(&body)
                .send(),
        );
        // The request itself can take a while (the model loads first); keep checking for stop.
        let resp = loop {
            if stop.load(Ordering::Relaxed) {
                return Ok(true);
            }
            if let Some(r) = tokio_timeout(&mut send).await {
                break r.map_err(|e| friendly(e, &base))?;
            }
        };
        if !resp.status().is_success() {
            return Err(error_body(resp).await);
        }
        pump(resp, &stop, &on_event).await
    }
    .await;
    runs.0.lock().unwrap().remove(&args.run_id);
    result.map(|cancelled| StreamResult { cancelled })
}

#[tauri::command]
pub fn ai_ollama_cancel(runs: State<'_, OllamaRuns>, run_id: String) {
    if let Some(flag) = runs.0.lock().unwrap().remove(&run_id) {
        flag.store(true, Ordering::Relaxed);
    }
}

/// Downloads a model (`/api/pull`); progress lines are streamed to `on_event`.
#[tauri::command]
pub async fn ai_ollama_pull(
    runs: State<'_, OllamaRuns>,
    run_id: String,
    url: Option<String>,
    model: String,
    on_event: Channel<String>,
) -> CmdResult<StreamResult> {
    let base = base_url(url.as_deref())?;
    if !valid_model(&model) {
        return Err("That isn't a valid model name (e.g. llama3.2 or qwen3:8b).".into());
    }
    let runs = runs.inner().clone();
    let stop = register(&runs, &run_id)?;
    let result = async {
        let resp = client(None)?
            .post(format!("{base}/api/pull"))
            .json(&serde_json::json!({ "model": model, "stream": true }))
            .send()
            .await
            .map_err(|e| friendly(e, &base))?;
        if !resp.status().is_success() {
            return Err(error_body(resp).await);
        }
        pump(resp, &stop, &on_event).await
    }
    .await;
    runs.0.lock().unwrap().remove(&run_id);
    result.map(|cancelled| StreamResult { cancelled })
}

#[tauri::command]
pub async fn ai_ollama_delete(url: Option<String>, model: String) -> CmdResult<()> {
    let base = base_url(url.as_deref())?;
    if !valid_model(&model) {
        return Err("Invalid model name".into());
    }
    let resp = client(Some(Duration::from_secs(30)))?
        .delete(format!("{base}/api/delete"))
        .json(&serde_json::json!({ "model": model }))
        .send()
        .await
        .map_err(|e| friendly(e, &base))?;
    if !resp.status().is_success() {
        return Err(error_body(resp).await);
    }
    Ok(())
}

/// Starts `ollama serve` in the background (when Ollama is installed but not running). The
/// server keeps running after Skele quits, like the Ollama app does.
#[tauri::command]
pub async fn ai_ollama_start(path: Option<String>) -> CmdResult<()> {
    let exe = find_ollama(path.as_deref())
        .ok_or("Ollama isn't installed. Get it from ollama.com, then try again.")?;
    command(&exe)
        .arg("serve")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("Couldn't start Ollama: {e}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base_urls() {
        assert_eq!(base_url(None).unwrap(), DEFAULT_URL);
        assert_eq!(
            base_url(Some(" http://localhost:11434/ ")).unwrap(),
            "http://localhost:11434"
        );
        assert_eq!(
            base_url(Some("https://[::1]:8080")).unwrap(),
            "https://[::1]:8080"
        );
        assert!(base_url(Some("ftp://x")).is_err());
        assert!(base_url(Some("http://host/api/evil")).is_err());
        assert!(base_url(Some("http://a b")).is_err());
    }

    /// A fake Ollama: answers /api/version, /api/tags and a chunked /api/chat stream whose
    /// JSON lines are split across chunks.
    fn fake_ollama() -> String {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        std::thread::spawn(move || {
            for stream in listener.incoming().take(8) {
                let Ok(mut s) = stream else { continue };
                let mut buf = [0u8; 8192];
                let n = s.read(&mut buf).unwrap_or(0);
                let req = String::from_utf8_lossy(&buf[..n]).to_string();
                let path = req.split_whitespace().nth(1).unwrap_or("").to_string();
                const CRLF: &str = "\r\n";
                let head = |status: &str, kind: &str, extra: &str| {
                    let lines = [
                        format!("HTTP/1.1 {status}"),
                        format!("Content-Type: {kind}"),
                        extra.to_string(),
                        "Connection: close".into(),
                    ];
                    format!("{}{CRLF}{CRLF}", lines.join(CRLF))
                };
                let json = |body: &str, status: &str| {
                    format!(
                        "{}{body}",
                        head(
                            status,
                            "application/json",
                            &format!("Content-Length: {}", body.len())
                        )
                    )
                };
                let reply = match path.as_str() {
                    "/api/version" => json(r#"{"version":"0.9.1"}"#, "200 OK"),
                    "/api/tags" => json(
                        r#"{"models":[{"name":"llama3.2:latest","size":2000000000}]}"#,
                        "200 OK",
                    ),
                    "/api/chat" if req.contains("missing") => json(
                        r#"{"error":"model 'missing' not found, try pulling it first"}"#,
                        "404 Not Found",
                    ),
                    "/api/chat" => {
                        let lines = [
                            r#"{"message":{"content":"Hel"}}"#,
                            r#"{"message":{"content":"lo"}}"#,
                            r#"{"done":true,"eval_count":2}"#,
                            "",
                        ]
                        .join("\n");
                        let (a, b) = lines.split_at(20); // split mid-line
                        let mut r = head(
                            "200 OK",
                            "application/x-ndjson",
                            "Transfer-Encoding: chunked",
                        );
                        for part in [a, b] {
                            r.push_str(&format!("{:x}{CRLF}{part}{CRLF}", part.len()));
                        }
                        r.push_str(&format!("0{CRLF}{CRLF}"));
                        r
                    }
                    _ => json(r#"{"error":"nope"}"#, "404 Not Found"),
                };
                let _ = s.write_all(reply.as_bytes());
            }
        });
        format!("http://{addr}")
    }

    #[test]
    fn talks_to_ollama() {
        let url = fake_ollama();
        tauri::async_runtime::block_on(async {
            let st = ai_ollama_status(Some(url.clone()), None).await.unwrap();
            assert!(st.running);
            assert_eq!(st.version.as_deref(), Some("0.9.1"));
            let models = ai_ollama_models(Some(url.clone())).await.unwrap();
            assert_eq!(models[0]["name"], "llama3.2:latest");

            let lines = Arc::new(Mutex::new(Vec::<String>::new()));
            let sink = lines.clone();
            let channel: Channel<String> = Channel::new(move |body| {
                if let tauri::ipc::InvokeResponseBody::Json(s) = body {
                    sink.lock()
                        .unwrap()
                        .push(serde_json::from_str::<String>(&s).unwrap());
                }
                Ok(())
            });
            let resp = client(None)
                .unwrap()
                .post(format!("{url}/api/chat"))
                .body("{}")
                .send()
                .await
                .unwrap();
            let stop = AtomicBool::new(false);
            assert!(!pump(resp, &stop, &channel).await.unwrap());
            let got = lines.lock().unwrap().clone();
            assert_eq!(got.len(), 3, "{got:?}");
            assert!(got[0].contains("Hel") && got[2].contains("done"));

            let err = client(None)
                .unwrap()
                .post(format!("{url}/api/chat"))
                .body(r#"{"model":"missing"}"#)
                .send()
                .await
                .unwrap();
            assert!(!err.status().is_success());
            assert!(error_body(err).await.contains("not found"));
        });
        // Nothing listening: a friendly message, not a raw error.
        let closed =
            tauri::async_runtime::block_on(ai_ollama_models(Some("http://127.0.0.1:9".into())));
        assert!(closed.unwrap_err().contains("isn't running"));
    }

    #[test]
    fn model_names() {
        assert!(valid_model("llama3.2"));
        assert!(valid_model("hf.co/user/model:Q4_K_M"));
        assert!(!valid_model(""));
        assert!(!valid_model("a b"));
        assert!(!valid_model("x\"y"));
    }
}
