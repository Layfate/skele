//! SQLite storage for the desktop app.
//!
//! The web build keeps workspaces in IndexedDB. The desktop app keeps them here instead, in
//! ordinary SQLite files the user can see, copy and back up:
//!
//! ```text
//! <data root>/
//!   skele.sqlite3                      registry: workspace list, preferences, recovery-point index
//!   recovery-points/<id>               compressed recovery points (one file each)
//!   workspaces/<workspace id>/
//!     workspace.sqlite3                pages, tasks, projects, databases, … (one table each)
//!     attachments/<file id>            attachment bytes, exactly as uploaded
//!   backups/                           automatic copies taken before a schema migration
//! ```
//!
//! Every entity table has the same shape: `key` (primary key) and `data` (the row as JSON),
//! plus expression indexes on the JSON fields the app looks rows up by. The TypeScript side
//! (`src/data/adapters/sqlite.ts`) declares the tables when it opens a database, so adding a
//! table or index is non-destructive. Changes to the layout itself go through [`MIGRATIONS`],
//! which back up the file first.

use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::Deserialize;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// Version of the on-disk layout, stored in `PRAGMA user_version`.
pub const SCHEMA_VERSION: u32 = 1;

pub struct Migration {
    /// The version this migration upgrades to.
    pub to: u32,
    pub run: fn(&Transaction) -> rusqlite::Result<()>,
}

/// Layout migrations, oldest first. Every migration runs after a backup copy of the file has
/// been written to `<data root>/backups/`, inside a transaction: it either completes or the
/// file is left untouched.
pub const MIGRATIONS: &[Migration] = &[];

pub type Result<T> = std::result::Result<T, String>;

fn err<E: std::fmt::Display>(context: &str) -> impl Fn(E) -> String + '_ {
    move |e| format!("{context}: {e}")
}

#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TableSpec {
    pub name: String,
    /// Fields that get an index and can be used with `where`.
    #[serde(default)]
    pub indexes: Vec<String>,
    /// Folder (inside the database's folder) that holds this table's binary data, if any.
    #[serde(default)]
    pub blob_dir: Option<String>,
}

/// One write in a commit. `data` is a plain JSON value: Tauri hands command arguments over as
/// parsed JSON, which `RawValue` can't be deserialized from.
#[derive(Debug, Deserialize)]
#[serde(tag = "op", rename_all = "lowercase")]
pub enum Op {
    Put {
        table: String,
        key: String,
        data: serde_json::Value,
    },
    Delete {
        table: String,
        key: String,
    },
    Clear {
        table: String,
    },
}

fn is_ident(s: &str) -> bool {
    let mut chars = s.chars();
    matches!(chars.next(), Some(c) if c.is_ascii_alphabetic())
        && s.len() <= 64
        && chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
}

/// Keys double as file names for binary data, so they're restricted to a safe alphabet.
pub fn is_safe_key(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 128
        && !s.starts_with('.')
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Which database: the app registry or one workspace.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DbName {
    Registry,
    Workspace(String),
}

impl DbName {
    pub fn parse(s: &str) -> Result<Self> {
        if s == "registry" {
            return Ok(Self::Registry);
        }
        match s.strip_prefix("ws:") {
            Some(id)
                if !id.is_empty()
                    && id.len() <= 64
                    && id
                        .chars()
                        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_')) =>
            {
                Ok(Self::Workspace(id.to_string()))
            }
            _ => Err(format!("Invalid database name: {s}")),
        }
    }
    fn dir(&self, root: &Path) -> PathBuf {
        match self {
            Self::Registry => root.to_path_buf(),
            Self::Workspace(id) => root.join("workspaces").join(id),
        }
    }
    fn file_name(&self) -> &'static str {
        match self {
            Self::Registry => "skele.sqlite3",
            Self::Workspace(_) => "workspace.sqlite3",
        }
    }
    fn label(&self) -> String {
        match self {
            Self::Registry => "registry".into(),
            Self::Workspace(id) => format!("workspace-{id}"),
        }
    }
}

pub struct Db {
    conn: Mutex<Connection>,
    dir: PathBuf,
    tables: Mutex<HashMap<String, TableSpec>>,
}

impl Db {
    fn spec(&self, table: &str) -> Result<TableSpec> {
        self.tables
            .lock()
            .unwrap()
            .get(table)
            .cloned()
            .ok_or_else(|| format!("Unknown table: {table}"))
    }

    fn blob_path(&self, table: &str, key: &str) -> Result<PathBuf> {
        let spec = self.spec(table)?;
        let dir = spec
            .blob_dir
            .ok_or_else(|| format!("Table {table} has no binary data"))?;
        if !is_safe_key(key) {
            return Err(format!("Invalid key: {key}"));
        }
        Ok(self.dir.join(dir).join(key))
    }
}

/// All open databases under one data root.
pub struct Engine {
    root: PathBuf,
    dbs: Mutex<HashMap<String, Arc<Db>>>,
}

impl Engine {
    pub fn new(root: PathBuf) -> Self {
        Self {
            root,
            dbs: Mutex::new(HashMap::new()),
        }
    }

    fn get(&self, name: &str) -> Result<Arc<Db>> {
        self.dbs
            .lock()
            .unwrap()
            .get(name)
            .cloned()
            .ok_or_else(|| format!("Database {name} is not open"))
    }

    /// Opens (creating or migrating if needed) a database and makes sure its tables exist.
    pub fn open(&self, name: &str, tables: &[TableSpec]) -> Result<()> {
        let db_name = DbName::parse(name)?;
        let db = {
            let mut dbs = self.dbs.lock().unwrap();
            match dbs.get(name) {
                Some(db) => db.clone(),
                None => {
                    let dir = db_name.dir(&self.root);
                    let conn = open_connection(
                        &dir.join(db_name.file_name()),
                        &self.root.join("backups"),
                        &db_name.label(),
                        MIGRATIONS,
                    )?;
                    let db = Arc::new(Db {
                        conn: Mutex::new(conn),
                        dir,
                        tables: Mutex::new(HashMap::new()),
                    });
                    dbs.insert(name.to_string(), db.clone());
                    db
                }
            }
        };
        let conn = db.conn.lock().unwrap();
        let mut known = db.tables.lock().unwrap();
        for spec in tables {
            if known.get(&spec.name) == Some(spec) {
                continue;
            }
            ensure_table(&conn, spec)?;
            if let Some(blob_dir) = &spec.blob_dir {
                std::fs::create_dir_all(db.dir.join(blob_dir))
                    .map_err(err("Creating the attachment folder"))?;
                sweep_stale_blobs(&conn, spec, &db.dir.join(blob_dir));
            }
            known.insert(spec.name.clone(), spec.clone());
        }
        Ok(())
    }

    pub fn get_rows(
        &self,
        name: &str,
        table: &str,
        keys: &[String],
    ) -> Result<Vec<Option<String>>> {
        let db = self.get(name)?;
        db.spec(table)?;
        let conn = db.conn.lock().unwrap();
        let mut stmt = conn
            .prepare_cached(&format!("SELECT data FROM \"t_{table}\" WHERE key = ?1"))
            .map_err(err("Reading"))?;
        keys.iter()
            .map(|k| {
                stmt.query_row([k], |r| r.get::<_, String>(0))
                    .optional()
                    .map_err(err("Reading"))
            })
            .collect()
    }

    pub fn all(&self, name: &str, table: &str) -> Result<Vec<String>> {
        let db = self.get(name)?;
        db.spec(table)?;
        let conn = db.conn.lock().unwrap();
        let mut stmt = conn
            .prepare_cached(&format!("SELECT data FROM \"t_{table}\" ORDER BY key"))
            .map_err(err("Reading"))?;
        let rows = stmt
            .query_map([], |r| r.get::<_, String>(0))
            .map_err(err("Reading"))?;
        rows.collect::<rusqlite::Result<_>>()
            .map_err(err("Reading"))
    }

    pub fn find(&self, name: &str, table: &str, field: &str, value: &str) -> Result<Vec<String>> {
        let db = self.get(name)?;
        let spec = db.spec(table)?;
        if !spec.indexes.iter().any(|f| f == field) {
            return Err(format!("{table}.{field} is not indexed"));
        }
        let conn = db.conn.lock().unwrap();
        // Same expression as the index, so SQLite uses it.
        let sql = format!("SELECT data FROM \"t_{table}\" WHERE json_extract(data, '$.{field}') = ?1 ORDER BY key");
        let mut stmt = conn.prepare_cached(&sql).map_err(err("Reading"))?;
        let rows = stmt
            .query_map([value], |r| r.get::<_, String>(0))
            .map_err(err("Reading"))?;
        rows.collect::<rusqlite::Result<_>>()
            .map_err(err("Reading"))
    }

    pub fn count(&self, name: &str, table: &str) -> Result<u64> {
        let db = self.get(name)?;
        db.spec(table)?;
        let conn = db.conn.lock().unwrap();
        conn.query_row(&format!("SELECT COUNT(*) FROM \"t_{table}\""), [], |r| {
            r.get::<_, i64>(0)
        })
        .map(|n| n as u64)
        .map_err(err("Counting"))
    }

    /// Applies a batch of writes atomically (one SQLite transaction), then removes binary data
    /// that no longer belongs to any row.
    pub fn commit(&self, name: &str, ops: &[Op]) -> Result<()> {
        let db = self.get(name)?;
        let mut orphans: HashMap<String, Option<HashSet<String>>> = HashMap::new(); // table → keys (None = all)
        {
            let mut conn = db.conn.lock().unwrap();
            let tx = conn.transaction().map_err(err("Saving"))?;
            for op in ops {
                match op {
                    Op::Put { table, key, data } => {
                        db.spec(table)?;
                        let json = serde_json::to_string(data).map_err(err("Saving"))?;
                        tx.prepare_cached(&format!(
                            "INSERT INTO \"t_{table}\" (key, data) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET data = excluded.data"
                        ))
                        .and_then(|mut s| s.execute(params![key, json]))
                        .map_err(err("Saving"))?;
                    }
                    Op::Delete { table, key } => {
                        let spec = db.spec(table)?;
                        tx.prepare_cached(&format!("DELETE FROM \"t_{table}\" WHERE key = ?1"))
                            .and_then(|mut s| s.execute([key]))
                            .map_err(err("Deleting"))?;
                        if spec.blob_dir.is_some() {
                            if let Some(keys) = orphans
                                .entry(table.clone())
                                .or_insert_with(|| Some(HashSet::new()))
                            {
                                keys.insert(key.clone());
                            }
                        }
                    }
                    Op::Clear { table } => {
                        let spec = db.spec(table)?;
                        tx.execute(&format!("DELETE FROM \"t_{table}\""), [])
                            .map_err(err("Deleting"))?;
                        if spec.blob_dir.is_some() {
                            orphans.insert(table.clone(), None);
                        }
                    }
                }
            }
            tx.commit().map_err(err("Saving"))?;
            // Only after the commit: a failed transaction must not lose attachment bytes.
            for (table, keys) in orphans {
                let spec = db.spec(&table)?;
                let dir = db.dir.join(spec.blob_dir.as_deref().unwrap_or_default());
                let candidates: Vec<String> = match keys {
                    Some(keys) => keys.into_iter().collect(),
                    None => list_blob_keys(&dir),
                };
                for key in candidates {
                    if !row_exists(&conn, &table, &key) {
                        let _ = std::fs::remove_file(dir.join(&key));
                    }
                }
            }
        }
        Ok(())
    }

    /// Stores binary data for a row. Called before the row itself is committed; the write is
    /// atomic (temporary file, flushed, then renamed into place).
    pub fn write_blob(&self, name: &str, table: &str, key: &str, bytes: &[u8]) -> Result<()> {
        let db = self.get(name)?;
        let path = db.blob_path(table, key)?;
        write_atomic(&path, bytes).map_err(err("Saving the attachment"))
    }

    pub fn read_blob(&self, name: &str, table: &str, key: &str) -> Result<Option<Vec<u8>>> {
        let db = self.get(name)?;
        let path = db.blob_path(table, key)?;
        match std::fs::read(&path) {
            Ok(bytes) => Ok(Some(bytes)),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(format!("Reading the attachment: {e}")),
        }
    }

    /// Permanently deletes a workspace's folder (database and attachments).
    pub fn destroy(&self, name: &str) -> Result<()> {
        let db_name = DbName::parse(name)?;
        if db_name == DbName::Registry {
            return Err("The registry can't be deleted".into());
        }
        // Close the connection first (Windows can't delete open files).
        let db = self.dbs.lock().unwrap().remove(name);
        drop(db);
        let dir = db_name.dir(&self.root);
        match std::fs::remove_dir_all(&dir) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(format!("Deleting the workspace folder: {e}")),
        }
    }
}

fn open_connection(
    path: &Path,
    backup_dir: &Path,
    label: &str,
    migrations: &[Migration],
) -> Result<Connection> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(err("Creating the data folder"))?;
    }
    let existed = path.exists();
    let mut conn = Connection::open(path).map_err(err("Opening the database"))?;
    conn.busy_timeout(Duration::from_secs(5))
        .map_err(err("Opening the database"))?;
    // WAL keeps reads fast while writing; FULL sync means a finished save survives a power cut.
    conn.pragma_update(None, "journal_mode", "WAL")
        .map_err(err("Opening the database"))?;
    conn.pragma_update(None, "synchronous", "FULL")
        .map_err(err("Opening the database"))?;
    migrate(&mut conn, existed, backup_dir, label, migrations)?;
    Ok(conn)
}

fn target_version(migrations: &[Migration]) -> u32 {
    migrations
        .iter()
        .map(|m| m.to)
        .max()
        .unwrap_or(SCHEMA_VERSION)
        .max(SCHEMA_VERSION)
}

/// Brings the file up to date. Refuses files written by a newer Skele (opening them could
/// corrupt data that version understands and this one doesn't).
pub fn migrate(
    conn: &mut Connection,
    existed: bool,
    backup_dir: &Path,
    label: &str,
    migrations: &[Migration],
) -> Result<()> {
    let target = target_version(migrations);
    let version: u32 = conn
        .pragma_query_value(None, "user_version", |r| r.get(0))
        .map_err(err("Reading the schema version"))?;
    if version > target {
        return Err(format!(
            "This data was saved by a newer version of Skele (format {version}; this version understands up to {target}). Update Skele to open it."
        ));
    }
    if version == target {
        return Ok(());
    }
    if version == 0 {
        // New file (or created before versioning existed): start at the current layout.
        let _ = existed;
        conn.pragma_update(None, "user_version", target)
            .map_err(err("Setting the schema version"))?;
        return Ok(());
    }
    let pending: Vec<&Migration> = migrations.iter().filter(|m| m.to > version).collect();
    backup(conn, backup_dir, &format!("{label}-v{version}"))?;
    let tx = conn.transaction().map_err(err("Migrating"))?;
    for m in pending {
        (m.run)(&tx).map_err(|e| format!("Migrating to format {}: {e}", m.to))?;
    }
    tx.pragma_update(None, "user_version", target)
        .map_err(err("Migrating"))?;
    tx.commit().map_err(err("Migrating"))
}

/// A consistent copy of the database (`VACUUM INTO` works while the file is open).
pub fn backup(conn: &Connection, backup_dir: &Path, label: &str) -> Result<PathBuf> {
    std::fs::create_dir_all(backup_dir).map_err(err("Creating the backup folder"))?;
    let mut path = backup_dir.join(format!("{label}-{}.sqlite3", now_secs()));
    let mut n = 1;
    while path.exists() {
        path = backup_dir.join(format!("{label}-{}-{n}.sqlite3", now_secs()));
        n += 1;
    }
    conn.execute("VACUUM INTO ?1", [path.to_string_lossy()])
        .map_err(err("Backing up before the migration"))?;
    Ok(path)
}

fn ensure_table(conn: &Connection, spec: &TableSpec) -> Result<()> {
    if !is_ident(&spec.name) {
        return Err(format!("Invalid table name: {}", spec.name));
    }
    if let Some(dir) = &spec.blob_dir {
        if !is_ident(&dir.replace('-', "_")) {
            return Err(format!("Invalid folder name: {dir}"));
        }
    }
    let t = &spec.name;
    conn.execute_batch(&format!(
        "CREATE TABLE IF NOT EXISTS \"t_{t}\" (key TEXT PRIMARY KEY NOT NULL, data TEXT NOT NULL);"
    ))
    .map_err(err("Creating a table"))?;
    for field in &spec.indexes {
        if !is_ident(field) {
            return Err(format!("Invalid field name: {field}"));
        }
        conn.execute_batch(&format!(
            "CREATE INDEX IF NOT EXISTS \"ix_{t}_{field}\" ON \"t_{t}\" (json_extract(data, '$.{field}'));"
        ))
        .map_err(err("Creating an index"))?;
    }
    Ok(())
}

fn row_exists(conn: &Connection, table: &str, key: &str) -> bool {
    conn.query_row(
        &format!("SELECT 1 FROM \"t_{table}\" WHERE key = ?1"),
        [key],
        |_| Ok(()),
    )
    .optional()
    .map(|r| r.is_some())
    .unwrap_or(true) // when unsure, keep the file
}

fn list_blob_keys(dir: &Path) -> Vec<String> {
    std::fs::read_dir(dir)
        .map(|it| {
            it.filter_map(|e| e.ok())
                .filter(|e| e.file_type().map(|t| t.is_file()).unwrap_or(false))
                .filter_map(|e| e.file_name().into_string().ok())
                .collect()
        })
        .unwrap_or_default()
}

/// Removes leftovers from writes that never got committed (a crash between storing the bytes
/// and saving the row). Only touches files older than ten minutes.
fn sweep_stale_blobs(conn: &Connection, spec: &TableSpec, dir: &Path) {
    let cutoff = SystemTime::now() - Duration::from_secs(600);
    for key in list_blob_keys(dir) {
        let path = dir.join(&key);
        let old = std::fs::metadata(&path)
            .and_then(|m| m.modified())
            .map(|t| t < cutoff)
            .unwrap_or(false);
        let temp = key.contains(".tmp-");
        if old && (temp || !row_exists(conn, &spec.name, &key)) {
            let _ = std::fs::remove_file(path);
        }
    }
}

fn write_atomic(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    use std::io::Write;
    let dir = path
        .parent()
        .ok_or_else(|| std::io::Error::other("no parent folder"))?;
    std::fs::create_dir_all(dir)?;
    let tmp = dir.join(format!(
        "{}.tmp-{}",
        path.file_name().and_then(|n| n.to_str()).unwrap_or("blob"),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0)
    ));
    {
        let mut f = std::fs::File::create(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
    }
    std::fs::rename(&tmp, path).inspect_err(|_| {
        let _ = std::fs::remove_file(&tmp);
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn spec(name: &str, indexes: &[&str], blob_dir: Option<&str>) -> TableSpec {
        TableSpec {
            name: name.into(),
            indexes: indexes.iter().map(|s| s.to_string()).collect(),
            blob_dir: blob_dir.map(Into::into),
        }
    }

    fn put(table: &str, key: &str, json: &str) -> Op {
        Op::Put {
            table: table.into(),
            key: key.into(),
            data: serde_json::from_str(json).unwrap(),
        }
    }

    #[test]
    fn ops_deserialize_from_tauri_arguments() {
        // Tauri passes command arguments as a serde_json::Value, not as text.
        let args = serde_json::json!([
            { "op": "put", "table": "tasks", "key": "t1", "data": { "id": "t1", "n": 1, "nested": { "a": [1, 2] } } },
            { "op": "delete", "table": "tasks", "key": "t2" },
            { "op": "clear", "table": "files" }
        ]);
        let ops: Vec<Op> = serde_json::from_value(args).unwrap();
        assert_eq!(ops.len(), 3);
        let (_d, e) = engine();
        e.commit("ws:abc", &ops[..1]).unwrap();
        let row = e
            .get_rows("ws:abc", "tasks", &["t1".into()])
            .unwrap()
            .remove(0)
            .unwrap();
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&row).unwrap()["nested"]["a"][1],
            2
        );
        let specs: Vec<TableSpec> = serde_json::from_value(
            serde_json::json!([{ "name": "x", "indexes": ["a"], "blobDir": null }]),
        )
        .unwrap();
        assert_eq!(specs[0].blob_dir, None);
    }

    fn engine() -> (tempfile::TempDir, Engine) {
        let dir = tempfile::tempdir().unwrap();
        let e = Engine::new(dir.path().to_path_buf());
        e.open(
            "ws:abc",
            &[
                spec("tasks", &["projectId"], None),
                spec("files", &["pageId"], Some("attachments")),
            ],
        )
        .unwrap();
        (dir, e)
    }

    #[test]
    fn put_get_find_count_delete() {
        let (_d, e) = engine();
        e.commit(
            "ws:abc",
            &[
                put("tasks", "t1", r#"{"id":"t1","projectId":"p1"}"#),
                put("tasks", "t2", r#"{"id":"t2","projectId":"p2"}"#),
            ],
        )
        .unwrap();
        assert_eq!(e.count("ws:abc", "tasks").unwrap(), 2);
        let got = e
            .get_rows("ws:abc", "tasks", &["t1".into(), "nope".into()])
            .unwrap();
        assert_eq!(got[0].as_deref(), Some(r#"{"id":"t1","projectId":"p1"}"#));
        assert!(got[1].is_none());
        assert_eq!(
            e.find("ws:abc", "tasks", "projectId", "p2").unwrap().len(),
            1
        );
        assert!(
            e.find("ws:abc", "tasks", "title", "x").is_err(),
            "unindexed fields are rejected"
        );
        // Upsert
        e.commit(
            "ws:abc",
            &[put("tasks", "t1", r#"{"id":"t1","projectId":"p2"}"#)],
        )
        .unwrap();
        assert_eq!(
            e.find("ws:abc", "tasks", "projectId", "p2").unwrap().len(),
            2
        );
        e.commit(
            "ws:abc",
            &[Op::Delete {
                table: "tasks".into(),
                key: "t1".into(),
            }],
        )
        .unwrap();
        assert_eq!(e.all("ws:abc", "tasks").unwrap().len(), 1);
    }

    #[test]
    fn commit_is_atomic() {
        let (_d, e) = engine();
        let bad = e.commit(
            "ws:abc",
            &[
                put("tasks", "t1", r#"{"id":"t1"}"#),
                put("missing", "x", "{}"),
            ],
        );
        assert!(bad.is_err());
        assert_eq!(
            e.count("ws:abc", "tasks").unwrap(),
            0,
            "nothing from a failed batch is saved"
        );
    }

    #[test]
    fn index_uses_expression() {
        let (_d, e) = engine();
        let db = e.get("ws:abc").unwrap();
        let conn = db.conn.lock().unwrap();
        let plan: String = conn
            .query_row("EXPLAIN QUERY PLAN SELECT data FROM t_tasks WHERE json_extract(data, '$.projectId') = 'p'", [], |r| r.get(3))
            .unwrap();
        assert!(plan.contains("ix_tasks_projectId"), "plan was: {plan}");
    }

    #[test]
    fn blobs_follow_their_rows() {
        let (d, e) = engine();
        e.write_blob("ws:abc", "files", "f1", b"hello").unwrap();
        e.commit(
            "ws:abc",
            &[put("files", "f1", r#"{"id":"f1","pageId":"p"}"#)],
        )
        .unwrap();
        assert_eq!(
            e.read_blob("ws:abc", "files", "f1").unwrap().as_deref(),
            Some(&b"hello"[..])
        );
        let path = d.path().join("workspaces/abc/attachments/f1");
        assert!(path.is_file());
        // Delete + re-put in one batch keeps the bytes.
        e.commit(
            "ws:abc",
            &[
                Op::Delete {
                    table: "files".into(),
                    key: "f1".into(),
                },
                put("files", "f1", r#"{"id":"f1"}"#),
            ],
        )
        .unwrap();
        assert!(path.is_file());
        // Clear removes them.
        e.commit(
            "ws:abc",
            &[Op::Clear {
                table: "files".into(),
            }],
        )
        .unwrap();
        assert!(!path.exists());
        assert!(e.read_blob("ws:abc", "files", "f1").unwrap().is_none());
        assert!(e.write_blob("ws:abc", "files", "../escape", b"x").is_err());
        assert!(
            e.write_blob("ws:abc", "tasks", "t1", b"x").is_err(),
            "tables without a blob folder"
        );
    }

    #[test]
    fn destroy_removes_workspace_folder_only() {
        let (d, e) = engine();
        e.open("registry", &[spec("meta", &[], None)]).unwrap();
        e.commit("ws:abc", &[put("tasks", "t1", "{}")]).unwrap();
        e.destroy("ws:abc").unwrap();
        assert!(!d.path().join("workspaces/abc").exists());
        assert!(d.path().join("skele.sqlite3").exists());
        assert!(e.destroy("registry").is_err());
        assert!(e.count("ws:abc", "tasks").is_err(), "closed after destroy");
    }

    #[test]
    fn data_survives_reopen() {
        let dir = tempfile::tempdir().unwrap();
        {
            let e = Engine::new(dir.path().to_path_buf());
            e.open("ws:abc", &[spec("tasks", &[], None)]).unwrap();
            e.commit("ws:abc", &[put("tasks", "t1", r#"{"a":1}"#)])
                .unwrap();
        }
        let e = Engine::new(dir.path().to_path_buf());
        e.open("ws:abc", &[spec("tasks", &["projectId"], None)])
            .unwrap();
        assert_eq!(
            e.all("ws:abc", "tasks").unwrap(),
            vec![r#"{"a":1}"#.to_string()]
        );
    }

    #[test]
    fn rejects_bad_names() {
        assert!(DbName::parse("ws:../x").is_err());
        assert!(DbName::parse("other").is_err());
        let dir = tempfile::tempdir().unwrap();
        let e = Engine::new(dir.path().to_path_buf());
        assert!(e.open("ws:a", &[spec("x; DROP", &[], None)]).is_err());
        assert!(e.open("ws:a", &[spec("x", &["a'b"], None)]).is_err());
        assert!(e.open("ws:a", &[spec("x", &[], Some("../up"))]).is_err());
    }

    fn add_column(tx: &Transaction) -> rusqlite::Result<()> {
        tx.execute_batch("CREATE TABLE added_in_v2 (x TEXT);")
    }
    fn failing(tx: &Transaction) -> rusqlite::Result<()> {
        tx.execute_batch("CREATE TABLE half_done (x TEXT); SELECT * FROM does_not_exist;")
    }

    #[test]
    fn migration_backs_up_first_and_is_transactional() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("db.sqlite3");
        let backups = dir.path().join("backups");
        {
            let conn = open_connection(&file, &backups, "test", &[]).unwrap();
            conn.execute_batch("CREATE TABLE keep (v TEXT); INSERT INTO keep VALUES ('precious');")
                .unwrap();
        }
        // A failing migration leaves the file at v1 but still leaves a backup.
        let failing_migrations = [Migration {
            to: 2,
            run: failing,
        }];
        assert!(open_connection(&file, &backups, "test", &failing_migrations).is_err());
        {
            let conn = Connection::open(&file).unwrap();
            let v: u32 = conn
                .pragma_query_value(None, "user_version", |r| r.get(0))
                .unwrap();
            assert_eq!(v, 1);
            assert!(
                conn.prepare("SELECT * FROM half_done").is_err(),
                "rolled back"
            );
        }
        let ok = [Migration {
            to: 2,
            run: add_column,
        }];
        let conn = open_connection(&file, &backups, "test", &ok).unwrap();
        let v: u32 = conn
            .pragma_query_value(None, "user_version", |r| r.get(0))
            .unwrap();
        assert_eq!(v, 2);
        conn.prepare("SELECT * FROM added_in_v2").unwrap();
        let copies: Vec<_> = std::fs::read_dir(&backups)
            .unwrap()
            .filter_map(|e| e.ok())
            .collect();
        assert_eq!(copies.len(), 2, "one backup per attempted migration");
        let copy = Connection::open(copies[0].path()).unwrap();
        let v: String = copy
            .query_row("SELECT v FROM keep", [], |r| r.get(0))
            .unwrap();
        assert_eq!(v, "precious");
        drop(conn);
        // A newer file is refused.
        assert!(open_connection(&file, &backups, "test", &[])
            .unwrap_err()
            .contains("newer version"));
    }
}
