//! Controls the Spotify desktop app through the operating system's media session (the same
//! thing keyboard media keys and the Windows volume flyout use). This works with any Spotify
//! account, including Free, because it never touches Spotify's Web API: Skele just asks Windows
//! to play, pause or skip in the Spotify app that is already running on this computer.
//!
//! Windows only (Global System Media Transport Controls). Other platforms report no session.

use serde::Serialize;

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MediaSession {
    /// The app that owns the session, e.g. `Spotify.exe`.
    pub app: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub is_playing: bool,
    /// Position when this snapshot was taken (already advanced past Spotify's last report).
    pub position_ms: u64,
    pub duration_ms: u64,
    pub can_previous: bool,
    pub can_next: bool,
    pub can_play_pause: bool,
}

type CmdResult<T> = Result<T, String>;

#[tauri::command]
pub async fn media_session() -> CmdResult<Option<MediaSession>> {
    run_blocking(imp::session).await
}

/// `action`: "play", "pause", "toggle", "next" or "previous".
#[tauri::command]
pub async fn media_control(action: String) -> CmdResult<bool> {
    run_blocking(move || imp::control(&action)).await
}

/// Cover art of the current track as raw image bytes (empty when there is none).
#[tauri::command]
pub async fn media_artwork() -> CmdResult<tauri::ipc::Response> {
    let bytes = run_blocking(imp::artwork).await?;
    Ok(tauri::ipc::Response::new(bytes))
}

async fn run_blocking<T: Send + 'static>(
    f: impl FnOnce() -> CmdResult<T> + Send + 'static,
) -> CmdResult<T> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| e.to_string())?
}

/// Spotify's own session: the classic installer registers as `Spotify.exe`, the Microsoft
/// Store build as `SpotifyAB.SpotifyMusic_…!Spotify`.
fn is_spotify(app_id: &str) -> bool {
    app_id.to_ascii_lowercase().contains("spotify")
}

/// Windows timestamps count 100 ns ticks since 1601; this is the Unix epoch in those ticks.
const UNIX_EPOCH_TICKS: i64 = 116_444_736_000_000_000;

/// Spotify only reports its position now and then, so the live position is the reported one
/// plus the time since it was reported (while playing), capped at the track length.
fn live_position_ms(
    position_ticks: i64,
    updated_ticks: i64,
    now_unix_ms: i64,
    playing: bool,
    duration_ms: u64,
) -> u64 {
    let mut pos = (position_ticks / 10_000).max(0);
    if playing && updated_ticks > 0 {
        let updated_unix_ms = (updated_ticks - UNIX_EPOCH_TICKS) / 10_000;
        pos += (now_unix_ms - updated_unix_ms).max(0);
    }
    let pos = pos as u64;
    if duration_ms > 0 {
        pos.min(duration_ms)
    } else {
        pos
    }
}

#[cfg(windows)]
mod imp {
    use super::{is_spotify, live_position_ms, CmdResult, MediaSession};
    use windows::Media::Control::{
        GlobalSystemMediaTransportControlsSession as Session,
        GlobalSystemMediaTransportControlsSessionManager as Manager,
        GlobalSystemMediaTransportControlsSessionPlaybackStatus as Status,
    };
    use windows::Storage::Streams::DataReader;
    use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};

    fn err(e: windows::core::Error) -> String {
        format!("Windows media controls: {}", e.message())
    }

    fn spotify_session() -> CmdResult<Option<Session>> {
        // Worker threads start without COM; an "already initialised" result is fine.
        unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        }
        let manager = Manager::RequestAsync().map_err(err)?.join().map_err(err)?;
        let sessions = manager.GetSessions().map_err(err)?;
        for session in &sessions {
            let app = session
                .SourceAppUserModelId()
                .map(|s| s.to_string())
                .unwrap_or_default();
            if is_spotify(&app) {
                return Ok(Some(session));
            }
        }
        Ok(None)
    }

    pub fn session() -> CmdResult<Option<MediaSession>> {
        let Some(session) = spotify_session()? else {
            return Ok(None);
        };
        let app = session
            .SourceAppUserModelId()
            .map(|s| s.to_string())
            .unwrap_or_default();
        let props = session
            .TryGetMediaPropertiesAsync()
            .map_err(err)?
            .join()
            .map_err(err)?;
        let title = props.Title().map(|s| s.to_string()).unwrap_or_default();
        // Spotify keeps a session (with no title) open while it is idle or between tracks.
        if title.is_empty() {
            return Ok(None);
        }
        let info = session.GetPlaybackInfo().map_err(err)?;
        let is_playing = info
            .PlaybackStatus()
            .map(|s| s == Status::Playing)
            .unwrap_or(false);
        let controls = info.Controls().map_err(err)?;
        let timeline = session.GetTimelineProperties().map_err(err)?;
        let start = timeline.StartTime().map(|t| t.Duration).unwrap_or(0);
        let end = timeline.EndTime().map(|t| t.Duration).unwrap_or(0);
        let duration_ms = ((end - start) / 10_000).max(0) as u64;
        let position = timeline.Position().map(|t| t.Duration).unwrap_or(0) - start;
        let updated = timeline
            .LastUpdatedTime()
            .map(|t| t.UniversalTime)
            .unwrap_or(0);
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);
        Ok(Some(MediaSession {
            app,
            title,
            artist: props.Artist().map(|s| s.to_string()).unwrap_or_default(),
            album: props
                .AlbumTitle()
                .map(|s| s.to_string())
                .unwrap_or_default(),
            is_playing,
            position_ms: live_position_ms(position, updated, now, is_playing, duration_ms),
            duration_ms,
            can_previous: controls.IsPreviousEnabled().unwrap_or(false),
            can_next: controls.IsNextEnabled().unwrap_or(false),
            can_play_pause: controls.IsPlayPauseToggleEnabled().unwrap_or(false)
                || controls.IsPlayEnabled().unwrap_or(false)
                || controls.IsPauseEnabled().unwrap_or(false),
        }))
    }

    pub fn control(action: &str) -> CmdResult<bool> {
        let Some(session) = spotify_session()? else {
            return Err("Spotify isn't open on this computer.".into());
        };
        let op = match action {
            "play" => session.TryPlayAsync(),
            "pause" => session.TryPauseAsync(),
            "toggle" => session.TryTogglePlayPauseAsync(),
            "next" => session.TrySkipNextAsync(),
            "previous" => session.TrySkipPreviousAsync(),
            other => return Err(format!("Unknown media action: {other}")),
        };
        op.map_err(err)?.join().map_err(err)
    }

    pub fn artwork() -> CmdResult<Vec<u8>> {
        let Some(session) = spotify_session()? else {
            return Ok(Vec::new());
        };
        let props = session
            .TryGetMediaPropertiesAsync()
            .map_err(err)?
            .join()
            .map_err(err)?;
        let Ok(thumb) = props.Thumbnail() else {
            return Ok(Vec::new());
        };
        let stream = thumb.OpenReadAsync().map_err(err)?.join().map_err(err)?;
        let size = stream.Size().map_err(err)? as u32;
        if size == 0 {
            return Ok(Vec::new());
        }
        let reader = DataReader::CreateDataReader(&stream).map_err(err)?;
        reader.LoadAsync(size).map_err(err)?.join().map_err(err)?;
        let mut bytes = vec![0u8; size as usize];
        reader.ReadBytes(&mut bytes).map_err(err)?;
        Ok(bytes)
    }
}

#[cfg(not(windows))]
mod imp {
    use super::{CmdResult, MediaSession};

    pub fn session() -> CmdResult<Option<MediaSession>> {
        Ok(None)
    }

    pub fn control(_action: &str) -> CmdResult<bool> {
        Err("Controlling the Spotify app is only available on Windows.".into())
    }

    pub fn artwork() -> CmdResult<Vec<u8>> {
        Ok(Vec::new())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognises_spotify_app_ids() {
        assert!(is_spotify("Spotify.exe"));
        assert!(is_spotify("SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify"));
        assert!(!is_spotify(
            "Microsoft.ZuneMusic_8wekyb3d8bbwe!Microsoft.ZuneMusic"
        ));
        assert!(!is_spotify("chrome.exe"));
    }

    #[test]
    fn position_advances_only_while_playing_and_is_capped() {
        let updated = UNIX_EPOCH_TICKS + 1_000_000 * 10_000; // reported at unix ms 1_000_000
        let pos = 30_000 * 10_000; // 30 s
        assert_eq!(
            live_position_ms(pos, updated, 1_005_000, true, 200_000),
            35_000
        );
        assert_eq!(
            live_position_ms(pos, updated, 1_005_000, false, 200_000),
            30_000
        );
        assert_eq!(
            live_position_ms(pos, updated, 9_000_000, true, 200_000),
            200_000
        );
        assert_eq!(live_position_ms(pos, 0, 9_000_000, true, 0), 30_000);
    }

    /// Reads the real Spotify session on this machine: `cargo test live_media -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn live_media_session() {
        println!("session: {:?}", imp::session());
        println!("artwork bytes: {:?}", imp::artwork().map(|b| b.len()));
    }
}
