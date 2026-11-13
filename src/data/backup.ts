// Portable workspace format ("skele-workspace", version 1) — see docs/DATA-FORMAT.md.
//  • `.skele`       zip: skele.json + attachments/<file id>  (backups, exports)
//  • `.skele.json`  single JSON file with attachments inlined as base64 (legacy exporter)

import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { z } from "zod";
import { extractTags, extractText, sanitizeDoc } from "@/features/editor/doc";
import { parseViewConfig } from "@/features/databases/query";
import { PROPERTY_TYPES, type PropertyType } from "@/features/databases/properties";
import { PROJECT_STATUSES, TASK_PRIORITIES, TASK_STATUSES } from "@/features/projects/schemas";
import { badRequest, newId, now } from "./common";
import { sniff } from "./file-validation";
import { registerWorkspace, workspaceStore } from "./registry";
import type { WorkspaceStore } from "./store";
import type { FileRow, Tables, WorkspaceMeta } from "./types";

export const FORMAT = "skele-workspace";
export const FORMAT_VERSION = 1;

const str = (max = 10_000) => z.string().max(max);
const date = z.string().max(40).nullable().optional();
const rank = z.string().min(1).max(200);

const manifestSchema = z.object({
  format: z.literal(FORMAT),
  version: z.number().int().min(1).max(FORMAT_VERSION),
  exportedAt: z.string().optional(),
  workspace: z.object({ id: str(64), name: str(200), icon: str(32).nullable().optional(), color: str(30).optional() }),
  pages: z.array(
    z.object({
      id: str(64),
      parentId: str(64).nullable(),
      kind: z.enum(["DOCUMENT", "DATABASE"]),
      title: str(500),
      icon: str(32).nullable().optional(),
      cover: str(2048).nullable().optional(),
      coverPosition: z.number().optional(),
      rank,
      pinned: z.boolean().optional(),
      fullWidth: z.boolean().optional(),
      isTemplate: z.boolean().optional(),
      tags: z.array(str(100)).optional(),
      properties: z.record(z.string(), z.string()).optional(),
      archivedAt: date,
      archivedRootId: str(64).nullable().optional(),
      createdAt: date,
      updatedAt: date,
    }),
  ),
  contents: z.array(z.object({ pageId: str(64), doc: z.unknown(), version: z.number().optional(), updatedAt: date })),
  favorites: z.array(z.object({ pageId: str(64), createdAt: date })).optional(),
  projects: z
    .array(
      z.object({
        id: str(64),
        name: str(200),
        description: str(20_000).optional(),
        icon: str(32).nullable().optional(),
        color: str(30).optional(),
        status: z.enum(PROJECT_STATUSES),
        startDate: date,
        targetDate: date,
        lead: str(200).nullable().optional(),
        rank,
        archivedAt: date,
        createdAt: date,
        updatedAt: date,
      }),
    )
    .optional(),
  labels: z.array(z.object({ id: str(64), name: str(100), color: str(30) })).optional(),
  tasks: z
    .array(
      z.object({
        id: str(64),
        projectId: str(64).nullable().optional(),
        parentId: str(64).nullable().optional(),
        pageId: str(64).nullable().optional(),
        title: str(1000),
        description: str(50_000).optional(),
        status: z.enum(TASK_STATUSES),
        priority: z.enum(TASK_PRIORITIES),
        dueDate: date,
        assignee: str(200).nullable().optional(),
        labelIds: z.array(str(64)).optional(),
        rank,
        completedAt: date,
        createdAt: date,
        updatedAt: date,
      }),
    )
    .optional(),
  comments: z.array(z.object({ id: str(64), taskId: str(64), author: str(200), body: str(10_000), createdAt: date })).optional(),
  databases: z.array(z.object({ id: str(64), pageId: str(64), createdAt: date })).optional(),
  properties: z
    .array(
      z.object({
        id: str(64),
        databaseId: str(64),
        name: str(200),
        type: z.enum(PROPERTY_TYPES as [PropertyType, ...PropertyType[]]),
        config: z.unknown(),
        rank,
      }),
    )
    .optional(),
  records: z
    .array(
      z.object({
        id: str(64),
        databaseId: str(64),
        title: str(1000),
        icon: str(32).nullable().optional(),
        values: z.record(z.string(), z.unknown()).optional(),
        doc: z.unknown().optional(),
        rank,
        createdAt: date,
        updatedAt: date,
      }),
    )
    .optional(),
  views: z
    .array(
      z.object({
        id: str(64),
        databaseId: str(64),
        name: str(100),
        type: z.enum(["TABLE", "BOARD", "CALENDAR", "GALLERY", "LIST"]),
        config: z.unknown(),
        rank,
      }),
    )
    .optional(),
  files: z
    .array(
      z.object({
        id: str(64),
        name: str(300),
        mimeType: str(200),
        size: z.number().int().nonnegative(),
        pageId: str(64).nullable().optional(),
        createdAt: date,
        path: str(300).optional(),
        data: z.string().nullable().optional(),
        sha256: str(64).optional(),
      }),
    )
    .optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
});

export type Manifest = z.infer<typeof manifestSchema>;

async function sha256(bytes: Uint8Array) {
  const hash = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const toBase64 = (bytes: Uint8Array) => {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromBase64 = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

// ───────────── Export ─────────────

/** Reads a whole workspace into the portable manifest + attachment bytes. */
export async function snapshotWorkspace(s: WorkspaceStore, meta: Pick<WorkspaceMeta, "id" | "name" | "icon" | "color">) {
  const read = <K extends keyof Tables>(k: K) => s.t(k).all();
  const [pages, contents, favorites, projects, labels, tasks, comments, databases, properties, records, views, files, settings] =
    await Promise.all([
      read("pages"),
      read("contents"),
      read("favorites"),
      read("projects"),
      read("labels"),
      read("tasks"),
      read("comments"),
      read("databases"),
      read("properties"),
      read("records"),
      read("views"),
      read("files"),
      read("settings"),
    ]);
  const attachments = new Map<string, Uint8Array>();
  const fileEntries = [];
  for (const f of files) {
    const bytes = new Uint8Array(await f.blob.arrayBuffer());
    attachments.set(f.id, bytes);
    const { blob: _blob, ...rest } = f;
    fileEntries.push({ ...rest, path: `attachments/${f.id}`, sha256: await sha256(bytes) });
  }
  const manifest = {
    format: FORMAT,
    version: FORMAT_VERSION,
    exportedAt: now(),
    app: "skele",
    workspace: { id: meta.id, name: meta.name, icon: meta.icon, color: meta.color },
    pages,
    contents: contents.map(({ pageId, doc, version, updatedAt }) => ({ pageId, doc, version, updatedAt })),
    favorites,
    projects,
    labels,
    tasks,
    comments,
    databases,
    properties,
    records: records.map(({ text: _text, version: _version, ...r }) => r),
    views,
    files: fileEntries,
    settings: Object.fromEntries(settings.map((r) => [r.key, r.value])),
  };
  return { manifest, attachments };
}

/** A `.skele` backup archive (zip). */
export async function exportWorkspaceArchive(s: WorkspaceStore, meta: WorkspaceMeta): Promise<Blob> {
  const { manifest, attachments } = await snapshotWorkspace(s, meta);
  const entries: Record<string, Uint8Array> = { "skele.json": strToU8(JSON.stringify(manifest, null, 1)) };
  for (const [id, bytes] of attachments) entries[`attachments/${id}`] = bytes;
  const zipped = zipSync(entries, { level: 6 });
  return new Blob([zipped as BlobPart], { type: "application/zip" });
}

// ───────────── Import ─────────────

/** Parses a `.skele` archive or `.skele.json` file, validating structure and checksums. */
export async function readWorkspaceFile(bytes: Uint8Array) {
  let manifestRaw: unknown;
  let archive: Record<string, Uint8Array> | null = null;
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  try {
    if (isZip) {
      archive = unzipSync(bytes);
      if (!archive["skele.json"]) throw new Error("missing skele.json");
      manifestRaw = JSON.parse(strFromU8(archive["skele.json"]));
    } else {
      manifestRaw = JSON.parse(strFromU8(bytes));
    }
  } catch {
    throw badRequest("This file isn't a readable Skele workspace (it may be damaged).");
  }
  const parsed = manifestSchema.safeParse(manifestRaw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw badRequest(`This workspace file is invalid: ${issue.path.join(".")} ${issue.message}`);
  }
  const manifest = parsed.data;
  const attachments = new Map<string, Uint8Array>();
  const problems: string[] = [];
  for (const f of manifest.files ?? []) {
    const bytes = f.data ? fromBase64(f.data) : f.path && archive ? archive[f.path] : undefined;
    if (!bytes) {
      problems.push(`${f.name}: content missing`);
      continue;
    }
    if (f.sha256 && (await sha256(bytes)) !== f.sha256) {
      problems.push(`${f.name}: checksum mismatch (corrupted)`);
      continue;
    }
    if (!sniff(bytes, f.mimeType)) {
      problems.push(`${f.name}: content doesn't match its type`);
      continue;
    }
    attachments.set(f.id, bytes);
  }
  return { manifest, attachments, problems };
}

/** Writes a manifest into an (empty) workspace store, normalising and sanitising everything. */
export async function writeManifest(s: WorkspaceStore, manifest: Manifest, attachments: Map<string, Uint8Array>) {
  const ts = now();
  const pageIds = new Set(manifest.pages.map((p) => p.id));
  const pages = manifest.pages.map((p) => ({
    id: p.id,
    // Referential integrity: parents that don't exist become top-level pages.
    parentId: p.parentId && pageIds.has(p.parentId) && p.parentId !== p.id ? p.parentId : null,
    kind: p.kind,
    title: p.title.slice(0, 255),
    icon: p.icon ?? null,
    cover: p.cover ?? null,
    coverPosition: p.coverPosition ?? 50,
    rank: p.rank,
    pinned: p.pinned ?? false,
    fullWidth: p.fullWidth ?? false,
    isTemplate: p.isTemplate ?? false,
    tags: p.tags ?? [],
    properties: p.properties ?? {},
    archivedAt: p.archivedAt ?? null,
    archivedRootId: p.archivedRootId ?? null,
    createdAt: p.createdAt ?? ts,
    updatedAt: p.updatedAt ?? ts,
  }));
  // Break any parent cycles.
  const byId = new Map(pages.map((p) => [p.id, p]));
  for (const p of pages) {
    const seen = new Set([p.id]);
    let cur = p.parentId ? byId.get(p.parentId) : undefined;
    while (cur) {
      if (seen.has(cur.id)) {
        p.parentId = null;
        break;
      }
      seen.add(cur.id);
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
  }
  const contentByPage = new Map(manifest.contents.map((c) => [c.pageId, c]));
  const contents = pages.map((p) => {
    const doc = sanitizeDoc(contentByPage.get(p.id)?.doc ?? { type: "doc", content: [] });
    const text = extractText(doc);
    return { pageId: p.id, doc, text, tags: extractTags(text), version: 0, updatedAt: contentByPage.get(p.id)?.updatedAt ?? ts };
  });
  const projectIds = new Set((manifest.projects ?? []).map((p) => p.id));
  const labelIds = new Set((manifest.labels ?? []).map((l) => l.id));
  const taskIds = new Set((manifest.tasks ?? []).map((t) => t.id));
  const dbs = (manifest.databases ?? []).filter((d) => pageIds.has(d.pageId));
  const dbIds = new Set(dbs.map((d) => d.id));

  const files: FileRow[] = (manifest.files ?? [])
    .filter((f) => attachments.has(f.id))
    .map((f) => ({
      id: f.id,
      name: f.name,
      mimeType: f.mimeType,
      size: attachments.get(f.id)!.byteLength,
      pageId: f.pageId && pageIds.has(f.pageId) ? f.pageId : null,
      blob: new Blob([attachments.get(f.id)! as BlobPart], { type: f.mimeType }),
      createdAt: f.createdAt ?? ts,
    }));

  await s.transaction(async () => {
    await s.t("pages").bulkPut(pages);
    await s.t("contents").bulkPut(contents);
    await s.t("favorites").bulkPut((manifest.favorites ?? []).filter((f) => pageIds.has(f.pageId)).map((f) => ({ pageId: f.pageId, createdAt: f.createdAt ?? ts })));
    await s.t("projects").bulkPut(
      (manifest.projects ?? []).map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description ?? "",
        icon: p.icon ?? null,
        color: p.color ?? "indigo",
        status: p.status,
        startDate: p.startDate ?? null,
        targetDate: p.targetDate ?? null,
        lead: p.lead ?? null,
        rank: p.rank,
        archivedAt: p.archivedAt ?? null,
        createdAt: p.createdAt ?? ts,
        updatedAt: p.updatedAt ?? ts,
      })),
    );
    await s.t("labels").bulkPut(manifest.labels ?? []);
    await s.t("tasks").bulkPut(
      (manifest.tasks ?? []).map((t) => ({
        id: t.id,
        projectId: t.projectId && projectIds.has(t.projectId) ? t.projectId : null,
        parentId: t.parentId && taskIds.has(t.parentId) ? t.parentId : null,
        pageId: t.pageId && pageIds.has(t.pageId) ? t.pageId : null,
        title: t.title,
        description: t.description ?? "",
        status: t.status,
        priority: t.priority,
        dueDate: t.dueDate ?? null,
        assignee: t.assignee ?? null,
        labelIds: (t.labelIds ?? []).filter((l) => labelIds.has(l)),
        rank: t.rank,
        completedAt: t.completedAt ?? null,
        createdAt: t.createdAt ?? ts,
        updatedAt: t.updatedAt ?? ts,
      })),
    );
    await s.t("comments").bulkPut(
      (manifest.comments ?? []).filter((c) => taskIds.has(c.taskId)).map((c) => ({ ...c, createdAt: c.createdAt ?? ts })),
    );
    await s.t("databases").bulkPut(dbs.map((d) => ({ ...d, createdAt: d.createdAt ?? ts })));
    await s.t("properties").bulkPut(
      (manifest.properties ?? []).filter((p) => dbIds.has(p.databaseId)).map((p) => ({ ...p, config: (p.config ?? {}) as object })),
    );
    await s.t("records").bulkPut(
      (manifest.records ?? [])
        .filter((r) => dbIds.has(r.databaseId))
        .map((r) => {
          const doc = sanitizeDoc(r.doc ?? { type: "doc", content: [] });
          return {
            id: r.id,
            databaseId: r.databaseId,
            title: r.title,
            icon: r.icon ?? null,
            values: r.values ?? {},
            doc,
            text: extractText(doc),
            version: 0,
            rank: r.rank,
            createdAt: r.createdAt ?? ts,
            updatedAt: r.updatedAt ?? ts,
          };
        }),
    );
    await s.t("views").bulkPut(
      (manifest.views ?? []).filter((v) => dbIds.has(v.databaseId)).map((v) => ({ ...v, config: parseViewConfig(v.config) })),
    );
    await s.t("files").bulkPut(files);
    await s.t("settings").bulkPut(Object.entries(manifest.settings ?? {}).map(([key, value]) => ({ key, value })));
  });
  // Rebuild the link index from documents.
  const { extractLinks } = await import("@/features/editor/doc");
  await s.t("links").bulkPut(
    contents.flatMap((c) =>
      [...new Set(extractLinks(c.doc))]
        .filter((to) => to !== c.pageId && pageIds.has(to))
        .map((toId) => ({ id: `${c.pageId}>${toId}`, fromId: c.pageId, toId })),
    ),
  );
  return { pages: pages.length, tasks: (manifest.tasks ?? []).length, records: (manifest.records ?? []).length, files: files.length };
}

/** Imports a workspace file as a new local workspace. Never overwrites an existing one. */
export async function importWorkspace(bytes: Uint8Array, options: { name?: string } = {}) {
  const { manifest, attachments, problems } = await readWorkspaceFile(bytes);
  const meta = await registerWorkspace({
    id: newId(),
    name: options.name ?? manifest.workspace.name,
    icon: manifest.workspace.icon ?? null,
    color: manifest.workspace.color ?? "indigo",
  });
  const counts = await writeManifest(workspaceStore(meta.id), manifest, attachments);
  return { workspace: meta, counts, problems };
}

/** Replaces a workspace's content with a backup (used by "Restore"). */
export async function restoreIntoWorkspace(s: WorkspaceStore, bytes: Uint8Array) {
  const { manifest, attachments, problems } = await readWorkspaceFile(bytes);
  await s.transaction(async () => {
    for (const name of [
      "pages", "contents", "favorites", "visits", "links", "projects", "labels", "tasks",
      "comments", "databases", "properties", "records", "views", "files", "settings",
    ] as const) {
      await s.t(name).clear();
    }
  });
  const counts = await writeManifest(s, manifest, attachments);
  return { counts, problems };
}

/** Helper for the legacy exporter's base64 format and tests. */
export const encodeBase64 = toBase64;
