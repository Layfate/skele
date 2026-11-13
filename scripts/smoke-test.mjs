#!/usr/bin/env node
// Launches a built Skele executable and checks that it really started: the window loaded the
// bundled app, the page ran, and it reached the SQLite storage over IPC (which creates the
// registry database). Then it closes the app.
//
//   node scripts/smoke-test.mjs --exe <path to skele / Skele.exe> [--portable | --data-dir <dir>] [--timeout 90]
//
// By default SKELE_DATA_DIR points at a temporary folder. --portable runs without it and
// expects the data in SkeleData/ next to the executable (the portable zip's layout).
// --data-dir runs without it too and expects the data in <dir> (the installed default
// location), which is left in place so later steps can check it survives an uninstall.
// On Linux CI, run it under xvfb-run.

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";

const { values: args } = parseArgs({
  options: {
    exe: { type: "string" },
    portable: { type: "boolean", default: false },
    "data-dir": { type: "string" },
    timeout: { type: "string", default: "90" },
  },
});
if (!args.exe || !existsSync(args.exe)) {
  console.error(`Executable not found: ${args.exe}`);
  process.exit(1);
}

const exe = path.resolve(args.exe);
const fixedDir = args.portable ? path.join(path.dirname(exe), "SkeleData") : args["data-dir"] ? path.resolve(args["data-dir"]) : null;
const dataDir = fixedDir ?? mkdtempSync(path.join(os.tmpdir(), "skele-smoke-"));
const expected = [path.join(dataDir, "skele.sqlite3"), ...(args.portable && process.platform !== "darwin" ? [path.join(dataDir, "webview")] : [])];
const env = { ...process.env };
if (fixedDir) delete env.SKELE_DATA_DIR;
else env.SKELE_DATA_DIR = dataDir;

console.log(`Starting ${exe}\n  data folder: ${dataDir}`);
const child = spawn(exe, [], { env, stdio: ["ignore", "pipe", "pipe"] });
let output = "";
child.stdout.on("data", (d) => (output += d));
child.stderr.on("data", (d) => (output += d));
let exited = null;
child.on("exit", (code, signal) => (exited = { code, signal }));

const deadline = Date.now() + Number(args.timeout) * 1000;
let ok = false;
while (Date.now() < deadline && !exited) {
  if (expected.every((p) => existsSync(p))) {
    ok = true;
    break;
  }
  await new Promise((r) => setTimeout(r, 500));
}
// Let the app settle (and prove it stays up) before closing it.
if (ok) await new Promise((r) => setTimeout(r, 3000));
const crashed = exited ?? null;
if (!crashed) child.kill();
await new Promise((r) => setTimeout(r, 1500));

if (!fixedDir) rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });

if (ok && !crashed) {
  console.log(`✓ Skele started and opened its database (${expected.map((p) => path.basename(p)).join(", ")})`);
  process.exit(0);
}
console.error(crashed ? `✗ Skele exited early (${JSON.stringify(crashed)})` : `✗ Skele didn't open its database within ${args.timeout}s`);
if (output.trim()) console.error(output.trim().slice(-4000));
process.exit(1);
