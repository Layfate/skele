//! Commands the Skele page can call (see `src/lib/desktop.ts` and `src/data/adapters/sqlite.ts`).
//! The page gets no general file-system or shell access: storage goes through the SQLite
//! engine, and files are only written where the user picks in a native save dialog.

use crate::paths::{DataLocation, DataSource};
use crate::storage::{Engine, Op, TableSpec};
use serde::Serialize;
use serde_json::value::RawValue;
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{AppHandle, State};

type CmdResult<T> = Result<T, String>;

fn raw(rows: Vec<String>) -> CmdResult<Vec<Box<RawValue>>> {
    rows.into_iter()
        .map(|r| RawValue::from_string(r).map_err(|e| e.to_string()))
        .collect()
}

fn header<'a>(request: &'a Request<'_>, name: &str) -> CmdResult<&'a str> {
    request
        .headers()
        .get(name)
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| format!("Missing {name} header"))
}

fn raw_body<'a>(request: &'a Request<'_>) -> CmdResult<&'a [u8]> {
    match request.body() {
        InvokeBody::Raw(bytes) => Ok(bytes),
        InvokeBody::Json(_) => Err("Expected binary data".into()),
    }
}

/// `%XX` decoding for header values (the page encodes file names with encodeURIComponent).
fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Some(b) = std::str::from_utf8(&bytes[i + 1..i + 3])
                .ok()
                .and_then(|h| u8::from_str_radix(h, 16).ok())
            {
                out.push(b);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

// ── Storage ────────────────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn db_open(
    engine: State<'_, Engine>,
    db: String,
    tables: Vec<TableSpec>,
) -> CmdResult<()> {
    engine.open(&db, &tables)
}

#[tauri::command]
pub async fn db_get(
    engine: State<'_, Engine>,
    db: String,
    table: String,
    keys: Vec<String>,
) -> CmdResult<Vec<Option<Box<RawValue>>>> {
    engine
        .get_rows(&db, &table, &keys)?
        .into_iter()
        .map(|r| {
            r.map(|s| RawValue::from_string(s).map_err(|e| e.to_string()))
                .transpose()
        })
        .collect()
}

#[tauri::command]
pub async fn db_all(
    engine: State<'_, Engine>,
    db: String,
    table: String,
) -> CmdResult<Vec<Box<RawValue>>> {
    raw(engine.all(&db, &table)?)
}

#[tauri::command]
pub async fn db_where(
    engine: State<'_, Engine>,
    db: String,
    table: String,
    field: String,
    value: String,
) -> CmdResult<Vec<Box<RawValue>>> {
    raw(engine.find(&db, &table, &field, &value)?)
}

#[tauri::command]
pub async fn db_count(engine: State<'_, Engine>, db: String, table: String) -> CmdResult<u64> {
    engine.count(&db, &table)
}

#[tauri::command]
pub async fn db_commit(engine: State<'_, Engine>, db: String, ops: Vec<Op>) -> CmdResult<()> {
    engine.commit(&db, &ops)
}

#[tauri::command]
pub async fn db_destroy(engine: State<'_, Engine>, db: String) -> CmdResult<()> {
    engine.destroy(&db)
}

/// Binary body; headers `x-skele-db`, `x-skele-table`, `x-skele-key`.
#[tauri::command]
pub async fn blob_write(engine: State<'_, Engine>, request: Request<'_>) -> CmdResult<()> {
    let bytes = raw_body(&request)?;
    engine.write_blob(
        header(&request, "x-skele-db")?,
        header(&request, "x-skele-table")?,
        header(&request, "x-skele-key")?,
        bytes,
    )
}

/// Returns the bytes as an ArrayBuffer (empty with `found = false` semantics handled by the
/// page: a missing file returns an error the page reports).
#[tauri::command]
pub async fn blob_read(
    engine: State<'_, Engine>,
    db: String,
    table: String,
    key: String,
) -> CmdResult<Response> {
    match engine.read_blob(&db, &table, &key)? {
        Some(bytes) => Ok(Response::new(bytes)),
        None => Err(format!("missing:{key}")),
    }
}

// ── Files ──────────────────────────────────────────────────────────────────────────────

/// Shows a native save dialog and writes the request body to the chosen file. Returns the
/// path, or `None` if the user cancelled. Header: `x-skele-filename` (URI-encoded).
#[tauri::command]
pub async fn save_file(app: AppHandle, request: Request<'_>) -> CmdResult<Option<String>> {
    use tauri_plugin_dialog::DialogExt;
    let bytes = raw_body(&request)?.to_vec();
    let name = percent_decode(header(&request, "x-skele-filename").unwrap_or("Skele export"));
    let mut dialog = app.dialog().file().set_file_name(&name);
    if let Some((_, ext)) = name.rsplit_once('.') {
        if !ext.is_empty() && ext.len() <= 10 && ext.chars().all(|c| c.is_ascii_alphanumeric()) {
            dialog = dialog.add_filter(ext.to_uppercase(), &[ext]);
        }
    }
    let Some(target) = dialog.blocking_save_file() else {
        return Ok(None);
    };
    let path = target.into_path().map_err(|e| e.to_string())?;
    std::fs::write(&path, bytes).map_err(|e| format!("Couldn't save the file: {e}"))?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

// ── App info ───────────────────────────────────────────────────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    version: String,
    os: &'static str,
    arch: &'static str,
    data_dir: String,
    data_source: DataSource,
    portable: bool,
    /// How this copy gets updates: "app" (in-app updater), "portable" (download a new
    /// archive), "package" (system package manager / new package), "unconfigured" (this build
    /// has no update source, e.g. a local build).
    update_mode: &'static str,
    /// GitHub releases page, when the build has one configured.
    releases_url: Option<String>,
}

pub struct UpdateSource {
    pub endpoint: Option<String>,
    pub has_pubkey: bool,
}

impl UpdateSource {
    pub fn from_config(app: &AppHandle) -> Self {
        let cfg = app.config().plugins.0.get("updater");
        let endpoint = cfg
            .and_then(|c| c.get("endpoints"))
            .and_then(|e| e.as_array())
            .and_then(|a| a.first())
            .and_then(|e| e.as_str())
            .map(str::to_string);
        let has_pubkey = cfg
            .and_then(|c| c.get("pubkey"))
            .and_then(|p| p.as_str())
            .is_some_and(|p| !p.trim().is_empty());
        Self {
            endpoint,
            has_pubkey,
        }
    }

    /// `https://github.com/OWNER/REPO/releases/...` → `https://github.com/OWNER/REPO/releases`
    pub fn releases_url(&self) -> Option<String> {
        let rest = self
            .endpoint
            .as_deref()?
            .strip_prefix("https://github.com/")?;
        let mut parts = rest.split('/');
        let (owner, repo) = (parts.next()?, parts.next()?);
        (!owner.is_empty() && !repo.is_empty())
            .then(|| format!("https://github.com/{owner}/{repo}/releases"))
    }
}

pub fn update_mode(source: &UpdateSource, location: &DataLocation) -> &'static str {
    if source.endpoint.is_none() || !source.has_pubkey {
        "unconfigured"
    } else if location.portable() {
        "portable"
    } else if cfg!(target_os = "linux") && std::env::var_os("APPIMAGE").is_none() {
        // .deb, .rpm and the tarball are updated by installing the new package.
        "package"
    } else {
        "app"
    }
}

#[tauri::command]
pub fn app_info(app: AppHandle, location: State<'_, DataLocation>) -> AppInfo {
    let source = UpdateSource::from_config(&app);
    AppInfo {
        version: app.package_info().version.to_string(),
        os: std::env::consts::OS,
        arch: std::env::consts::ARCH,
        data_dir: location.root.to_string_lossy().into_owned(),
        data_source: location.source,
        portable: location.portable(),
        update_mode: update_mode(&source, &location),
        releases_url: source.releases_url(),
    }
}

/// Opens the data folder in the system file manager.
#[tauri::command]
pub fn open_data_dir(app: AppHandle, location: State<'_, DataLocation>) -> CmdResult<()> {
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_path(location.root.to_string_lossy(), None::<&str>)
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_file_names() {
        assert_eq!(
            percent_decode("My%20notes%20%E2%9C%93.skele"),
            "My notes ✓.skele"
        );
        assert_eq!(percent_decode("100%"), "100%");
        assert_eq!(percent_decode("a%zzb"), "a%zzb");
    }

    #[test]
    fn releases_url_from_endpoint() {
        let s = UpdateSource {
            endpoint: Some(
                "https://github.com/acme/skele/releases/latest/download/latest.json".into(),
            ),
            has_pubkey: true,
        };
        assert_eq!(
            s.releases_url().as_deref(),
            Some("https://github.com/acme/skele/releases")
        );
        let other = UpdateSource {
            endpoint: Some("https://example.com/latest.json".into()),
            has_pubkey: true,
        };
        assert!(other.releases_url().is_none());
    }

    #[test]
    fn update_modes() {
        let loc = DataLocation {
            root: "/d".into(),
            source: DataSource::Default,
        };
        let none = UpdateSource {
            endpoint: None,
            has_pubkey: true,
        };
        assert_eq!(update_mode(&none, &loc), "unconfigured");
        let ok = UpdateSource {
            endpoint: Some("https://github.com/a/b/x".into()),
            has_pubkey: true,
        };
        let portable = DataLocation {
            root: "/d".into(),
            source: DataSource::Portable,
        };
        assert_eq!(update_mode(&ok, &portable), "portable");
        if !cfg!(target_os = "linux") {
            assert_eq!(update_mode(&ok, &loc), "app");
        }
    }
}
