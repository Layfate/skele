#!/usr/bin/env node
// Next 16's static export writes segment prefetch files as nested folders
// (`tasks/__next.!KGFwcCk/tasks/__PAGE__.txt`), but the router requests them with dotted names
// (`tasks/__next.!KGFwcCk.tasks.__PAGE__.txt`). Hosts without a rewrite rule (the desktop
// app's asset server, GitHub Pages, …) answer 404 and navigation falls back to slower full
// loads. This writes a dotted copy next to each nested file, so every host serves them.
// Runs after `next build` (see package.json).

import { copyFileSync, existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const out = path.resolve(import.meta.dirname, "..", "out");
if (!existsSync(out)) {
  console.error("out/ not found; run next build first");
  process.exit(1);
}

let copied = 0;
function visit(dir) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (!statSync(full).isDirectory()) continue;
    if (name.startsWith("__next.")) flatten(full, dir, [name]);
    else if (name !== "_next") visit(full);
  }
}

/** Copies `<parent>/__next.x/a/b.txt` to `<parent>/__next.x.a.b.txt`. */
function flatten(dir, parent, parts) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) flatten(full, parent, [...parts, name]);
    else if (name.endsWith(".txt")) {
      const target = path.join(parent, `${[...parts, name.slice(0, -4)].join(".")}.txt`);
      if (!existsSync(target)) {
        copyFileSync(full, target);
        copied++;
      }
    }
  }
}

visit(out);
console.log(`✓ flattened ${copied} prefetch file(s)`);
