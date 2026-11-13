// SQLite storage for the desktop app. Rows are stored as JSON in SQLite files managed by the
// Rust side (src-tauri/src/storage.rs); binary fields (attachment bytes, recovery points) are
// stored as plain files next to the database and never travel as JSON.
//
// Transactions: writes made while `transaction()` runs are collected in memory and committed
// in one SQLite transaction when it finishes (or dropped if it throws). Reads inside the
// transaction see those pending writes. JavaScript can't tell a nested call from an unrelated
// one running at the same time, so any write made while a transaction is open joins it — the
// same "nested calls join the outer transaction" rule the IndexedDB adapter follows. Commits
// are queued, and reads wait for queued commits, so a read never sees older data than a write
// that already returned.

import { SCHEMA, TABLE_NAMES, type ReadOptions, type TableAccess, type WorkspaceStore } from "../store";
import type { TableName, Tables, WorkspaceMeta } from "../types";
import type { MetaRow, SnapshotRow, StorageEngine } from "../engine";

export type Invoke = <T = unknown>(cmd: string, args?: unknown, options?: { headers: Record<string, string> }) => Promise<T>;

type BlobField = { field: string; dir: string; kind: "blob" | "bytes"; typeField?: string };
export type TableDef = { name: string; key: string; indexes: string[]; blob?: BlobField };

type Row = Record<string, unknown>;
type Op = { op: "put"; table: string; key: string; data: Row } | { op: "delete"; table: string; key: string } | { op: "clear"; table: string };

class Pending {
  tables = new Map<string, { cleared: boolean; rows: Map<string, Row | null> }>();
  blobs = new Map<string, { table: string; key: string; bytes: Uint8Array }>();
  table(name: string) {
    let t = this.tables.get(name);
    if (!t) this.tables.set(name, (t = { cleared: false, rows: new Map() }));
    return t;
  }
  get empty() {
    return this.tables.size === 0;
  }
  ops(): Op[] {
    const ops: Op[] = [];
    for (const [table, t] of this.tables) {
      if (t.cleared) ops.push({ op: "clear", table });
      for (const [key, row] of t.rows) ops.push(row ? { op: "put", table, key, data: row } : { op: "delete", table, key });
    }
    return ops;
  }
}

const byKey = (key: string) => (a: Row, b: Row) => {
  const x = String(a[key]);
  const y = String(b[key]);
  return x < y ? -1 : x > y ? 1 : 0;
};

/** One SQLite database (the registry or one workspace). */
export class SqliteDb {
  private opened: Promise<void> | null = null;
  private pending: Pending | null = null;
  private queue: Promise<void> = Promise.resolve();
  private defs: Map<string, TableDef>;
  destroyed = false;

  constructor(
    private invoke: Invoke,
    readonly name: string,
    defs: TableDef[],
  ) {
    this.defs = new Map(defs.map((d) => [d.name, d]));
  }

  def(table: string) {
    const d = this.defs.get(table);
    if (!d) throw new Error(`Unknown table: ${table}`);
    return d;
  }

  private open() {
    this.opened ??= this.invoke<void>("db_open", {
      db: this.name,
      tables: [...this.defs.values()].map((d) => ({ name: d.name, indexes: d.indexes, blobDir: d.blob?.dir ?? null })),
    }).catch((e) => {
      this.opened = null;
      throw toError(e);
    });
    return this.opened;
  }

  /** Waits until the database is open and every queued commit has landed. */
  private async settled() {
    if (this.destroyed) throw new Error("This workspace was deleted");
    await this.open();
    await this.queue;
  }

  async call<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
    await this.settled();
    try {
      return await this.invoke<T>(cmd, { db: this.name, ...args });
    } catch (e) {
      throw toError(e);
    }
  }

  // ── Reads ──

  private async hydrate(table: string, rows: Row[], options?: ReadOptions): Promise<Row[]> {
    const blob = this.def(table).blob;
    if (!blob || options?.skipBlobs) return rows;
    return Promise.all(rows.map((r) => this.attachBlob(table, blob, r)));
  }

  private async attachBlob(table: string, blob: BlobField, row: Row): Promise<Row> {
    if (row[blob.field] !== undefined) return row;
    const key = String(row[this.def(table).key]);
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await this.call<ArrayBuffer>("blob_read", { table, key }));
    } catch (e) {
      // A row whose bytes are gone (deleted by hand outside Skele) still loads, empty.
      console.warn(`[skele] missing data for ${table}/${key}`, e);
      bytes = new Uint8Array();
    }
    const value = blob.kind === "blob" ? new Blob([bytes as BlobPart], { type: String(row[blob.typeField ?? ""] ?? "") }) : bytes;
    return { ...row, [blob.field]: value };
  }

  async get(table: string, keys: string[], options?: ReadOptions): Promise<(Row | undefined)[]> {
    const overlay = this.pending?.tables.get(table);
    const missing = keys.filter((k) => !overlay?.rows.has(k) && !overlay?.cleared);
    const fetched = missing.length ? await this.call<(Row | null)[]>("db_get", { table, keys: missing }) : [];
    const found = new Map(missing.map((k, i) => [k, fetched[i] ?? undefined]));
    const rows = keys.map((k) => (overlay?.rows.has(k) ? (overlay.rows.get(k) ?? undefined) : found.get(k)));
    const present = rows.filter((r): r is Row => !!r);
    const hydrated = new Map((await this.hydrate(table, present, options)).map((r, i) => [present[i], r]));
    return rows.map((r) => (r ? hydrated.get(r) : undefined));
  }

  async list(table: string, filter: { field: string; value: string } | null, options?: ReadOptions): Promise<Row[]> {
    const def = this.def(table);
    const overlay = this.pending?.tables.get(table);
    let rows: Row[] = [];
    if (!overlay?.cleared) {
      rows = filter
        ? await this.call<Row[]>("db_where", { table, field: filter.field, value: filter.value })
        : await this.call<Row[]>("db_all", { table });
    }
    if (overlay && overlay.rows.size) {
      const byId = new Map(rows.map((r) => [String(r[def.key]), r]));
      for (const [key, row] of overlay.rows) {
        if (row && (!filter || row[filter.field] === filter.value)) byId.set(key, row);
        else byId.delete(key);
      }
      rows = [...byId.values()].sort(byKey(def.key));
    }
    return this.hydrate(table, rows, options);
  }

  async count(table: string): Promise<number> {
    if (this.pending?.tables.has(table)) return (await this.list(table, null, { skipBlobs: true })).length;
    return this.call<number>("db_count", { table });
  }

  // ── Writes ──

  /** Runs `change` against the open transaction, or as its own one-off commit. */
  async write(change: (p: Pending) => void | Promise<void>) {
    if (this.destroyed) throw new Error("This workspace was deleted");
    if (this.pending) return change(this.pending);
    const p = new Pending();
    await change(p);
    return this.commit(p);
  }

  async stage(p: Pending, table: string, row: Row) {
    const def = this.def(table);
    const key = row[def.key];
    if (typeof key !== "string" || !key) throw new Error(`Missing ${table}.${def.key}`);
    if (def.blob) {
      const value = row[def.blob.field];
      const bytes = value instanceof Blob ? new Uint8Array(await value.arrayBuffer()) : value instanceof Uint8Array ? value : null;
      if (!bytes) throw new Error(`Missing ${table}.${def.blob.field}`);
      p.blobs.set(`${table}/${key}`, { table, key, bytes });
    }
    p.table(table).rows.set(key, row);
  }

  private commit(p: Pending): Promise<void> {
    if (p.empty) return Promise.resolve();
    const run = async () => {
      await this.open();
      try {
        // Bytes first, then the rows that point at them (an interrupted commit leaves only
        // unreferenced files, which are swept on the next start).
        for (const { table, key, bytes } of p.blobs.values()) {
          await this.invoke("blob_write", bytes, { headers: { "x-skele-db": this.name, "x-skele-table": table, "x-skele-key": key } });
        }
        const ops = p.ops().map((op) => {
          if (op.op !== "put") return op;
          const blob = this.def(op.table).blob;
          if (!blob) return op;
          const { [blob.field]: _bytes, ...rest } = op.data;
          return { ...op, data: rest };
        });
        await this.invoke("db_commit", { db: this.name, ops });
      } catch (e) {
        throw toError(e);
      }
    };
    const result = this.queue.then(run);
    this.queue = result.catch(() => {});
    return result;
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    if (this.pending) return fn();
    const p = new Pending();
    this.pending = p;
    let result: T;
    try {
      result = await fn();
    } finally {
      if (this.pending === p) this.pending = null;
    }
    await this.commit(p);
    return result;
  }

  async destroy() {
    await this.queue;
    this.destroyed = true;
    await this.invoke("db_destroy", { db: this.name }).catch((e) => {
      throw toError(e);
    });
  }
}

function toError(e: unknown): Error {
  return e instanceof Error ? e : new Error(typeof e === "string" ? e : JSON.stringify(e));
}

class SqliteTable<T> implements TableAccess<T> {
  constructor(
    private db: SqliteDb,
    private name: string,
  ) {}

  async get(key: string) {
    return (await this.db.get(this.name, [key]))[0] as T | undefined;
  }
  async bulkGet(keys: string[]) {
    return (await this.db.get(this.name, keys)) as (T | undefined)[];
  }
  async all(options?: ReadOptions) {
    return (await this.db.list(this.name, null, options)) as T[];
  }
  async where(field: string, value: string, options?: ReadOptions) {
    if (!this.db.def(this.name).indexes.includes(field)) throw new Error(`${this.name}.${field} is not indexed`);
    return (await this.db.list(this.name, { field, value }, options)) as T[];
  }
  put(row: T) {
    return this.db.write((p) => this.db.stage(p, this.name, row as Row));
  }
  bulkPut(rows: T[]) {
    if (!rows.length) return Promise.resolve();
    return this.db.write(async (p) => {
      for (const row of rows) await this.db.stage(p, this.name, row as Row);
    });
  }
  async update(key: string, patch: Partial<T>) {
    let found = false;
    // Read and write inside one transaction so the merge can't interleave with another write.
    await this.db.transaction(async () => {
      const current = await this.get(key);
      if (!current) return;
      found = true;
      await this.put({ ...current, ...patch });
    });
    return found;
  }
  delete(key: string) {
    return this.db.write((p) => {
      p.table(this.name).rows.set(key, null);
      p.blobs.delete(`${this.name}/${key}`);
    });
  }
  bulkDelete(keys: string[]) {
    if (!keys.length) return Promise.resolve();
    return this.db.write((p) => {
      for (const key of keys) {
        p.table(this.name).rows.set(key, null);
        p.blobs.delete(`${this.name}/${key}`);
      }
    });
  }
  clear() {
    return this.db.write((p) => {
      const t = p.table(this.name);
      t.cleared = true;
      t.rows.clear();
      for (const [id, b] of p.blobs) if (b.table === this.name) p.blobs.delete(id);
    });
  }
  count() {
    return this.db.count(this.name);
  }
}

const FILES_BLOB: BlobField = { field: "blob", dir: "attachments", kind: "blob", typeField: "mimeType" };

export const WORKSPACE_TABLES: TableDef[] = TABLE_NAMES.map((name) => ({
  name,
  key: SCHEMA[name].key,
  indexes: SCHEMA[name].indexes,
  ...(name === "files" ? { blob: FILES_BLOB } : {}),
}));

export const REGISTRY_TABLES: TableDef[] = [
  { name: "workspaces", key: "id", indexes: [] },
  { name: "meta", key: "key", indexes: [] },
  { name: "snapshots", key: "id", indexes: ["workspaceId"], blob: { field: "data", dir: "recovery-points", kind: "bytes" } },
];

export class SqliteWorkspaceStore implements WorkspaceStore {
  private db: SqliteDb;
  private tables = new Map<TableName, SqliteTable<unknown>>();

  constructor(
    invoke: Invoke,
    readonly workspaceId: string,
  ) {
    this.db = new SqliteDb(invoke, `ws:${workspaceId}`, WORKSPACE_TABLES);
  }

  t<K extends TableName>(name: K): TableAccess<Tables[K]> {
    let table = this.tables.get(name);
    if (!table) this.tables.set(name, (table = new SqliteTable(this.db, name)));
    return table as unknown as TableAccess<Tables[K]>;
  }

  transaction<T>(fn: () => Promise<T>): Promise<T> {
    return this.db.transaction(fn);
  }

  close() {
    // The connection belongs to the app process and stays open; nothing to release here.
  }

  destroy() {
    return this.db.destroy();
  }
}

export function sqliteEngine(invoke: Invoke): StorageEngine {
  let registry: SqliteDb | null = null;
  const reg = () => (registry ??= new SqliteDb(invoke, "registry", REGISTRY_TABLES));
  return {
    kind: "sqlite",
    workspace: (id) => new SqliteWorkspaceStore(invoke, id),
    registry: () => ({
      workspaces: new SqliteTable<WorkspaceMeta>(reg(), "workspaces"),
      meta: new SqliteTable<MetaRow>(reg(), "meta"),
    }),
    snapshots: () => new SqliteTable<SnapshotRow>(reg(), "snapshots"),
  };
}
