"use client";

// Thin bridge to the Tauri shell. Every function is a no-op (or returns null) in a browser.

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

export const isDesktop = () => typeof window !== "undefined" && !!window.__TAURI_INTERNALS__;

export type DesktopInfo = {
  version: string;
  os: "windows" | "macos" | "linux" | string;
  arch: string;
  dataDir: string;
  dataSource: "default" | "portable" | "env";
  portable: boolean;
  /** "app": in-app updates; "portable" / "package": download a new copy; "unconfigured": no update source. */
  updateMode: "app" | "portable" | "package" | "unconfigured";
  releasesUrl: string | null;
};

let info: Promise<DesktopInfo> | null = null;

/** Version, data folder and update capability of the running desktop app (null in a browser). */
export async function desktopInfo(): Promise<DesktopInfo | null> {
  if (!isDesktop()) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  info ??= invoke<DesktopInfo>("app_info");
  return info;
}

export async function openDataFolder() {
  if (!isDesktop()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("open_data_dir");
}

/**
 * Saves bytes through a native save dialog (desktop app only). Returns the chosen path, or
 * null if the user cancelled.
 */
export async function saveWithDialog(blob: Blob, filename: string): Promise<string | null> {
  const { invoke } = await import("@tauri-apps/api/core");
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return invoke<string | null>("save_file", bytes, { headers: { "x-skele-filename": encodeURIComponent(filename) } });
}

/** Open an http(s)/mailto URL in the user's default browser / mail client. */
export async function openExternal(url: string): Promise<boolean> {
  if (!isDesktop()) return false;
  const { openUrl } = await import("@tauri-apps/plugin-opener");
  await openUrl(url);
  return true;
}

/**
 * In the desktop app, links that would open a new tab (target=_blank) or leave the app's
 * origin are handed to the OS instead of navigating the app window.
 */
export function installDesktopLinkHandler(): () => void {
  if (!isDesktop()) return () => {};
  const onClick = (e: MouseEvent) => {
    const anchor = (e.target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
    if (!anchor) return;
    const url = new URL(anchor.href, window.location.href);
    const external = url.origin !== window.location.origin || anchor.target === "_blank";
    if (!external || !["http:", "https:", "mailto:"].includes(url.protocol)) return;
    e.preventDefault();
    void openExternal(url.toString());
  };
  document.addEventListener("click", onClick, true);
  return () => document.removeEventListener("click", onClick, true);
}
