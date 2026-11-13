#!/usr/bin/env node
// Version bookkeeping for releases.
//
//   node scripts/version.mjs current                 print the version
//   node scripts/version.mjs check [v1.2.3]          versions agree; with a tag, also that the tag
//                                                    matches and CHANGELOG.md has a section for it
//   node scripts/version.mjs set 1.2.3               set the version everywhere
//   node scripts/version.mjs notes [1.2.3]           print that version's CHANGELOG section
//
// The version lives in package.json (tauri.conf.json reads it from there) and in
// src-tauri/Cargo.toml.

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const file = (p) => path.join(root, p);
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

const readJson = (p) => JSON.parse(readFileSync(file(p), "utf8"));
const cargoVersion = () => readFileSync(file("src-tauri/Cargo.toml"), "utf8").match(/^\[package\][\s\S]*?^version\s*=\s*"([^"]+)"/m)?.[1];

function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

export function changelogSection(version, text = readFileSync(file("CHANGELOG.md"), "utf8")) {
  const lines = text.split(/\r?\n/);
  const heading = new RegExp(`^## \\[?v?${version.replace(/\./g, "\\.")}\\]?(\\s|$)`);
  const start = lines.findIndex((l) => heading.test(l));
  if (start === -1) return null;
  let end = lines.findIndex((l, i) => i > start && /^## /.test(l));
  if (end === -1) end = lines.length;
  // Drop link reference definitions at the end ("[1.0.0]: https://…").
  const body = lines.slice(start + 1, end).filter((l) => !/^\[[^\]]+\]:\s*\S+/.test(l));
  return body.join("\n").trim();
}

function check(tag) {
  const pkg = readJson("package.json").version;
  const lock = readJson("package-lock.json").version;
  const cargo = cargoVersion();
  const conf = readJson("src-tauri/tauri.conf.json").version;
  const problems = [];
  if (!SEMVER.test(pkg)) problems.push(`package.json version "${pkg}" isn't semantic versioning (MAJOR.MINOR.PATCH)`);
  if (lock !== pkg) problems.push(`package-lock.json has ${lock}, package.json has ${pkg} (run npm install)`);
  if (cargo !== pkg) problems.push(`src-tauri/Cargo.toml has ${cargo}, package.json has ${pkg}`);
  if (conf !== "../package.json" && conf !== pkg) problems.push(`src-tauri/tauri.conf.json has ${conf}`);
  if (tag !== undefined) {
    const v = tag.replace(/^refs\/tags\//, "");
    if (!/^v/.test(v)) problems.push(`tag "${v}" must start with "v" (v${pkg})`);
    else if (v.slice(1) !== pkg) problems.push(`tag ${v} doesn't match the app version ${pkg}. Run "node scripts/version.mjs set ${v.slice(1)}", commit, and tag again.`);
  }
  if (tag !== undefined) {
    // Releases need notes; everyday CI only needs the versions to agree.
    const notes = changelogSection(pkg);
    if (notes === null) problems.push(`CHANGELOG.md has no "## [${pkg}]" section`);
    else if (!notes) problems.push(`CHANGELOG.md's ${pkg} section is empty`);
  }
  if (problems.length) fail(`Version check failed:\n  - ${problems.join("\n  - ")}`);
  console.log(`✓ version ${pkg}${tag ? ` matches ${tag}; changelog section found` : " is consistent"}`);
}

function set(version) {
  if (!SEMVER.test(version ?? "")) fail(`"${version}" isn't a valid version (e.g. 1.2.3)`);
  for (const p of ["package.json", "package-lock.json"]) {
    const json = readJson(p);
    json.version = version;
    if (p === "package-lock.json" && json.packages?.[""]) json.packages[""].version = version;
    writeFileSync(file(p), JSON.stringify(json, null, 2) + "\n");
  }
  const cargoPath = file("src-tauri/Cargo.toml");
  writeFileSync(cargoPath, readFileSync(cargoPath, "utf8").replace(/^(\[package\][\s\S]*?^version\s*=\s*")[^"]+(")/m, `$1${version}$2`));
  const lockPath = file("src-tauri/Cargo.lock");
  try {
    const lockText = readFileSync(lockPath, "utf8");
    writeFileSync(lockPath, lockText.replace(/(\[\[package\]\]\r?\nname = "skele"\r?\nversion = ")[^"]+(")/, `$1${version}$2`));
  } catch {
    // No Cargo.lock yet.
  }
  console.log(`✓ version set to ${version}. Add a "## [${version}]" section to CHANGELOG.md, commit, then tag v${version}.`);
}

const [cmd, arg] = process.argv.slice(2);
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("version.mjs")) {
  switch (cmd) {
    case "current":
      console.log(readJson("package.json").version);
      break;
    case "check":
      check(arg);
      break;
    case "set":
      set(arg);
      break;
    case "notes": {
      const v = arg ?? readJson("package.json").version;
      const notes = changelogSection(v.replace(/^v/, ""));
      if (notes === null) fail(`No CHANGELOG.md section for ${v}`);
      console.log(notes);
      break;
    }
    default:
      console.log("Usage: node scripts/version.mjs current | check [tag] | set <version> | notes [version]");
      process.exit(cmd ? 1 : 0);
  }
}
