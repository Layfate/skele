// Storage-engine–neutral interface used by every repository. Repositories never import an
// engine directly: the web build uses IndexedDB (adapters/dexie.ts) and the desktop app uses
// SQLite files on disk (adapters/sqlite.ts). See engine.ts.

import type { TableName, Tables } from "./types";

/** Read options. `skipBlobs` leaves binary fields (attachment bytes) unloaded where an adapter
 * stores them separately (SQLite); callers that pass it must not touch those fields. */
export type ReadOptions = { skipBlobs?: boolean };

export interface TableAccess<T> {
  get(key: string): Promise<T | undefined>;
  bulkGet(keys: string[]): Promise<(T | undefined)[]>;
  /** Every row, ordered by primary key. */
  all(options?: ReadOptions): Promise<T[]>;
  /** Equality lookup on an indexed field (see SCHEMA), ordered by primary key. */
  where(field: string, value: string, options?: ReadOptions): Promise<T[]>;
  put(row: T): Promise<void>;
  bulkPut(rows: T[]): Promise<void>;
  update(key: string, patch: Partial<T>): Promise<boolean>;
  delete(key: string): Promise<void>;
  bulkDelete(keys: string[]): Promise<void>;
  clear(): Promise<void>;
  count(): Promise<number>;
}

export interface WorkspaceStore {
  readonly workspaceId: string;
  t<K extends TableName>(name: K): TableAccess<Tables[K]>;
  /** Runs `fn` atomically: either every write inside it is committed, or none is. */
  transaction<T>(fn: () => Promise<T>): Promise<T>;
  close(): void;
  /** Permanently removes all of this workspace's data. */
  destroy(): Promise<void>;
}

/** Primary key + indexed fields per table (shared by all adapters). */
export const SCHEMA: Record<TableName, { key: string; indexes: string[] }> = {
  pages: { key: "id", indexes: [] },
  contents: { key: "pageId", indexes: [] },
  favorites: { key: "pageId", indexes: [] },
  visits: { key: "pageId", indexes: ["visitedAt"] },
  links: { key: "id", indexes: ["fromId", "toId"] },
  projects: { key: "id", indexes: [] },
  labels: { key: "id", indexes: [] },
  tasks: { key: "id", indexes: ["projectId", "parentId"] },
  comments: { key: "id", indexes: ["taskId"] },
  databases: { key: "id", indexes: ["pageId"] },
  properties: { key: "id", indexes: ["databaseId"] },
  records: { key: "id", indexes: ["databaseId"] },
  views: { key: "id", indexes: ["databaseId"] },
  files: { key: "id", indexes: ["pageId"] },
  settings: { key: "key", indexes: [] },
};

export const TABLE_NAMES = Object.keys(SCHEMA) as TableName[];
