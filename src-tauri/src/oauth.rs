//! Loopback redirect for desktop OAuth sign-ins (Spotify).
//!
//! Spotify only accepts `https://` or loopback-IP redirect URIs, and the desktop window's own
//! origin is neither. So the desktop app opens the sign-in page in the system browser with
//! the redirect URI `http://127.0.0.1:43827/callback`, and this module listens on that one
//! address just long enough to receive the redirect. The page then finishes the PKCE exchange
//! itself; no secret is involved and nothing but the redirect's query string is read.

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

pub const PORT: u16 = 43827;
const PATH: &str = "/callback";
const TIMEOUT: Duration = Duration::from_secs(300);

static CANCEL: AtomicBool = AtomicBool::new(false);

const DONE_PAGE: &str = r#"<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Skele</title>
<style>body{font:16px system-ui,sans-serif;display:grid;place-items:center;height:90vh;color:#222;background:#f7f6f3}
@media (prefers-color-scheme:dark){body{color:#eee;background:#1c1c1c}}</style></head>
<body><div><h1 style="font-size:20px">You can close this tab</h1><p>Return to Skele to finish connecting.</p></div></body></html>"#;

/// Path and query of an HTTP request line ("GET /callback?code=… HTTP/1.1").
fn request_target(request: &str) -> Option<&str> {
    let line = request.lines().next()?;
    let mut parts = line.split_whitespace();
    (parts.next()? == "GET").then_some(())?;
    parts.next()
}

/// The query string if `target` is the callback path.
pub fn callback_query(target: &str) -> Option<String> {
    let (path, query) = target.split_once('?').unwrap_or((target, ""));
    (path == PATH).then(|| query.to_string())
}

fn respond(mut stream: TcpStream, status: &str, body: &str) {
    let _ = write!(
        stream,
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\nCache-Control: no-store\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.flush();
}

/// Waits for the browser to be redirected to the callback and returns its query string.
pub fn wait_for_redirect(port: u16, timeout: Duration) -> Result<String, String> {
    CANCEL.store(false, Ordering::SeqCst);
    let listener = TcpListener::bind(("127.0.0.1", port))
        .map_err(|e| format!("Couldn't listen on 127.0.0.1:{port} for the sign-in ({e}). Is another sign-in still open?"))?;
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let deadline = Instant::now() + timeout;
    loop {
        if CANCEL.load(Ordering::SeqCst) {
            return Err("Sign-in cancelled.".into());
        }
        if Instant::now() > deadline {
            return Err("The sign-in timed out. Please try again.".into());
        }
        match listener.accept() {
            Ok((mut stream, _)) => {
                let _ = stream.set_nonblocking(false);
                let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
                let mut buf = [0u8; 8192];
                let n = stream.read(&mut buf).unwrap_or(0);
                let request = String::from_utf8_lossy(&buf[..n]);
                match request_target(&request).and_then(callback_query) {
                    Some(query) => {
                        respond(stream, "200 OK", DONE_PAGE);
                        return Ok(query);
                    }
                    None => respond(stream, "404 Not Found", "Not found"),
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(100))
            }
            Err(e) => return Err(e.to_string()),
        }
    }
}

#[tauri::command]
pub async fn oauth_wait() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(|| wait_for_redirect(PORT, TIMEOUT))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn oauth_cancel() {
    CANCEL.store(true, Ordering::SeqCst);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_callback() {
        assert_eq!(
            request_target("GET /callback?code=a&state=b HTTP/1.1\r\nHost: x\r\n\r\n"),
            Some("/callback?code=a&state=b")
        );
        assert_eq!(request_target("POST /callback HTTP/1.1"), None);
        assert_eq!(
            callback_query("/callback?code=a&state=b").as_deref(),
            Some("code=a&state=b")
        );
        assert_eq!(callback_query("/callback").as_deref(), Some(""));
        assert_eq!(callback_query("/favicon.ico"), None);
    }

    #[test]
    fn receives_redirect_over_loopback() {
        let port = 43899;
        let server = std::thread::spawn(move || wait_for_redirect(port, Duration::from_secs(10)));
        std::thread::sleep(Duration::from_millis(300));
        // Unrelated requests (favicon) are ignored.
        let mut other = TcpStream::connect(("127.0.0.1", port)).unwrap();
        other
            .write_all(b"GET /favicon.ico HTTP/1.1\r\n\r\n")
            .unwrap();
        let mut reply = String::new();
        other.read_to_string(&mut reply).unwrap();
        assert!(reply.starts_with("HTTP/1.1 404"));
        let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
        s.write_all(b"GET /callback?code=xyz&state=s1 HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n")
            .unwrap();
        let mut reply = String::new();
        s.read_to_string(&mut reply).unwrap();
        assert!(reply.contains("You can close this tab"));
        assert_eq!(server.join().unwrap().unwrap(), "code=xyz&state=s1");
    }
}
