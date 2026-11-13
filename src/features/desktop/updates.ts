"use client";

// In-app updates for the desktop app, through Tauri's official updater plugin. Releases come
// from GitHub Releases (latest.json); every download is checked against the public key in
// src-tauri/tauri.conf.json before it's installed. If GitHub can't be reached, checks fail
// quietly and Skele keeps working.

import type { DownloadEvent, Update } from "@tauri-apps/plugin-updater";
import { appMeta } from "@/data/registry";

export type UpdateSettings = {
  /** Check on startup and once a day while running. */
  autoCheck: boolean;
  lastCheckedAt: string | null;
  /** "Skip this version": the startup check stays quiet about it. */
  skippedVersion: string | null;
};

const KEY = "desktop:updates";
const DEFAULTS: UpdateSettings = { autoCheck: true, lastCheckedAt: null, skippedVersion: null };

export async function getUpdateSettings(): Promise<UpdateSettings> {
  return { ...DEFAULTS, ...((await appMeta.get<Partial<UpdateSettings>>(KEY)) ?? {}) };
}

export async function setUpdateSettings(patch: Partial<UpdateSettings>) {
  const next = { ...(await getUpdateSettings()), ...patch };
  await appMeta.set(KEY, next);
  return next;
}

export type AvailableUpdate = { version: string; currentVersion: string; date: string | null; notes: string; handle: Update };

/** Asks the release server for a newer version. Resolves to null when Skele is up to date. */
export async function checkForUpdate(): Promise<AvailableUpdate | null> {
  const { check } = await import("@tauri-apps/plugin-updater");
  const update = await check({ timeout: 20_000 });
  await setUpdateSettings({ lastCheckedAt: new Date().toISOString() });
  if (!update) return null;
  return { version: update.version, currentVersion: update.currentVersion, date: update.date ?? null, notes: update.body ?? "", handle: update };
}

export type Progress = { downloaded: number; total: number | null };

/**
 * Downloads, verifies and installs the update. On Windows the installer closes Skele and
 * starts the new version itself; elsewhere the caller offers a restart.
 */
export async function installUpdate(update: AvailableUpdate, onProgress: (p: Progress) => void) {
  let downloaded = 0;
  let total: number | null = null;
  await update.handle.downloadAndInstall((event: DownloadEvent) => {
    if (event.event === "Started") total = event.data.contentLength ?? null;
    if (event.event === "Progress") downloaded += event.data.chunkLength;
    onProgress({ downloaded, total });
  });
}

export async function restartApp() {
  const { relaunch } = await import("@tauri-apps/plugin-process");
  await relaunch();
}

/** Plain-language message for an update failure. */
export function updateErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  if (/signature/i.test(raw)) return "The download didn't pass the signature check, so it wasn't installed.";
  if (/network|connect|dns|timed? ?out|offline|request/i.test(raw)) return "Couldn't reach the update server. Check your connection and try again.";
  return raw || "The update failed.";
}
