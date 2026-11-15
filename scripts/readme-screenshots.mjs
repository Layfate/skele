// Regenerates the README screenshots in docs/screenshots from the sample workspace.
//
//   npm run build && node scripts/readme-screenshots.mjs
//
// Serves ./out, opens the sample workspace in a fresh browser (so nothing personal appears),
// visits and stars a few pages so Home isn't empty, and captures each scene in light and dark
// at a 1280×800 window and 2× pixel density (2560×1600 PNGs). The README shows the dark
// versions to visitors using GitHub's dark theme.
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

const PORT = 3123;
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = path.resolve("docs/screenshots");
mkdirSync(OUT, { recursive: true });

const server = spawn(process.execPath, ["scripts/serve.mjs", String(PORT)], { stdio: "ignore" });
const browser = await chromium.launch();

try {
  for (let i = 0; i < 50; i++) {
    if (await fetch(`${BASE}/welcome/`).then((r) => r.ok).catch(() => false)) break;
    await new Promise((r) => setTimeout(r, 200));
  }

  for (const scheme of ["light", "dark"]) {
    const suffix = scheme === "dark" ? "-dark" : "";
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2, colorScheme: scheme, reducedMotion: "reduce" });
    const page = await context.newPage();
    const sidebar = page.getByRole("complementary", { name: "Sidebar" });

    const shot = async (name) => {
      await page.mouse.move(1279, 799);
      await page.evaluate(() => (document.activeElement instanceof HTMLElement ? document.activeElement.blur() : null));
      await page.waitForTimeout(1000);
      await page.screenshot({ path: path.join(OUT, `${name}${suffix}.png`) });
      console.log(`docs/screenshots/${name}${suffix}.png`);
    };

    await page.goto(`${BASE}/welcome/`);
    await page.getByRole("button", { name: "Open the sample" }).click();
    await sidebar.getByText("Team handbook").first().waitFor({ timeout: 30_000 });
    await page.waitForTimeout(1000);

    // Use the workspace a little so Home's "Recently visited" and "Favorites" have content.
    for (const title of ["Content calendar", "Meeting notes", "Team handbook"]) {
      await sidebar.getByText(title).first().click();
      await page.waitForTimeout(800);
      const star = page.getByRole("button", { name: "Add to favorites" }).first();
      if (title !== "Content calendar" && (await star.isVisible().catch(() => false))) await star.click();
      await page.waitForTimeout(400);
    }

    // Home (reloaded so the recent-pages list includes the visits above)
    await sidebar.getByRole("link", { name: "Home" }).first().click();
    await page.waitForTimeout(1500);
    await page.reload();
    await page.getByText("My tasks").first().waitFor({ timeout: 30_000 });
    await page.waitForTimeout(1500);
    await shot("home");

    // A note with the details panel (outline, backlinks, tags)
    await sidebar.getByText("Team handbook").first().click();
    await page.getByRole("button", { name: "Details: outline, backlinks, tags" }).first().click();
    await page.getByText("Backlinks").first().waitFor();
    await shot("page");
    await page.getByRole("button", { name: "Hide details" }).first().click();

    // A project's task board
    await sidebar.getByRole("link", { name: "Projects" }).first().click();
    await page.getByText("Website relaunch").first().click();
    await page.getByText("Board", { exact: true }).first().click();
    await page.getByText("Not started").first().waitFor();
    await shot("board");

    // A database table
    await sidebar.getByText("Content calendar").first().click();
    await page.getByText("4 records").waitFor();
    await shot("database");

    await context.close();
  }
} finally {
  await browser.close();
  server.kill();
}
