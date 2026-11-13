#!/usr/bin/env node
// Collects one platform's build output into dist/ with Skele's release file names, builds the
// portable archives, and writes a manifest the release job checks before publishing.
//
//   node scripts/collect-artifacts.mjs --platform windows --arch x64 --target x86_64-pc-windows-msvc [--updater]
//
// Fails (exit 1) if anything this platform is configured to produce is missing, so a broken
// build can never be published by accident. With --updater, signed updater files (.sig) are
// required too.
//
// Names (VERSION = package.json version):
//   Windows  Skele_VERSION_x64-setup.exe · Skele_VERSION_x64.msi · Skele_VERSION_x64-portable.zip
//   macOS    Skele_VERSION_macos-arm64.dmg · Skele_VERSION_macos-arm64.zip (the .app)
//            Skele_VERSION_macos-arm64.app.tar.gz (in-app updater package, not for manual install)
//   Linux    Skele_VERSION_linux-x64.AppImage · .deb · .rpm · .tar.gz (binary + desktop entry)

import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, chmodSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { zipSync } from "fflate";

const { values: args } = parseArgs({
  options: {
    platform: { type: "string" },
    arch: { type: "string" },
    target: { type: "string" },
    updater: { type: "boolean", default: false },
    out: { type: "string", default: "dist" },
  },
});

const root = path.resolve(import.meta.dirname, "..");
const { platform, arch, target } = args;
if (!["windows", "macos", "linux"].includes(platform) || !["x64", "arm64"].includes(arch) || !target) {
  console.error("Usage: collect-artifacts.mjs --platform windows|macos|linux --arch x64|arm64 --target <rust target triple> [--updater]");
  process.exit(1);
}

const version = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).version;
// "host" = a build made without --target (output in target/release).
const releaseDir = path.join(root, "src-tauri", "target", ...(target === "host" ? [] : [target]), "release");
const bundleDir = path.join(releaseDir, "bundle");
const out = path.resolve(root, args.out);
const work = path.join(out, ".work");
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });

const rustArch = arch === "x64" ? "x86_64" : "aarch64";
const prefix = platform === "windows" ? `Skele_${version}_${arch}` : `Skele_${version}_${platform}-${arch}`;
const problems = [];
const files = [];
const updater = [];

function findOne(dir, test, what) {
  const full = path.join(bundleDir, dir);
  const matches = existsSync(full) ? readdirSync(full).filter(test) : [];
  if (matches.length !== 1) {
    problems.push(`${what}: expected one file in ${path.relative(root, full)}, found ${matches.length ? matches.join(", ") : "none"}`);
    return null;
  }
  return path.join(full, matches[0]);
}

/** Copies a bundle file to dist/ under its release name (and its updater signature, if any). */
function take(source, name, label, updaterKeys = []) {
  if (!source) return;
  copyFileSync(source, path.join(out, name));
  files.push({ file: name, label, size: statSync(source).size });
  if (!updaterKeys.length) return;
  const sig = `${source}.sig`;
  if (existsSync(sig)) {
    copyFileSync(sig, path.join(out, `${name}.sig`));
    const signature = readFileSync(sig, "utf8").trim();
    for (const key of updaterKeys) updater.push({ key, file: name, signature });
  } else if (args.updater) {
    problems.push(`${name}: updater signature (${path.basename(sig)}) is missing`);
  }
}

function zipFolder(folder, zipPath) {
  const entries = {};
  const walk = (dir, rel) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      const r = rel ? `${rel}/${name}` : name;
      if (statSync(full).isDirectory()) walk(full, r);
      else entries[r] = [readFileSync(full), { level: 9 }];
    }
  };
  walk(folder, path.basename(folder));
  writeFileSync(zipPath, zipSync(entries));
}

const license = readFileSync(path.join(root, "LICENSE"), "utf8");

if (platform === "windows") {
  take(findOne("nsis", (f) => f.endsWith("-setup.exe"), "NSIS installer"), `${prefix}-setup.exe`, "Installer (recommended)", [
    `windows-${rustArch}`,
    `windows-${rustArch}-nsis`,
  ]);
  if (arch === "x64") {
    take(findOne("msi", (f) => f.endsWith(".msi"), "MSI installer"), `${prefix}.msi`, "MSI installer (for managed deployment)", [`windows-${rustArch}-msi`]);
  }
  // Portable: the bare executable plus the marker file that keeps data next to it.
  const exe = path.join(releaseDir, "skele.exe");
  if (!existsSync(exe)) problems.push(`portable: ${path.relative(root, exe)} not found`);
  else {
    const folder = path.join(work, `${prefix}-portable`);
    mkdirSync(folder, { recursive: true });
    copyFileSync(exe, path.join(folder, "Skele.exe"));
    writeFileSync(
      path.join(folder, "skele-portable.txt"),
      [
        "This file turns on Skele's portable mode.",
        "",
        "While it sits next to Skele.exe, Skele keeps all of its data (workspaces, attachments,",
        "settings, window position) in the SkeleData folder next to Skele.exe and writes nothing",
        "to your user profile. Delete this file to use the normal data folder instead",
        "(%APPDATA%\\dev.skele.desktop).",
        "",
      ].join("\r\n"),
    );
    writeFileSync(
      path.join(folder, "README.txt"),
      [
        `Skele ${version} portable for Windows (${arch})`,
        "",
        "Run Skele.exe. No installation needed.",
        "",
        "- Your data is stored in the SkeleData folder created next to Skele.exe. Keep the folder",
        "  somewhere you can write to (not in Program Files), and move Skele.exe and SkeleData together.",
        "- To update: download the new portable zip, replace Skele.exe, and keep SkeleData.",
        "- Skele needs the Microsoft Edge WebView2 Runtime. It's part of Windows 11 and most",
        "  up-to-date Windows 10 PCs; otherwise get it from https://developer.microsoft.com/microsoft-edge/webview2/",
        "- Portable copies don't update themselves and aren't code-signed unless stated in the release notes.",
        "",
      ].join("\r\n"),
    );
    writeFileSync(path.join(folder, "LICENSE.txt"), license.replace(/\r?\n/g, "\r\n"));
    const zip = path.join(out, `${prefix}-portable.zip`);
    zipFolder(folder, zip);
    files.push({ file: path.basename(zip), label: "Portable (no installation)", size: statSync(zip).size });
  }
}

if (platform === "macos") {
  take(findOne("dmg", (f) => f.endsWith(".dmg"), "DMG"), `${prefix}.dmg`, "Disk image (recommended)");
  const app = path.join(bundleDir, "macos", "Skele.app");
  if (!existsSync(app)) problems.push(`app bundle: ${path.relative(root, app)} not found`);
  else {
    // ditto keeps permissions, symlinks and code signatures intact (a plain zip would not).
    const zip = path.join(out, `${prefix}.zip`);
    execFileSync("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", app, zip]);
    files.push({ file: path.basename(zip), label: "Zipped Skele.app", size: statSync(zip).size });
  }
  const updaterPkg = path.join(bundleDir, "macos", "Skele.app.tar.gz");
  if (existsSync(updaterPkg)) {
    take(updaterPkg, `${prefix}.app.tar.gz`, "In-app updater package (not for manual installation)", [`darwin-${rustArch}`, `darwin-${rustArch}-app`]);
  } else if (args.updater) {
    problems.push("Skele.app.tar.gz (updater package) is missing");
  }
}

if (platform === "linux") {
  take(findOne("appimage", (f) => f.endsWith(".AppImage"), "AppImage"), `${prefix}.AppImage`, "AppImage (portable, most distributions)", [
    `linux-${rustArch}`,
    `linux-${rustArch}-appimage`,
  ]);
  take(findOne("deb", (f) => f.endsWith(".deb"), "Debian package"), `${prefix}.deb`, "Debian / Ubuntu package", [`linux-${rustArch}-deb`]);
  take(findOne("rpm", (f) => f.endsWith(".rpm"), "RPM package"), `${prefix}.rpm`, "Fedora / RHEL / openSUSE package", [`linux-${rustArch}-rpm`]);
  const bin = path.join(releaseDir, "skele");
  if (!existsSync(bin)) problems.push(`tarball: ${path.relative(root, bin)} not found`);
  else {
    const name = `${prefix}`;
    const folder = path.join(work, name);
    mkdirSync(folder, { recursive: true });
    copyFileSync(bin, path.join(folder, "skele"));
    chmodSync(path.join(folder, "skele"), 0o755);
    copyFileSync(path.join(root, "src-tauri", "icons", "128x128@2x.png"), path.join(folder, "skele.png"));
    writeFileSync(
      path.join(folder, "skele.desktop"),
      [
        "[Desktop Entry]",
        "Type=Application",
        "Name=Skele",
        "Comment=A calm, local-first workspace for notes, tasks, projects and databases",
        "Exec=skele",
        "Icon=skele",
        "Terminal=false",
        "Categories=Office;Utility;",
        "StartupWMClass=skele",
        "",
      ].join("\n"),
    );
    writeFileSync(
      path.join(folder, "README.txt"),
      [
        `Skele ${version} for Linux (${arch}), standalone archive`,
        "",
        "Run ./skele. It needs WebKitGTK 4.1 and GTK 3 from your distribution:",
        "  Debian/Ubuntu: sudo apt install libwebkit2gtk-4.1-0 libgtk-3-0",
        "  Fedora:        sudo dnf install webkit2gtk4.1 gtk3",
        "  Arch:          sudo pacman -S webkit2gtk-4.1 gtk3",
        "",
        "Data is stored in ~/.local/share/dev.skele.desktop. To keep it next to the binary instead",
        "(portable mode), create an empty file named skele-portable.txt in this folder.",
        "",
        "Optional menu entry: copy skele to ~/.local/bin, skele.png to ~/.local/share/icons/,",
        "and skele.desktop to ~/.local/share/applications/.",
        "",
      ].join("\n"),
    );
    writeFileSync(path.join(folder, "LICENSE"), license);
    const tarball = path.join(out, `${name}.tar.gz`);
    execFileSync("tar", ["-czf", tarball, "-C", work, name]);
    files.push({ file: path.basename(tarball), label: "Standalone archive", size: statSync(tarball).size });
  }
}

rmSync(work, { recursive: true, force: true });

if (problems.length) {
  console.error(`✗ ${platform}-${arch}: missing build output\n  - ${problems.join("\n  - ")}`);
  process.exit(1);
}

const manifest = { name: `${platform}-${arch}`, platform, arch, target, version, files, updater, builtAt: new Date().toISOString() };
writeFileSync(path.join(out, `manifest-${platform}-${arch}.json`), JSON.stringify(manifest, null, 2));
console.log(`✓ ${platform}-${arch}: ${files.map((f) => f.file).join(", ")}${updater.length ? ` (+${updater.length} updater entries)` : ""}`);
