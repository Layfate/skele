// A stand-in for the desktop app's Rust storage commands (src-tauri/src/storage.rs), built on
// Node's own SQLite with the same table layout and SQL. Lets the whole data-layer test suite
// run against the SQLite adapter without a Tauri window. The Rust side has its own tests.

import { DatabaseSync } from "node:sqlite";
import type { Invoke } from "@/data/adapters/sqlite";

type Spec = { name: string; indexes: string[]; blobDir: string | null };
type Op = { op: "put"; table: string; key: string; data: unknown } | { op: "delete"; table: string; key: string } | { op: "clear"; table: string };

export function createSqliteBackend() {
  const dbs = new Map<string, { conn: DatabaseSync; specs: Map<string, Spec>; blobs: Map<string, Uint8Array> }>();
  const db = (name: string) => {
    const d = dbs.get(name);
    if (!d) throw `Database ${name} is not open`;
    return d;
  };
  const spec = (name: string, table: string) => {
    const s = db(name).specs.get(table);
    if (!s) throw `Unknown table: ${table}`;
    return s;
  };
  const parseRows = (rows: unknown[]) => rows.map((r) => JSON.parse((r as { data: string }).data));

  const invoke = (async (cmd: string, args?: unknown, options?: { headers: Record<string, string> }) => {
    const a = (args ?? {}) as Record<string, unknown>;
    const name = a.db as string;
    switch (cmd) {
      case "db_open": {
        let d = dbs.get(name);
        if (!d) dbs.set(name, (d = { conn: new DatabaseSync(":memory:"), specs: new Map(), blobs: new Map() }));
        for (const s of a.tables as Spec[]) {
          d.conn.exec(`CREATE TABLE IF NOT EXISTS "t_${s.name}" (key TEXT PRIMARY KEY NOT NULL, data TEXT NOT NULL)`);
          for (const f of s.indexes) d.conn.exec(`CREATE INDEX IF NOT EXISTS "ix_${s.name}_${f}" ON "t_${s.name}" (json_extract(data, '$.${f}'))`);
          d.specs.set(s.name, s);
        }
        return;
      }
      case "db_get": {
        spec(name, a.table as string);
        const stmt = db(name).conn.prepare(`SELECT data FROM "t_${a.table}" WHERE key = ?`);
        return (a.keys as string[]).map((k) => {
          const row = stmt.get(k) as { data: string } | undefined;
          return row ? JSON.parse(row.data) : null;
        });
      }
      case "db_all":
        spec(name, a.table as string);
        return parseRows(db(name).conn.prepare(`SELECT data FROM "t_${a.table}" ORDER BY key`).all());
      case "db_where": {
        const s = spec(name, a.table as string);
        if (!s.indexes.includes(a.field as string)) throw `${a.table}.${a.field} is not indexed`;
        return parseRows(db(name).conn.prepare(`SELECT data FROM "t_${a.table}" WHERE json_extract(data, '$.${a.field}') = ? ORDER BY key`).all(a.value as string));
      }
      case "db_count":
        spec(name, a.table as string);
        return Number((db(name).conn.prepare(`SELECT COUNT(*) AS n FROM "t_${a.table}"`).get() as { n: number }).n);
      case "db_commit": {
        const d = db(name);
        d.conn.exec("BEGIN");
        const orphanCheck: [string, string | null][] = [];
        try {
          for (const op of a.ops as Op[]) {
            const s = spec(name, op.table);
            if (op.op === "put") {
              if (s.blobDir && JSON.stringify(op.data).length > 100_000) throw "binary data must not be sent as JSON";
              d.conn.prepare(`INSERT INTO "t_${op.table}" (key, data) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET data = excluded.data`).run(op.key, JSON.stringify(op.data));
            } else if (op.op === "delete") {
              d.conn.prepare(`DELETE FROM "t_${op.table}" WHERE key = ?`).run(op.key);
              if (s.blobDir) orphanCheck.push([op.table, op.key]);
            } else {
              d.conn.exec(`DELETE FROM "t_${op.table}"`);
              if (s.blobDir) orphanCheck.push([op.table, null]);
            }
          }
          d.conn.exec("COMMIT");
        } catch (e) {
          d.conn.exec("ROLLBACK");
          throw e;
        }
        for (const [table, key] of orphanCheck) {
          const keys = key ? [key] : [...d.blobs.keys()].filter((k) => k.startsWith(`${table}/`)).map((k) => k.slice(table.length + 1));
          for (const k of keys) {
            if (!d.conn.prepare(`SELECT 1 FROM "t_${table}" WHERE key = ?`).get(k)) d.blobs.delete(`${table}/${k}`);
          }
        }
        return;
      }
      case "db_destroy":
        dbs.get(name)?.conn.close();
        dbs.delete(name);
        return;
      case "blob_write": {
        const h = options!.headers;
        const s = spec(h["x-skele-db"], h["x-skele-table"]);
        if (!s.blobDir) throw `Table ${h["x-skele-table"]} has no binary data`;
        if (!(args instanceof Uint8Array)) throw "Expected binary data";
        db(h["x-skele-db"]).blobs.set(`${h["x-skele-table"]}/${h["x-skele-key"]}`, args.slice());
        return;
      }
      case "blob_read": {
        const bytes = db(name).blobs.get(`${a.table}/${a.key}`);
        if (!bytes) throw `missing:${a.key}`;
        return bytes.slice().buffer;
      }
      default:
        throw `Unknown command ${cmd}`;
    }
  }) as Invoke;

  return { invoke, blobCount: (name: string) => dbs.get(name)?.blobs.size ?? 0, isOpen: (name: string) => dbs.has(name) };
}
