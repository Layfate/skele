#!/usr/bin/env node
// End-to-end test of the real Windows desktop app (WebView2), driven by Playwright over the
// Chrome DevTools Protocol. It checks what the browser e2e suite can't: the bundled build under
// the desktop CSP, SQLite storage through Tauri IPC, and data surviving an app restart.
//
//   node tests/desktop/windows-e2e.mjs [path to skele.exe]   (default: src-tauri/target/release/skele.exe)

import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import os from "node:os";
import path from "node:path";

if (process.platform !== "win32") {
  console.log("Windows only (WebView2 exposes the DevTools protocol); skipping.");
  process.exit(0);
}

const exe = path.resolve(process.argv[2] ?? "src-tauri/target/release/skele.exe");
const dataDir = mkdtempSync(path.join(os.tmpdir(), "skele-desktop-e2e-"));
const PORT = 9339;
const problems = [];

async function launch() {
  const child = spawn(exe, [], {
    env: { ...process.env, SKELE_DATA_DIR: dataDir, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}` },
    stdio: "ignore",
  });
  let browser;
  for (let i = 0; i < 60 && !browser; i++) {
    await new Promise((r) => setTimeout(r, 500));
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`).catch(() => undefined);
  }
  if (!browser) throw new Error("Couldn't connect to the WebView2 DevTools endpoint");
  let page;
  for (let i = 0; i < 40 && !page; i++) {
    page = browser.contexts()[0]?.pages()[0];
    if (!page) await new Promise((r) => setTimeout(r, 250));
  }
  page.on("console", (m) => {
    const text = m.text();
    if (m.type() === "error" || /Content Security Policy|Refused to/i.test(text)) problems.push(`console ${m.type()}: ${text}`);
  });
  page.on("pageerror", (e) => problems.push(`page error: ${e.message}`));
  return { child, browser, page };
}

async function quit({ child, browser }) {
  await browser.close().catch(() => {});
  child.kill();
  await new Promise((r) => setTimeout(r, 2000));
}

const sidebar = (page) => page.getByRole("complementary", { name: "Sidebar" });
const step = (s) => console.log(`• ${s}`);

let app;
try {
  // ── First run ──
  app = await launch();
  let { page } = app;
  step(`launched; url ${page.url()}`);
  await page.waitForURL(/\/welcome\/?$/, { timeout: 30_000 });
  await page.getByLabel("Workspace name").fill("Desktop E2E");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await sidebar(page).waitFor({ timeout: 30_000 });
  step("workspace created");

  await sidebar(page).getByRole("button", { name: "New page", exact: true }).click();
  await page.waitForURL(/\/page\/\?id=/);
  await page.locator(".skele-prose").waitFor();
  await page.getByLabel("Page title").fill("Persist me");
  await page.getByLabel("Page title").press("Enter");
  await page.keyboard.type("Stored in SQLite on disk");
  await page.getByText("Saved", { exact: true }).waitFor({ timeout: 10_000 });
  step("page written");

  // Reload inside the same session.
  await page.reload();
  await page.locator(".skele-prose", { hasText: "Stored in SQLite on disk" }).waitFor({ timeout: 15_000 });
  step("page survives a reload");

  // The sample workspace exercises projects, tasks and databases.
  await page.goto(new URL("/welcome/", page.url()).toString());
  await page.getByRole("button", { name: "Open the sample" }).click();
  await sidebar(page).getByText("Team handbook").waitFor({ timeout: 30_000 });
  step("sample workspace (projects, tasks, database) created");

  await page.goto(new URL("/settings/?tab=desktop", page.url()).toString());
  await page.getByText("About this app").waitFor({ timeout: 15_000 });
  const about = await page.locator("dl").first().innerText();
  if (!about.includes(dataDir)) problems.push(`Settings shows the wrong data folder: ${about}`);
  // Release builds offer automatic checks; local builds have no update source and say so.
  await page.getByText(/Check for updates automatically|built without an update source/).first().waitFor();
  step("Settings → Desktop app shows version and data folder");

  await quit(app);
  app = null;

  // ── On disk ──
  const wsDirs = readdirSync(path.join(dataDir, "workspaces"));
  if (wsDirs.length !== 2) problems.push(`expected 2 workspace folders, found ${wsDirs.length}`);
  let found = false;
  for (const id of wsDirs) {
    const file = path.join(dataDir, "workspaces", id, "workspace.sqlite3");
    if (!existsSync(file)) problems.push(`missing ${file}`);
    const db = new DatabaseSync(file, { readOnly: true });
    const rows = db.prepare("SELECT data FROM t_pages WHERE json_extract(data, '$.title') = 'Persist me'").all();
    if (rows.length) {
      const pageId = JSON.parse(rows[0].data).id;
      const content = db.prepare("SELECT data FROM t_contents WHERE key = ?").get(pageId);
      found = !!content && JSON.parse(content.data).text.includes("Stored in SQLite on disk");
    }
    db.close();
  }
  if (!found) problems.push("the page and its text aren't in the workspace's SQLite file");
  else step("page and text found in workspace.sqlite3");

  // ── Second run: everything is still there ──
  app = await launch();
  page = app.page;
  await sidebar(page).waitFor({ timeout: 30_000 });
  await sidebar(page).getByText("Team handbook").waitFor({ timeout: 15_000 });
  step("restart: last workspace reopens with its content");
  await quit(app);
  app = null;
} catch (e) {
  problems.push(`failed: ${e instanceof Error ? e.stack : e}`);
} finally {
  if (app) await quit(app);
  rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
}

if (problems.length) {
  console.error(`✗ desktop e2e found ${problems.length} problem(s):\n  - ${problems.join("\n  - ")}`);
  process.exit(1);
}
console.log("✓ desktop e2e passed");
