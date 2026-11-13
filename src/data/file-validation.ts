// Shared file validation (type allow-list + magic-byte sniffing). Used for uploads and imports.
import { badRequest } from "./common";

/** Allowed types. Images are served inline; everything else is a download. SVG is deliberately excluded. */
export const ALLOWED: Record<string, { ext: string[]; inline: boolean }> = {
  "image/png": { ext: ["png"], inline: true },
  "image/jpeg": { ext: ["jpg", "jpeg"], inline: true },
  "image/gif": { ext: ["gif"], inline: true },
  "image/webp": { ext: ["webp"], inline: true },
  "application/pdf": { ext: ["pdf"], inline: true },
  "text/plain": { ext: ["txt", "log"], inline: false },
  "text/markdown": { ext: ["md", "markdown"], inline: false },
  "text/csv": { ext: ["csv"], inline: false },
  "application/json": { ext: ["json"], inline: false },
  "application/zip": { ext: ["zip"], inline: false },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": { ext: ["docx"], inline: false },
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": { ext: ["xlsx"], inline: false },
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": { ext: ["pptx"], inline: false },
};

const startsWith = (bytes: Uint8Array, sig: number[], offset = 0) => sig.every((b, i) => bytes[offset + i] === b);

/** Detects the real type from magic bytes for binary formats; returns null if it doesn't match the claim. */
export function sniff(bytes: Uint8Array, claimed: string): string | null {
  const isZip = startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) || startsWith(bytes, [0x50, 0x4b, 0x05, 0x06]);
  const checks: Record<string, () => boolean> = {
    "image/png": () => startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    "image/jpeg": () => startsWith(bytes, [0xff, 0xd8, 0xff]),
    "image/gif": () => startsWith(bytes, [0x47, 0x49, 0x46, 0x38]),
    "image/webp": () => startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8),
    "application/pdf": () => startsWith(bytes, [0x25, 0x50, 0x44, 0x46]),
    "application/zip": () => isZip,
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": () => isZip,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": () => isZip,
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": () => isZip,
  };
  const check = checks[claimed];
  if (check) return check() ? claimed : null;
  // Text formats: reject anything with NUL bytes in the first 8 KB (binary disguised as text).
  const head = bytes.subarray(0, 8192);
  return head.includes(0) ? null : claimed;
}

export function normaliseType(file: File): string {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (ALLOWED[file.type]) return file.type;
  // Browsers often send "" or application/octet-stream for md/csv; fall back to the extension.
  const byExt = Object.entries(ALLOWED).find(([, v]) => v.ext.includes(ext));
  if (byExt) return byExt[0];
  throw badRequest(`Files of this type can't be uploaded (${file.type || ext || "unknown"})`);
}

export function sanitizeFilename(name: string) {
  const cleaned = name.replace(/[\u0000-\u001f\u007f"\\/<>:|?*]+/g, "_").trim().slice(0, 180);
  return cleaned || "file";
}

