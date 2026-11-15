"use client";

// Images in AI chats: pasted (Ctrl+V / Alt+V) or picked. They're decoded, downscaled to what
// the models actually look at (about 1568 px on the long side), re-encoded and kept as base64
// on the message, so every provider gets the same small image.

import { newId } from "@/data/common";
import { desktopInfo, isDesktop } from "@/lib/desktop";
import type { ChatImage } from "./types";

/** Longest side sent to a model; larger images are scaled down (models do this anyway). */
export const MAX_IMAGE_SIDE = 1568;
/** Above this, a PNG is re-encoded as JPEG to keep messages small. */
const MAX_PNG_BYTES = 3_500_000;
const KEEP_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

function base64Of(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ""));
    reader.onerror = () => reject(reader.error ?? new Error("Couldn't read the image."));
    reader.readAsDataURL(blob);
  });
}

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't encode the image."))), type, quality),
  );
}

/** Turns any image the browser can decode (PNG, JPEG, GIF, WebP, BMP…) into a chat image. */
export async function toChatImage(blob: Blob, name?: string): Promise<ChatImage> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    throw new Error("That file isn't an image Skele can read.");
  }
  const { width, height } = bitmap;
  const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  // Small enough and already a type every provider takes: send it as it is.
  if (scale === 1 && KEEP_TYPES.has(blob.type) && blob.size <= MAX_PNG_BYTES) {
    bitmap.close();
    return { id: newId(), mediaType: blob.type as ChatImage["mediaType"], data: await base64Of(blob), width: w, height: h, name };
  }
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Couldn't process the image.");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  let out = await canvasBlob(canvas, "image/png");
  let mediaType: ChatImage["mediaType"] = "image/png";
  if (out.size > MAX_PNG_BYTES) {
    // Photos: JPEG is far smaller. Fill transparency with white first.
    ctx.globalCompositeOperation = "destination-over";
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, w, h);
    out = await canvasBlob(canvas, "image/jpeg", 0.88);
    mediaType = "image/jpeg";
  }
  return { id: newId(), mediaType, data: await base64Of(out), width: w, height: h, name };
}

export const imageSrc = (img: Pick<ChatImage, "mediaType" | "data">) => `data:${img.mediaType};base64,${img.data}`;

/**
 * The image on the system clipboard, for Alt+V (and for pastes the webview doesn't turn into
 * a file, like a bitmap or an image file copied in File Explorer). Windows desktop app: read
 * natively; elsewhere the async clipboard API. Null when there's no image.
 */
export async function readClipboardImage(): Promise<Blob | null> {
  if (isDesktop() && (await desktopInfo())?.os === "windows") {
    const { invoke } = await import("@tauri-apps/api/core");
    const bytes = await invoke<ArrayBuffer>("clipboard_image");
    return bytes.byteLength ? new Blob([bytes]) : null;
  }
  if (!navigator.clipboard?.read) return null;
  try {
    for (const item of await navigator.clipboard.read()) {
      const type = item.types.find((t) => t.startsWith("image/"));
      if (type) return await item.getType(type);
    }
  } catch {
    // Permission refused or nothing readable.
  }
  return null;
}
