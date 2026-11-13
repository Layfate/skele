"use client";

import { isDesktop, saveWithDialog } from "./desktop";

/**
 * Saves a blob as a file: a native save dialog in the desktop app, the browser's download
 * mechanism elsewhere. Resolves to false if the user cancelled the dialog.
 */
export async function downloadBlob(blob: Blob, filename: string): Promise<boolean> {
  if (isDesktop()) return (await saveWithDialog(blob, filename)) !== null;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return true;
}

export const safeFilename = (name: string) => name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "_").trim().slice(0, 100) || "skele";

export const dateStamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
