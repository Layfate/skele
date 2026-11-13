#!/usr/bin/env node
// Assembles a GitHub release from the per-platform build artifacts: checks every manifest
// against the files actually present, refuses to continue if a required platform is missing,
// and writes SHA256SUMS.txt, latest.json (in-app updater metadata) and the release notes.
//
//   node scripts/assemble-release.mjs --in artifacts --out release --tag v1.2.3 --repo owner/name \
//     --required windows-x64,macos-arm64,macos-x64,macos-universal,linux-x64 [--optional …]
//
// Env (signing status, for the notes): WINDOWS_SIGNED, MACOS_NOTARIZED, UPDATER_SIGNED = "true"/"false";
// RUN_URL (link to the workflow run, for missing optional targets).

import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { changelogSection } from "./version.mjs";

const { values: args } = parseArgs({
  options: {
    in: { type: "string", default: "artifacts" },
    out: { type: "string", default: "release" },
    tag: { type: "string" },
    repo: { type: "string" },
    required: { type: "string", default: "" },
    optional: { type: "string", default: "" },
  },
});

const fail = (m) => {
  console.error(`✗ ${m}`);
  process.exit(1);
};
if (!args.tag || !args.repo) fail("--tag and --repo are required");
const version = args.tag.replace(/^v/, "");
const required = args.required.split(",").filter(Boolean);
const optional = args.optional.split(",").filter(Boolean);
const flag = (name) => process.env[name] === "true";

const LABELS = {
  "windows-x64": "Windows (x64)",
  "windows-arm64": "Windows (ARM64)",
  "macos-arm64": "macOS (Apple Silicon)",
  "macos-x64": "macOS (Intel)",
  "macos-universal": "macOS (Universal)",
  "linux-x64": "Linux (x64)",
  "linux-arm64": "Linux (ARM64)",
};

// ── Load and verify manifests ──
const manifests = new Map();
const walk = (dir) =>
  readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
const all = existsSync(args.in) ? walk(args.in) : [];
for (const file of all.filter((f) => /manifest-.+\.json$/.test(path.basename(f)))) {
  const m = JSON.parse(readFileSync(file, "utf8"));
  if (m.version !== version) fail(`${m.name} was built as ${m.version}, but the tag is ${args.tag}`);
  const dir = path.dirname(file);
  for (const f of m.files) {
    const p = path.join(dir, f.file);
    if (!existsSync(p)) fail(`${m.name}: ${f.file} is listed in the manifest but missing`);
    if (statSync(p).size !== f.size) fail(`${m.name}: ${f.file} has the wrong size (corrupt download?)`);
  }
  for (const u of m.updater) {
    if (!existsSync(path.join(dir, `${u.file}.sig`))) fail(`${m.name}: ${u.file}.sig is missing`);
  }
  manifests.set(m.name, { ...m, dir });
}

const missingRequired = required.filter((n) => !manifests.has(n));
if (missingRequired.length) fail(`Required platforms failed to build: ${missingRequired.map((n) => LABELS[n] ?? n).join(", ")}. Nothing was published.`);
const missingOptional = optional.filter((n) => !manifests.has(n));
const unexpected = [...manifests.keys()].filter((n) => !required.includes(n) && !optional.includes(n));
if (unexpected.length) fail(`Unexpected build outputs: ${unexpected.join(", ")}`);

// ── Copy files and checksum them ──
mkdirSync(args.out, { recursive: true });
const order = [...required, ...optional].filter((n) => manifests.has(n));
const download = (file) => `https://github.com/${args.repo}/releases/download/${args.tag}/${encodeURIComponent(file)}`;
const sums = [];
const sha256 = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");
for (const name of order) {
  const m = manifests.get(name);
  for (const f of m.files) {
    copyFileSync(path.join(m.dir, f.file), path.join(args.out, f.file));
    sums.push(`${sha256(path.join(args.out, f.file))}  ${f.file}`);
  }
  for (const u of new Set(m.updater.map((u) => u.file))) copyFileSync(path.join(m.dir, `${u}.sig`), path.join(args.out, `${u}.sig`));
}

// ── Updater metadata ──
const notes = changelogSection(version) ?? "";
const platforms = {};
for (const name of order) {
  for (const u of manifests.get(name).updater) platforms[u.key] = { signature: u.signature, url: download(u.file) };
}
const hasUpdater = Object.keys(platforms).length > 0;
if (hasUpdater) {
  const latest = { version, notes, pub_date: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"), platforms };
  writeFileSync(path.join(args.out, "latest.json"), JSON.stringify(latest, null, 2) + "\n");
  sums.push(`${sha256(path.join(args.out, "latest.json"))}  latest.json`);
}
writeFileSync(path.join(args.out, "SHA256SUMS.txt"), sums.join("\n") + "\n");

// ── Release notes ──
const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} MB`;
const rows = order.flatMap((name) =>
  manifests
    .get(name)
    .files.filter((f) => !f.file.endsWith(".app.tar.gz"))
    .map((f) => `| ${LABELS[name] ?? name} | [${f.file}](${download(f.file)}) | ${f.label} | ${mb(f.size)} |`),
);
const windowsSigned = flag("WINDOWS_SIGNED");
const macNotarized = flag("MACOS_NOTARIZED");
const body = [
  notes ? `## What's new\n\n${notes}` : "",
  "## Downloads",
  "",
  "| Platform | File | Type | Size |",
  "|---|---|---|---|",
  ...rows,
  "",
  "Installation help for each system is in the [README](https://github.com/" + args.repo + "#install).",
  "",
  "## Code signing",
  "",
  windowsSigned
    ? "- **Windows:** installers are code-signed."
    : '- **Windows: not code-signed.** SmartScreen may say "Windows protected your PC": choose **More info → Run anyway**.',
  macNotarized
    ? "- **macOS:** signed with a Developer ID and notarized by Apple."
    : "- **macOS: not signed with a Developer ID or notarized** (development build, ad-hoc signed). The first time, right-click Skele → **Open**, or allow it in **System Settings → Privacy & Security → Open Anyway**.",
  "- **Linux:** packages aren't GPG-signed. Use the checksums below.",
  hasUpdater
    ? "- **In-app updates:** update packages are signed with Skele's updater key and verified by the app before installing. The `.app.tar.gz` and `.sig` files are for the updater, not for manual download."
    : "- **In-app updates aren't available for this release** (no updater signing key was configured). Download new versions here.",
  "",
  "## Verify your download",
  "",
  "`SHA256SUMS.txt` lists a SHA-256 checksum for every file.",
  "",
  "```sh",
  "sha256sum --check --ignore-missing SHA256SUMS.txt        # Linux",
  "shasum -a 256 --check --ignore-missing SHA256SUMS.txt    # macOS",
  "```",
  "",
  "On Windows (PowerShell): `Get-FileHash .\\" + (rows.length ? `Skele-v${version}-windows-x86_64.exe` : "file") + "` and compare it with the line in `SHA256SUMS.txt`.",
  missingOptional.length
    ? [
        "",
        "## Not included in this release",
        "",
        ...missingOptional.map((n) => `- **${LABELS[n] ?? n}**: the build failed, so no package is published for it.${process.env.RUN_URL ? ` See the [build log](${process.env.RUN_URL}).` : ""}`),
      ].join("\n")
    : "",
]
  .filter((s) => s !== "")
  .join("\n");
writeFileSync(path.join(args.out, "release-notes.md"), body + "\n");

console.log(`✓ ${order.length} platform(s): ${order.join(", ")}`);
if (missingOptional.length) console.log(`! not included: ${missingOptional.join(", ")}`);
console.log(`✓ ${sums.length} checksums${hasUpdater ? `, latest.json with ${Object.keys(platforms).length} updater entries` : ", no updater metadata"}`);
