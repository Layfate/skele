// Automatic recovery points. A compressed copy of the workspace (without attachment bytes,
// which are kept in place) is stored outside the workspace (a separate IndexedDB database, or files in the desktop
// app's recovery-points folder) every few minutes while editing.
// If something goes wrong — a bad import, an accidental bulk delete — the user can roll back.

import { gunzipSync, gzipSync, strFromU8, strToU8 } from "fflate";
import { snapshotWorkspace, writeManifest, type Manifest } from "./backup";
import { storageEngine, type SnapshotRow } from "./engine";
import { getWorkspace } from "./registry";
import type { WorkspaceStore } from "./store";

const snapshotsDb = () => ({ snapshots: storageEngine().snapshots() });

export const KEEP_SNAPSHOTS = 12;
export const SNAPSHOT_INTERVAL_MS = 5 * 60_000;

export async function takeSnapshot(s: WorkspaceStore, reason = "auto") {
  const meta = await getWorkspace(s.workspaceId);
  const { manifest } = await snapshotWorkspace(s, meta);
  const data = gzipSync(strToU8(JSON.stringify(manifest)));
  const row: SnapshotRow = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, workspaceId: s.workspaceId, createdAt: new Date().toISOString(), size: data.byteLength, reason, data };
  await snapshotsDb().snapshots.put(row);
  const all = await listSnapshots(s.workspaceId);
  await snapshotsDb().snapshots.bulkDelete(all.slice(KEEP_SNAPSHOTS).map((r) => r.id));
  return row.id;
}

export async function listSnapshots(workspaceId: string) {
  const rows = await snapshotsDb().snapshots.where("workspaceId", workspaceId, { skipBlobs: true });
  return rows
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map(({ data: _data, ...r }) => r);
}

/** Rolls the workspace back to a snapshot. A safety snapshot of the current state is taken first. */
export async function restoreSnapshot(s: WorkspaceStore, snapshotId: string) {
  const row = await snapshotsDb().snapshots.get(snapshotId);
  if (!row || row.workspaceId !== s.workspaceId) throw new Error("Snapshot not found");
  const manifest = JSON.parse(strFromU8(gunzipSync(row.data))) as Manifest;
  await takeSnapshot(s, "before restore");
  // Attachments aren't inside snapshots: keep the bytes currently stored.
  const files = await s.t("files").all();
  const attachments = new Map<string, Uint8Array>();
  for (const f of files) attachments.set(f.id, new Uint8Array(await f.blob.arrayBuffer()));
  await s.transaction(async () => {
    for (const name of [
      "pages", "contents", "favorites", "links", "projects", "labels", "tasks", "comments",
      "databases", "properties", "records", "views", "files", "settings",
    ] as const) {
      await s.t(name).clear();
    }
  });
  return writeManifest(s, manifest, attachments);
}

export async function deleteSnapshots(workspaceId: string) {
  const rows = await snapshotsDb().snapshots.where("workspaceId", workspaceId, { skipBlobs: true });
  await snapshotsDb().snapshots.bulkDelete(rows.map((r) => r.id));
}
