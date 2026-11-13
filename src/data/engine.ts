// Picks the storage engine. The web build (and PWA) stores everything in IndexedDB; the
// desktop app stores it in SQLite files in its data folder, through the Tauri commands in
// src-tauri/src/commands.rs. Both implement the same interfaces (store.ts), so repositories,
// backups and tests don't care which one is in use.

import { invoke } from "@tauri-apps/api/core";
import { isDesktop } from "@/lib/desktop";
import { dexieEngine } from "./adapters/dexie";
import { sqliteEngine, type Invoke } from "./adapters/sqlite";
import type { TableAccess, WorkspaceStore } from "./store";
import type { WorkspaceMeta } from "./types";

export type MetaRow = { key: string; value: unknown };

/** An automatic recovery point (see snapshots.ts). `data` is a gzipped workspace manifest. */
export type SnapshotRow = { id: string; workspaceId: string; createdAt: string; size: number; reason: string; data: Uint8Array };

export interface StorageEngine {
  readonly kind: "indexeddb" | "sqlite";
  /** A new connection to one workspace's data. */
  workspace(id: string): WorkspaceStore;
  /** The workspace list and app-wide key/value data (preferences, integration tokens). */
  registry(): { workspaces: TableAccess<WorkspaceMeta>; meta: TableAccess<MetaRow> };
  /** Recovery points for every workspace. */
  snapshots(): TableAccess<SnapshotRow>;
}

let current: StorageEngine | null = null;

export function storageEngine(): StorageEngine {
  current ??= isDesktop() ? sqliteEngine(invoke as Invoke) : dexieEngine();
  return current;
}

/** Replaces the engine (tests). Call before any data access. */
export function setStorageEngine(engine: StorageEngine | null) {
  current = engine;
}
