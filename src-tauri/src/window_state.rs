//! Window size/position for portable copies (and `SKELE_DATA_DIR`), saved in the data folder.
//! Installed copies use `tauri-plugin-window-state`, but that plugin always creates the app
//! config folder in the user profile, which a portable copy must never touch.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{PhysicalPosition, PhysicalSize, Runtime, WebviewWindow, WindowEvent};

/// Moves and resizes arrive many times a second while dragging; write at most this often
/// (the final state is always written when the window closes or loses focus).
const WRITE_INTERVAL: Duration = Duration::from_secs(1);

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Saved {
    pub width: u32,
    pub height: u32,
    pub x: i32,
    pub y: i32,
    pub maximized: bool,
}

pub fn load(file: &Path) -> Option<Saved> {
    let saved: Saved = serde_json::from_slice(&std::fs::read(file).ok()?).ok()?;
    (saved.width >= 200 && saved.height >= 150).then_some(saved)
}

fn write(file: &Path, s: &Saved) {
    if let Ok(json) = serde_json::to_vec_pretty(s) {
        let _ = std::fs::write(file, json);
    }
}

fn on_some_monitor<R: Runtime>(window: &WebviewWindow<R>, s: &Saved) -> bool {
    // The title bar (top-left area) must be on a connected monitor, or the window would open
    // off-screen after a display was unplugged.
    window.available_monitors().unwrap_or_default().iter().any(|m| {
        let (p, size) = (m.position(), m.size());
        s.x + 40 >= p.x && s.y >= p.y && s.x + 40 < p.x + size.width as i32 && s.y < p.y + size.height as i32
    })
}

fn restore<R: Runtime>(window: &WebviewWindow<R>, saved: &Saved) {
    let _ = window.set_size(PhysicalSize::new(saved.width, saved.height));
    if on_some_monitor(window, saved) {
        let _ = window.set_position(PhysicalPosition::new(saved.x, saved.y));
    }
    if saved.maximized {
        let _ = window.maximize();
    }
}

/// The window's current state. While maximised or minimised, the last normal size and
/// position are kept, so un-maximising next time restores them.
fn current<R: Runtime>(window: &WebviewWindow<R>, previous: Option<Saved>) -> Option<Saved> {
    let maximized = window.is_maximized().unwrap_or(false);
    if window.is_minimized().unwrap_or(false) {
        return previous;
    }
    if maximized {
        return previous.map(|p| Saved { maximized: true, ..p });
    }
    let (Ok(size), Ok(pos)) = (window.inner_size(), window.outer_position()) else { return previous };
    Some(Saved { width: size.width, height: size.height, x: pos.x, y: pos.y, maximized: false })
}

struct Tracker {
    file: PathBuf,
    state: Option<Saved>,
    written: Option<Saved>,
    last_write: Option<Instant>,
}

impl Tracker {
    fn flush(&mut self, force: bool) {
        let Some(state) = self.state else { return };
        if self.written == Some(state) {
            return;
        }
        if !force && self.last_write.is_some_and(|t| t.elapsed() < WRITE_INTERVAL) {
            return;
        }
        write(&self.file, &state);
        self.written = Some(state);
        self.last_write = Some(Instant::now());
    }
}

/// Restores the saved state now and saves it as the window moves, resizes, loses focus or
/// closes. Build the window hidden and show it afterwards, so it doesn't visibly jump.
pub fn track<R: Runtime>(window: &WebviewWindow<R>, file: PathBuf) {
    let saved = load(&file);
    if let Some(s) = &saved {
        restore(window, s);
    }
    let tracker = Mutex::new(Tracker { file, state: saved, written: saved, last_write: None });
    let w = window.clone();
    window.on_window_event(move |event| {
        let force = match event {
            WindowEvent::Moved(_) | WindowEvent::Resized(_) => false,
            WindowEvent::CloseRequested { .. } | WindowEvent::Focused(false) => true,
            _ => return,
        };
        let Ok(mut t) = tracker.lock() else { return };
        t.state = current(&w, t.state);
        t.flush(force);
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn loads_only_sane_state() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("w.json");
        assert!(load(&file).is_none());
        let s = Saved { width: 900, height: 700, x: 10, y: 20, maximized: true };
        write(&file, &s);
        assert_eq!(load(&file), Some(s));
        std::fs::write(&file, br#"{"width":1,"height":1,"x":0,"y":0,"maximized":false}"#).unwrap();
        assert!(load(&file).is_none());
        std::fs::write(&file, b"garbage").unwrap();
        assert!(load(&file).is_none());
    }

    #[test]
    fn writes_are_throttled_but_forced_writes_land() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("w.json");
        let a = Saved { width: 900, height: 700, x: 10, y: 20, maximized: false };
        let b = Saved { x: 50, ..a };
        let mut t = Tracker { file: file.clone(), state: Some(a), written: None, last_write: None };
        t.flush(false);
        assert_eq!(load(&file), Some(a));
        t.state = Some(b);
        t.flush(false); // within WRITE_INTERVAL of the last write
        assert_eq!(load(&file), Some(a));
        t.flush(true);
        assert_eq!(load(&file), Some(b));
        std::fs::remove_file(&file).unwrap();
        t.flush(true); // unchanged since the last write: nothing to do
        assert!(!file.exists());
    }
}
