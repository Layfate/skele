import Dexie, { type Table } from "dexie";
import { SCHEMA, TABLE_NAMES, type TableAccess, type WorkspaceStore } from "../store";
import type { TableName, Tables, WorkspaceMeta } from "../types";
import type { MetaRow, SnapshotRow, StorageEngine } from "../engine";

export const workspaceDbName = (workspaceId: string) => `skele-ws-${workspaceId}`;

class DexieTable<T> implements TableAccess<T> {
  constructor(private table: Table<T, string>) {}
  get = (key: string) => this.table.get(key);
  bulkGet = (keys: string[]) => this.table.bulkGet(keys);
  all = () => this.table.toArray();
  // An equality match on one index value comes back in primary-key order.
  where = (field: string, value: string) => this.table.where(field).equals(value).toArray();
  put = async (row: T) => {
    await this.table.put(row);
  };
  bulkPut = async (rows: T[]) => {
    if (rows.length) await this.table.bulkPut(rows);
  };
  update = async (key: string, patch: Partial<T>) =>
    (await this.table.update(key, patch as Parameters<Table<T, string>["update"]>[1])) > 0;
  delete = (key: string) => this.table.delete(key);
  bulkDelete = (keys: string[]) => this.table.bulkDelete(keys);
  clear = () => this.table.clear();
  count = () => this.table.count();
}

/** IndexedDB-backed workspace store (the web build and the PWA). */
export class DexieWorkspaceStore implements WorkspaceStore {
  private db: Dexie;
  private tables = new Map<TableName, DexieTable<unknown>>();

  constructor(readonly workspaceId: string) {
    // Strict durability: a resolved write has been flushed to disk (crash safety over speed).
    this.db = new Dexie(workspaceDbName(workspaceId), { chromeTransactionDurability: "strict" });
    this.db.version(1).stores(
      Object.fromEntries(TABLE_NAMES.map((name) => [name, [SCHEMA[name].key, ...SCHEMA[name].indexes].join(", ")])),
    );
  }

  t<K extends TableName>(name: K): TableAccess<Tables[K]> {
    let table = this.tables.get(name);
    if (!table) {
      table = new DexieTable(this.db.table(name));
      this.tables.set(name, table);
    }
    return table as unknown as TableAccess<Tables[K]>;
  }

  transaction<T>(fn: () => Promise<T>): Promise<T> {
    // Reuse an enclosing transaction (nested repository calls).
    if (Dexie.currentTransaction) return fn();
    return this.db.transaction("rw", this.db.tables, fn);
  }

  close() {
    this.db.close();
  }

  async destroy() {
    this.db.close();
    await Dexie.delete(workspaceDbName(this.workspaceId));
  }
}

// ── App registry (workspace list, preferences, integration tokens) and recovery points ──

class RegistryDb extends Dexie {
  workspaces!: Table<WorkspaceMeta, string>;
  meta!: Table<MetaRow, string>;
  constructor() {
    super("skele", { chromeTransactionDurability: "strict" });
    this.version(1).stores({ workspaces: "id", meta: "key" });
  }
}

class SnapshotDb extends Dexie {
  snapshots!: Table<SnapshotRow, string>;
  constructor() {
    super("skele-snapshots");
    this.version(1).stores({ snapshots: "id, workspaceId" });
  }
}

/** IndexedDB storage: one database per workspace, plus "skele" (registry) and "skele-snapshots". */
export function dexieEngine(): StorageEngine {
  let registry: RegistryDb | null = null;
  let snapshots: SnapshotDb | null = null;
  const reg = () => (registry ??= new RegistryDb());
  return {
    kind: "indexeddb",
    workspace: (id) => new DexieWorkspaceStore(id),
    registry: () => ({ workspaces: new DexieTable(reg().workspaces), meta: new DexieTable(reg().meta) }),
    snapshots: () => new DexieTable((snapshots ??= new SnapshotDb()).snapshots),
  };
}
