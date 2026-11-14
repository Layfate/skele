"use client";

// The Spotify app on this computer, controlled through Windows' media session (see
// src-tauri/src/media.rs). Works with Free accounts and without connecting Spotify, because it
// never uses Spotify's Web API. Desktop app on Windows only; everywhere else it reports nothing.

import { desktopInfo, isDesktop } from "@/lib/desktop";

export type LocalSession = {
  app: string;
  title: string;
  artist: string;
  album: string;
  isPlaying: boolean;
  positionMs: number;
  durationMs: number;
  canPrevious: boolean;
  canNext: boolean;
  canPlayPause: boolean;
};

export type LocalAction = "play" | "pause" | "toggle" | "next" | "previous";

/** True in the Windows desktop app, where Skele can control the Spotify app directly. */
export async function localControlSupported() {
  if (!isDesktop()) return false;
  return (await desktopInfo())?.os === "windows";
}

export async function localSession(): Promise<LocalSession | null> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<LocalSession | null>("media_session");
}

export async function localControl(action: LocalAction) {
  const { invoke } = await import("@tauri-apps/api/core");
  const ok = await invoke<boolean>("media_control", { action });
  if (!ok) throw new Error("Spotify didn't respond. Is it open on this computer?");
}

/** Cover art of the current track as a data: URL, or null when Spotify doesn't provide one. */
export async function localArtwork(): Promise<string | null> {
  const { invoke } = await import("@tauri-apps/api/core");
  const bytes = await invoke<ArrayBuffer>("media_artwork");
  if (!bytes.byteLength) return null;
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(new Blob([bytes], { type: "image/jpeg" }));
  });
}
