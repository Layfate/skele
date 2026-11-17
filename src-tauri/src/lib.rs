//! Skele desktop app: a native window around the static Skele build (`../out`), with
//! workspaces stored in SQLite files on disk (see `storage.rs`). Nothing is loaded from the
//! internet except what the user turns on (Spotify, update checks against GitHub Releases).
//! Spotify sign-in uses a loopback redirect on 127.0.0.1 (see `oauth.rs`). AI chat can run the
//! user's own Claude Code / Codex command-line tools (see `ai.rs`, with plugins, MCP servers
//! and skills in `ai_ext.rs`) and a local Ollama server (see `ai_ollama.rs`). On Windows the
//! Spotify app can also be controlled through the OS media session (see `media.rs`).

mod ai;
mod ai_ext;
mod ai_ollama;
mod ai_tools;
mod clipboard;
mod commands;
mod media;
mod oauth;
mod paths;
mod storage;
mod window_state;

use paths::DataLocation;
use std::path::Path;
use tauri::{Manager, WebviewWindowBuilder};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    #[cfg(desktop)]
    {
        // A second launch focuses the running window instead of opening another copy (two
        // copies writing the same workspace would fight over it). Must be the first plugin.
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }));
    }

    builder
        // Native message/open/save dialogs.
        .plugin(tauri_plugin_dialog::init())
        // Opens external links in the user's browser instead of inside the app.
        .plugin(tauri_plugin_opener::init())
        // Relaunch after an update.
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let exe_dir = std::env::current_exe().ok().and_then(|p| p.parent().map(Path::to_path_buf));
            let location = paths::resolve(app.path().app_data_dir()?, exe_dir.as_deref(), std::env::var(paths::DATA_DIR_ENV).ok());
            if let Err(e) = paths::ensure_writable(&location.root) {
                use tauri_plugin_dialog::{DialogExt, MessageDialogKind};
                let message = format!(
                    "Skele can't write to its data folder:\n{}\n\n{e}\n\nPortable copies need a folder you can write to.",
                    location.root.display()
                );
                app.dialog().message(message).title("Skele").kind(MessageDialogKind::Error).blocking_show();
                return Err(e.into());
            }

            #[cfg(desktop)]
            {
                // Window size/position: the plugin for installed copies; portable copies keep a
                // state file in their own data folder (see window_state.rs).
                if location.source == paths::DataSource::Default {
                    app.handle().plugin(tauri_plugin_window_state::Builder::default().build())?;
                }
                app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;
            }

            app.manage(storage::Engine::new(location.root.clone()));
            app.manage(ai::AiRuns::default());
            app.manage(ai_ollama::OllamaRuns::default());
            app.manage(ai_tools::McpPool::default());
            create_main_window(app, &location)?;
            app.manage(location);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::db_open,
            commands::db_get,
            commands::db_all,
            commands::db_where,
            commands::db_count,
            commands::db_commit,
            commands::db_destroy,
            commands::blob_write,
            commands::blob_read,
            commands::save_file,
            commands::app_info,
            commands::open_data_dir,
            oauth::oauth_start,
            oauth::oauth_wait,
            oauth::oauth_cancel,
            ai::ai_cli_run,
            ai::ai_cli_cancel,
            ai::ai_cli_status,
            ai::ai_cli_auth,
            ai::ai_codex_usage,
            ai::ai_codex_models,
            ai::ai_pick_folder,
            ai::ai_check_folder,
            ai_ext::ai_cli_manage,
            ai_ext::ai_cli_mcp_list,
            ai_ext::ai_mcp_test,
            ai_tools::ai_file_tool,
            ai_tools::ai_mcp_tools,
            ai_tools::ai_mcp_call,
            ai_ext::ai_skills_list,
            ai_ext::ai_skill_read,
            ai_ext::ai_skill_write,
            ai_ext::ai_skill_delete,
            ai_ext::ai_skill_import,
            ai_ext::ai_claude_catalog,
            ai_ollama::ai_ollama_status,
            ai_ollama::ai_ollama_models,
            ai_ollama::ai_ollama_chat,
            ai_ollama::ai_ollama_cancel,
            ai_ollama::ai_ollama_pull,
            ai_ollama::ai_ollama_delete,
            ai_ollama::ai_ollama_start,
            media::media_session,
            media::media_control,
            media::media_artwork,
            media::media_seek,
            clipboard::clipboard_image,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Skele")
        .run(|app, event| {
            // MCP servers the API models used keep running between calls; stop them on quit.
            if let tauri::RunEvent::Exit = event {
                if let Some(pool) = app.try_state::<ai_tools::McpPool>() {
                    pool.close_all();
                }
            }
        });
}

/// The main window is created here rather than from the config so a portable copy can keep
/// its webview profile inside its own data folder.
fn create_main_window(app: &tauri::App, location: &DataLocation) -> tauri::Result<()> {
    let config = app
        .config()
        .app
        .windows
        .iter()
        .find(|w| w.label == "main")
        .cloned()
        .expect("tauri.conf.json defines the main window");
    let mut window = WebviewWindowBuilder::from_config(app.handle(), &config)?;
    if let Some(dir) = location.webview_dir() {
        window = window.data_directory(dir);
    }
    let own_state = location.source != paths::DataSource::Default;
    if own_state {
        // Hidden until the saved size and position are applied, so it doesn't visibly jump.
        window = window.visible(false);
    }
    let window = window.build()?;
    if own_state {
        window_state::track(&window, location.root.join("window-state.json"));
        if config.visible {
            window.show()?;
        }
    }
    Ok(())
}
