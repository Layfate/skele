import { FILE_SCHEME } from "@/features/editor/doc";
import { badRequest, newId, notFound, now } from "../common";
import { normaliseType, sanitizeFilename, sniff } from "../file-validation";
import type { WorkspaceStore } from "../store";
import type { FileRow } from "../types";

const MB = 1024 * 1024;
export const MAX_UPLOAD_BYTES = Number(process.env.NEXT_PUBLIC_MAX_UPLOAD_MB ?? 50) * MB;

export const fileRef = (id: string) => `${FILE_SCHEME}${id}`;
export const fileIdFromRef = (ref: string) => (ref.startsWith(FILE_SCHEME) ? ref.slice(FILE_SCHEME.length) : null);

export async function uploadFile(s: WorkspaceStore, file: File | Blob & { name: string }, pageId: string | null) {
  if (file.size === 0) throw badRequest("The file is empty");
  if (file.size > MAX_UPLOAD_BYTES) throw badRequest(`Files can be at most ${MAX_UPLOAD_BYTES / MB} MB`);
  const mimeType = normaliseType(file as File);
  // Read before opening the transaction (IndexedDB transactions can't wait on other I/O).
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!sniff(bytes, mimeType)) throw badRequest("The file content doesn't match its type");
  const row: FileRow = {
    id: newId(),
    name: sanitizeFilename(file.name),
    mimeType,
    size: file.size,
    pageId,
    blob: new Blob([bytes], { type: mimeType }),
    createdAt: now(),
  };
  await s.t("files").put(row);
  return { id: row.id, url: fileRef(row.id), name: row.name, size: row.size, mimeType };
}

const urlCache = new Map<string, string>();

/** A browser URL for a stored attachment (cached object URL). */
export async function fileObjectUrl(s: WorkspaceStore, id: string): Promise<string | null> {
  const key = `${s.workspaceId}/${id}`;
  const cached = urlCache.get(key);
  if (cached) return cached;
  const row = await s.t("files").get(id);
  if (!row) return null;
  const url = URL.createObjectURL(row.blob);
  urlCache.set(key, url);
  return url;
}

export async function getFile(s: WorkspaceStore, id: string) {
  const row = await s.t("files").get(id);
  if (!row) throw notFound("File not found");
  return row;
}

export async function listFiles(s: WorkspaceStore) {
  const [files, pages] = await Promise.all([s.t("files").all({ skipBlobs: true }), s.t("pages").all()]);
  const byId = new Map(pages.map((p) => [p.id, p]));
  const list = files
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map(({ blob: _blob, ...f }) => ({
      ...f,
      url: fileRef(f.id),
      page: f.pageId && byId.get(f.pageId) ? { id: f.pageId, title: byId.get(f.pageId)!.title } : null,
    }));
  return { files: list, usage: { used: files.reduce((n, f) => n + f.size, 0), count: files.length, maxUpload: MAX_UPLOAD_BYTES } };
}

export async function deleteFile(s: WorkspaceStore, id: string) {
  await s.t("files").delete(id);
  const key = `${s.workspaceId}/${id}`;
  const url = urlCache.get(key);
  if (url) {
    URL.revokeObjectURL(url);
    urlCache.delete(key);
  }
}
