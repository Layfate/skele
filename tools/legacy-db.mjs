// Local PostgreSQL for development — no Docker required.
// Usage: node scripts/db.mjs [start|reset]
//   start  boots an embedded PostgreSQL 17 cluster in .data/postgres and keeps it running
//   reset  deletes the cluster directory (all local data!) — then run `start` again
import EmbeddedPostgres from "embedded-postgres";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";

const DIR = path.resolve(".data/postgres");
const PORT = Number(process.env.SKELE_DB_PORT ?? 54329);
const USER = "skele";
const PASSWORD = "skele";
const DATABASES = ["skele", "skele_test"];

const cmd = process.argv[2] ?? "start";

if (cmd === "reset") {
  rmSync(DIR, { recursive: true, force: true });
  console.log(`Removed ${DIR}`);
  process.exit(0);
}

const pg = new EmbeddedPostgres({
  databaseDir: DIR,
  user: USER,
  password: PASSWORD,
  port: PORT,
  persistent: true,
  authMethod: "scram-sha-256",
  autoRehydrateSymlinks: true,
  // Force UTF-8 — on Windows initdb otherwise defaults to the ANSI code page (no emoji).
  initdbFlags: ["--encoding=UTF8", "--locale=C"],
  onLog: () => {},
  onError: (e) => {
    const msg = String(e);
    if (!/^\s*$/.test(msg) && !/LOG:|NOTICE:/.test(msg)) console.error("[postgres]", msg.trim());
  },
});

const fresh = !existsSync(path.join(DIR, "PG_VERSION"));
if (fresh) {
  console.log("Initialising a new local PostgreSQL cluster…");
  await pg.initialise();
}
await pg.start();

const client = pg.getPgClient();
await client.connect();
for (const db of DATABASES) {
  const { rowCount } = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [db]);
  if (!rowCount) {
    await client.query(`CREATE DATABASE "${db}"`);
    console.log(`Created database ${db}`);
  }
}
await client.end();

console.log(`PostgreSQL ready → postgresql://${USER}:${PASSWORD}@localhost:${PORT}/skele`);
console.log("Press Ctrl+C to stop.");

let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  console.log("\nStopping PostgreSQL…");
  await pg.stop();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
// Keep the process alive.
setInterval(() => {}, 1 << 30);
