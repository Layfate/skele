//! Loopback redirect for desktop OAuth sign-ins (Spotify, Authorization Code + PKCE).
//!
//! Spotify only accepts `https://` or loopback-IP redirect URIs, and the desktop window's own
//! origin is neither. So the desktop app opens the sign-in page in the system browser with a
//! `http://127.0.0.1:<port>/callback` redirect URI and this module listens on that address just
//! long enough to receive the redirect. The page then finishes the PKCE exchange itself; no
//! secret is involved and nothing but the redirect's query string is read.
//!
//! The flow is split in two so failures show up before the browser opens:
//! 1. `oauth_start` binds the listener. It prefers port 43827 (redirect URIs registered with that
//!    port keep working) and falls back to a port the OS picks when 43827 is taken or reserved;
//!    Spotify accepts any port when the redirect URI is registered without one
//!    (`http://127.0.0.1/callback`). Starting again closes an earlier, abandoned attempt first,
//!    so a sign-in whose browser never opened can't hold the port.
//! 2. `oauth_wait` accepts connections until the redirect with the expected `state` arrives,
//!    the user cancels, or it times out. Every connection is handled on its own thread, so idle
//!    sockets that browsers open speculatively can't hold up the real redirect.

use serde::Serialize;
use std::io::{ErrorKind, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};

pub const PREFERRED_PORT: u16 = 43827;
const PATH: &str = "/callback";
const TIMEOUT: Duration = Duration::from_secs(300);

/// Errors reach the page as `{ code, message }`; the message is meant to be shown as is.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct OAuthError {
    pub code: &'static str,
    pub message: String,
}

impl OAuthError {
    fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

/// A listening sign-in: the redirect URI to send to Spotify, and why the preferred port
/// wasn't used (if it wasn't).
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OAuthSession {
    pub port: u16,
    pub redirect_uri: String,
    pub preferred_port: bool,
    pub preferred_port_error: Option<String>,
}

struct Pending {
    state: String,
    listener: Mutex<Option<TcpListener>>,
    cancelled: AtomicBool,
}

impl Pending {
    /// Stops the wait and releases the port right away.
    fn close(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
        lock(&self.listener).take();
    }
}

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Holds the one sign-in that can be in progress at a time.
pub struct Broker {
    current: Mutex<Option<Arc<Pending>>>,
}

fn bind(port: u16) -> std::io::Result<TcpListener> {
    let listener = TcpListener::bind(("127.0.0.1", port))?;
    listener.set_nonblocking(true)?;
    Ok(listener)
}

fn describe_bind_error(port: u16, e: &std::io::Error) -> String {
    match e.kind() {
        ErrorKind::AddrInUse => {
            format!("Port {port} on 127.0.0.1 is already in use by another program.")
        }
        // Windows reports ports reserved by Hyper-V / WSL / Docker as "access denied".
        ErrorKind::PermissionDenied => {
            format!("Port {port} on 127.0.0.1 is reserved by the system.")
        }
        _ => format!("Couldn't open port {port} on 127.0.0.1 ({e})."),
    }
}

impl Broker {
    pub const fn new() -> Self {
        Self {
            current: Mutex::new(None),
        }
    }

    pub fn start(&self, state: String, preferred: u16) -> Result<OAuthSession, OAuthError> {
        if state.is_empty() {
            return Err(OAuthError::new(
                "invalid_state",
                "The sign-in request is missing its state value.",
            ));
        }
        let mut slot = lock(&self.current);
        // An earlier attempt (a browser that never opened, a tab left open) gives up its port.
        if let Some(old) = slot.take() {
            old.close();
        }
        let (listener, preferred_port_error) = match bind(preferred) {
            Ok(listener) => (listener, None),
            Err(e) => {
                let reason = describe_bind_error(preferred, &e);
                match bind(0) {
                    Ok(listener) => (listener, Some(reason)),
                    Err(e) => {
                        return Err(OAuthError::new(
                            "listen_failed",
                            format!(
                                "{reason} Skele also couldn't open another local port for the sign-in ({e}). \
                                 Check that a firewall or security tool isn't blocking local connections, then try again."
                            ),
                        ))
                    }
                }
            }
        };
        let port = listener
            .local_addr()
            .map_err(|e| {
                OAuthError::new(
                    "listen_failed",
                    format!("Couldn't read the sign-in port ({e})."),
                )
            })?
            .port();
        *slot = Some(Arc::new(Pending {
            state,
            listener: Mutex::new(Some(listener)),
            cancelled: AtomicBool::new(false),
        }));
        Ok(OAuthSession {
            port,
            redirect_uri: format!("http://127.0.0.1:{port}{PATH}"),
            preferred_port: port == preferred,
            preferred_port_error,
        })
    }

    /// Waits for the browser to be redirected to the callback and returns its query string.
    pub fn wait(&self, timeout: Duration) -> Result<String, OAuthError> {
        let pending = lock(&self.current).clone().ok_or_else(|| {
            OAuthError::new(
                "no_session",
                "No Spotify sign-in is in progress. Click Connect Spotify to start one.",
            )
        })?;
        let (tx, rx) = mpsc::channel::<String>();
        let deadline = Instant::now() + timeout;
        let result = loop {
            if pending.cancelled.load(Ordering::SeqCst) {
                break Err(OAuthError::new("cancelled", "Sign-in cancelled."));
            }
            if let Ok(query) = rx.try_recv() {
                break Ok(query);
            }
            if Instant::now() > deadline {
                break Err(OAuthError::new(
                    "timeout",
                    format!(
                        "Spotify didn't send the sign-in back to Skele within {} minutes. Click Connect Spotify to try again.",
                        timeout.as_secs().div_ceil(60)
                    ),
                ));
            }
            let accepted = match lock(&pending.listener).as_ref() {
                Some(listener) => listener.accept(),
                None => continue, // closed: the cancelled check above ends the loop
            };
            match accepted {
                Ok((stream, _)) => {
                    let tx = tx.clone();
                    let state = pending.state.clone();
                    std::thread::spawn(move || handle(stream, &state, &tx));
                }
                Err(e) if e.kind() == ErrorKind::WouldBlock => {
                    std::thread::sleep(Duration::from_millis(50))
                }
                Err(e)
                    if matches!(
                        e.kind(),
                        ErrorKind::Interrupted
                            | ErrorKind::ConnectionAborted
                            | ErrorKind::ConnectionReset
                    ) => {}
                Err(e) => {
                    break Err(OAuthError::new(
                        "listen_failed",
                        format!("The local sign-in listener stopped ({e}). Please try again."),
                    ))
                }
            }
        };
        self.finish(&pending);
        result
    }

    /// Closes the sign-in in progress, if any.
    pub fn cancel(&self) {
        if let Some(pending) = lock(&self.current).take() {
            pending.close();
        }
    }

    fn finish(&self, pending: &Arc<Pending>) {
        let mut slot = lock(&self.current);
        if slot.as_ref().is_some_and(|p| Arc::ptr_eq(p, pending)) {
            slot.take();
        }
        pending.close();
    }
}

impl Default for Broker {
    fn default() -> Self {
        Self::new()
    }
}

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

fn query_param(query: &str, key: &str) -> Option<String> {
    let url = tauri::Url::parse(&format!("http://127.0.0.1/?{query}")).ok()?;
    url.query_pairs()
        .find(|(k, _)| k == key)
        .map(|(_, v)| v.into_owned())
}

#[derive(Debug, PartialEq)]
enum Callback {
    /// Spotify returned a code (or anything else for this sign-in): hand it to the page.
    Complete,
    /// Spotify returned an error for this sign-in, such as `access_denied`.
    Failed(String),
    /// A redirect from an older attempt (a stale tab): ignore it and keep waiting.
    Stale,
}

fn classify(query: &str, expected_state: &str) -> Callback {
    if query_param(query, "state").as_deref() != Some(expected_state) {
        return Callback::Stale;
    }
    match query_param(query, "error") {
        Some(error) => Callback::Failed(error),
        None => Callback::Complete,
    }
}

fn escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

fn page(title: &str, body: &str) -> String {
    format!(
        r#"<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Skele</title>
<style>body{{font:16px system-ui,sans-serif;display:grid;place-items:center;height:90vh;margin:0 16px;color:#222;background:#f7f6f3}}
@media (prefers-color-scheme:dark){{body{{color:#eee;background:#1c1c1c}}}}</style></head>
<body><div><h1 style="font-size:20px">{}</h1><p>{}</p></div></body></html>"#,
        escape(title),
        escape(body)
    )
}

fn respond(mut stream: TcpStream, status: &str, body: &str) {
    let _ = write!(
        stream,
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\nCache-Control: no-store\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.flush();
}

/// Reads the request head (up to 8 KB); browsers send the whole GET in one go.
fn read_head(stream: &mut TcpStream) -> String {
    let mut buf = Vec::with_capacity(1024);
    let mut chunk = [0u8; 2048];
    while buf.len() < 8192 {
        match stream.read(&mut chunk) {
            Ok(0) | Err(_) => break,
            Ok(n) => {
                buf.extend_from_slice(&chunk[..n]);
                if buf.windows(4).any(|w| w == b"\r\n\r\n") {
                    break;
                }
            }
        }
    }
    String::from_utf8_lossy(&buf).into_owned()
}

fn handle(mut stream: TcpStream, expected_state: &str, tx: &mpsc::Sender<String>) {
    let _ = stream.set_nonblocking(false);
    let _ = stream.set_read_timeout(Some(Duration::from_secs(10)));
    let request = read_head(&mut stream);
    let Some(query) = request_target(&request).and_then(callback_query) else {
        return respond(stream, "404 Not Found", "Not found");
    };
    match classify(&query, expected_state) {
        Callback::Complete => {
            respond(stream, "200 OK", &page("You can close this tab", "Return to Skele to finish connecting Spotify."));
            let _ = tx.send(query);
        }
        Callback::Failed(error) => {
            let text = if error == "access_denied" {
                "You didn't allow Skele to use your Spotify account. You can close this tab and connect again from Skele.".to_string()
            } else {
                format!("Spotify reported “{error}”. You can close this tab; Skele shows what to do next.")
            };
            respond(stream, "200 OK", &page("Spotify wasn't connected", &text));
            let _ = tx.send(query);
        }
        Callback::Stale => respond(
            stream,
            "400 Bad Request",
            &page(
                "This sign-in link has expired",
                "It belongs to an earlier attempt. Return to Skele and finish the sign-in that's open there, or click Connect Spotify again.",
            ),
        ),
    }
}

static BROKER: Broker = Broker::new();

#[tauri::command]
pub fn oauth_start(state: String) -> Result<OAuthSession, OAuthError> {
    BROKER.start(state, PREFERRED_PORT)
}

#[tauri::command]
pub async fn oauth_wait() -> Result<String, OAuthError> {
    tauri::async_runtime::spawn_blocking(|| BROKER.wait(TIMEOUT))
        .await
        .map_err(|e| OAuthError::new("internal", e.to_string()))?
}

#[tauri::command]
pub fn oauth_cancel() {
    BROKER.cancel();
}

#[cfg(test)]
mod tests {
    use super::*;

    fn get(port: u16, target: &str) -> String {
        let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
        write!(s, "GET {target} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n\r\n").unwrap();
        let mut reply = String::new();
        s.read_to_string(&mut reply).unwrap();
        reply
    }

    fn waiting(
        broker: &'static Broker,
        timeout: Duration,
    ) -> std::thread::JoinHandle<Result<String, OAuthError>> {
        std::thread::spawn(move || broker.wait(timeout))
    }

    fn leak() -> &'static Broker {
        Box::leak(Box::new(Broker::new()))
    }

    #[test]
    fn parses_callback() {
        assert_eq!(
            request_target("GET /callback?code=a&state=b HTTP/1.1\r\nHost: x\r\n\r\n"),
            Some("/callback?code=a&state=b")
        );
        assert_eq!(request_target("POST /callback HTTP/1.1"), None);
        assert_eq!(request_target(""), None);
        assert_eq!(
            callback_query("/callback?code=a&state=b").as_deref(),
            Some("code=a&state=b")
        );
        assert_eq!(callback_query("/callback").as_deref(), Some(""));
        assert_eq!(callback_query("/favicon.ico"), None);
    }

    #[test]
    fn classifies_callbacks_by_state() {
        assert_eq!(classify("code=x&state=s1", "s1"), Callback::Complete);
        assert_eq!(
            classify("error=access_denied&state=s1", "s1"),
            Callback::Failed("access_denied".into())
        );
        assert_eq!(classify("code=x&state=old", "s1"), Callback::Stale);
        assert_eq!(classify("code=x", "s1"), Callback::Stale);
        assert_eq!(classify("code=x&state=a%2Bb", "a+b"), Callback::Complete);
    }

    #[test]
    fn starts_on_the_preferred_port() {
        let broker = Broker::new();
        let session = broker.start("s".into(), 43901).unwrap();
        assert_eq!(session.port, 43901);
        assert!(session.preferred_port);
        assert_eq!(session.preferred_port_error, None);
        assert_eq!(session.redirect_uri, "http://127.0.0.1:43901/callback");
        broker.cancel();
    }

    #[test]
    fn falls_back_to_another_port_when_the_preferred_one_is_taken() {
        let _other_program = TcpListener::bind(("127.0.0.1", 43902)).unwrap();
        let broker = Broker::new();
        let session = broker.start("s".into(), 43902).unwrap();
        assert_ne!(session.port, 43902);
        assert!(!session.preferred_port);
        assert!(session.preferred_port_error.unwrap().contains("43902"));
        assert_eq!(
            session.redirect_uri,
            format!("http://127.0.0.1:{}/callback", session.port)
        );
        broker.cancel();
    }

    #[test]
    fn starting_again_releases_an_abandoned_attempt() {
        // The first attempt is never waited on (its browser didn't open, for example).
        let broker = Broker::new();
        assert_eq!(broker.start("first".into(), 43903).unwrap().port, 43903);
        let second = broker.start("second".into(), 43903).unwrap();
        assert_eq!(
            second.port, 43903,
            "the earlier listener must give the port back"
        );
        broker.cancel();
        // Cancelling frees it too.
        TcpListener::bind(("127.0.0.1", 43903)).expect("port released after cancel");
    }

    #[test]
    fn receives_the_redirect_and_ignores_other_requests() {
        let broker = leak();
        broker.start("s1".into(), 43904).unwrap();
        let server = waiting(broker, Duration::from_secs(10));
        // A browser's speculative, idle connection must not block anything.
        let _idle = TcpStream::connect(("127.0.0.1", 43904)).unwrap();
        assert!(get(43904, "/favicon.ico").starts_with("HTTP/1.1 404"));
        let stale = get(43904, "/callback?code=old&state=s0");
        assert!(stale.starts_with("HTTP/1.1 400") && stale.contains("expired"));
        let reply = get(43904, "/callback?code=xyz&state=s1");
        assert!(reply.starts_with("HTTP/1.1 200") && reply.contains("You can close this tab"));
        assert_eq!(server.join().unwrap().unwrap(), "code=xyz&state=s1");
        // Finished: the port is free again.
        TcpListener::bind(("127.0.0.1", 43904)).expect("port released after the redirect");
    }

    #[test]
    fn passes_spotify_errors_to_the_page() {
        let broker = leak();
        broker.start("s1".into(), 43905).unwrap();
        let server = waiting(broker, Duration::from_secs(10));
        let reply = get(43905, "/callback?error=access_denied&state=s1");
        assert!(reply.contains("didn&#39;t allow") || reply.contains("didn't allow"));
        assert_eq!(
            server.join().unwrap().unwrap(),
            "error=access_denied&state=s1"
        );
    }

    #[test]
    fn cancel_ends_the_wait_and_frees_the_port() {
        let broker = leak();
        broker.start("s1".into(), 43906).unwrap();
        let server = waiting(broker, Duration::from_secs(10));
        std::thread::sleep(Duration::from_millis(150));
        broker.cancel();
        assert_eq!(server.join().unwrap().unwrap_err().code, "cancelled");
        TcpListener::bind(("127.0.0.1", 43906)).expect("port released after cancel");
    }

    #[test]
    fn a_new_start_cancels_the_previous_wait() {
        let broker = leak();
        broker.start("s1".into(), 43907).unwrap();
        let old = waiting(broker, Duration::from_secs(10));
        std::thread::sleep(Duration::from_millis(150));
        broker.start("s2".into(), 43907).unwrap();
        assert_eq!(old.join().unwrap().unwrap_err().code, "cancelled");
        let new = waiting(broker, Duration::from_secs(10));
        assert!(get(43907, "/callback?code=c&state=s2").starts_with("HTTP/1.1 200"));
        assert_eq!(new.join().unwrap().unwrap(), "code=c&state=s2");
    }

    #[test]
    fn times_out() {
        let broker = Broker::new();
        broker.start("s1".into(), 43908).unwrap();
        let err = broker.wait(Duration::from_millis(200)).unwrap_err();
        assert_eq!(err.code, "timeout");
        TcpListener::bind(("127.0.0.1", 43908)).expect("port released after timeout");
    }

    #[test]
    fn waiting_without_a_sign_in_is_an_error() {
        assert_eq!(
            Broker::new().wait(Duration::from_secs(1)).unwrap_err().code,
            "no_session"
        );
        assert_eq!(
            Broker::new().start(String::new(), 43909).unwrap_err().code,
            "invalid_state"
        );
    }
}
