//! Where Skele keeps user data.
//!
//! - Installed builds: the OS application-data folder for the bundle identifier
//!   (Windows `%APPDATA%\dev.skele.desktop`, macOS `~/Library/Application Support/dev.skele.desktop`,
//!   Linux `$XDG_DATA_HOME/dev.skele.desktop`, usually `~/.local/share/dev.skele.desktop`).
//! - Portable builds: a `SkeleData` folder next to the executable, switched on by a
//!   `skele-portable.txt` file beside the executable. Nothing is written anywhere else: the
//!   webview profile and the window state live inside `SkeleData` too.
//! - `SKELE_DATA_DIR` overrides both (used by tests and by people who keep data elsewhere).
//!
//! User data is never stored inside the installation directory of an installed build.

use std::path::{Path, PathBuf};

pub const PORTABLE_MARKER: &str = "skele-portable.txt";
pub const PORTABLE_DATA_DIR: &str = "SkeleData";
pub const DATA_DIR_ENV: &str = "SKELE_DATA_DIR";

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum DataSource {
    Default,
    Portable,
    Env,
}

#[derive(Debug, Clone)]
pub struct DataLocation {
    pub root: PathBuf,
    pub source: DataSource,
}

impl DataLocation {
    pub fn portable(&self) -> bool {
        self.source == DataSource::Portable
    }
    /// The webview profile (IndexedDB, localStorage, caches). `None` = the platform default.
    pub fn webview_dir(&self) -> Option<PathBuf> {
        (self.source != DataSource::Default).then(|| self.root.join("webview"))
    }
}

/// Picks the data folder. `exe_dir` is the folder holding the running executable.
pub fn resolve(
    default_root: PathBuf,
    exe_dir: Option<&Path>,
    env_override: Option<String>,
) -> DataLocation {
    if let Some(dir) = env_override.filter(|d| !d.trim().is_empty()) {
        return DataLocation {
            root: PathBuf::from(dir),
            source: DataSource::Env,
        };
    }
    if let Some(exe_dir) = exe_dir {
        if exe_dir.join(PORTABLE_MARKER).is_file() {
            return DataLocation {
                root: exe_dir.join(PORTABLE_DATA_DIR),
                source: DataSource::Portable,
            };
        }
    }
    DataLocation {
        root: default_root,
        source: DataSource::Default,
    }
}

/// Creates the data folder and checks that it is writable, so a portable copy on read-only
/// media fails with a clear message instead of losing writes later.
pub fn ensure_writable(root: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(root)?;
    let probe = root.join(".write-test");
    std::fs::write(&probe, b"ok")?;
    std::fs::remove_file(&probe)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_location_without_marker() {
        let exe = tempfile::tempdir().unwrap();
        let loc = resolve(PathBuf::from("/data/default"), Some(exe.path()), None);
        assert_eq!(loc.source, DataSource::Default);
        assert_eq!(loc.root, PathBuf::from("/data/default"));
        assert!(loc.webview_dir().is_none());
    }

    #[test]
    fn portable_marker_moves_data_next_to_exe() {
        let exe = tempfile::tempdir().unwrap();
        std::fs::write(exe.path().join(PORTABLE_MARKER), "portable").unwrap();
        let loc = resolve(PathBuf::from("/data/default"), Some(exe.path()), None);
        assert!(loc.portable());
        assert_eq!(loc.root, exe.path().join(PORTABLE_DATA_DIR));
        assert_eq!(
            loc.webview_dir().unwrap(),
            exe.path().join(PORTABLE_DATA_DIR).join("webview")
        );
    }

    #[test]
    fn env_override_wins() {
        let exe = tempfile::tempdir().unwrap();
        std::fs::write(exe.path().join(PORTABLE_MARKER), "portable").unwrap();
        let loc = resolve(
            PathBuf::from("/d"),
            Some(exe.path()),
            Some("/custom".into()),
        );
        assert_eq!(loc.source, DataSource::Env);
        assert_eq!(loc.root, PathBuf::from("/custom"));
        let blank = resolve(PathBuf::from("/d"), None, Some("  ".into()));
        assert_eq!(blank.source, DataSource::Default);
    }

    #[test]
    fn writable_check_creates_folder() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("a").join("b");
        ensure_writable(&root).unwrap();
        assert!(root.is_dir());
        assert!(!root.join(".write-test").exists());
    }
}
