#!/usr/bin/env node
// Writes src-tauri/tauri.ci.conf.json, merged over tauri.conf.json by `tauri build --config`.
// Everything that depends on the repository or on secrets is decided here, never hardcoded:
//
//   SKELE_REPOSITORY        owner/name, sets the updater endpoint and homepage (GitHub Releases)
//   UPDATER_SIGNED=true     a TAURI_SIGNING_PRIVATE_KEY secret exists → build signed updater files
//   MACOS_SIGNED=true       an Apple Developer ID certificate exists; otherwise ad-hoc signing
//   WINDOWS_CERT_THUMBPRINT Authenticode certificate already imported into the runner's store

import { writeFileSync } from "node:fs";
import path from "node:path";

const repo = process.env.SKELE_REPOSITORY?.trim();
const config = { bundle: { macOS: {}, windows: {} }, plugins: { updater: {} } };

if (repo) {
  config.bundle.homepage = `https://github.com/${repo}`;
  config.plugins.updater.endpoints = [`https://github.com/${repo}/releases/latest/download/latest.json`];
}
config.bundle.createUpdaterArtifacts = process.env.UPDATER_SIGNED === "true";
// "-" = ad-hoc signature: Apple Silicon refuses to run completely unsigned apps.
if (process.env.MACOS_SIGNED !== "true") config.bundle.macOS.signingIdentity = "-";
if (process.env.WINDOWS_CERT_THUMBPRINT) {
  Object.assign(config.bundle.windows, {
    certificateThumbprint: process.env.WINDOWS_CERT_THUMBPRINT,
    digestAlgorithm: "sha256",
    timestampUrl: process.env.WINDOWS_TIMESTAMP_URL || "http://timestamp.digicert.com",
  });
}

const out = path.resolve(import.meta.dirname, "..", "src-tauri", "tauri.ci.conf.json");
writeFileSync(out, JSON.stringify(config, null, 2) + "\n");
console.log(JSON.stringify(config, null, 2));
