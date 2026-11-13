import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { unzipSync } from "fflate";
import { createWorkspace, sidebar } from "./helpers";

test("first launch shows the welcome screen and needs no account", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/welcome\/?$/);
  await expect(page.getByRole("heading", { name: "Welcome to Skele" })).toBeVisible();
  await expect(page.getByText(/sign in|log in|password/i)).toHaveCount(0);
});

test("workspaces persist across reloads", async ({ page }) => {
  await createWorkspace(page, "Persistent");
  await page.reload();
  await expect(sidebar(page)).toContainText("Persistent");
  await expect(sidebar(page).getByText("Getting started")).toBeVisible();
});

test("backup export → import round-trips a workspace", async ({ page }) => {
  await createWorkspace(page, "Round trip");
  await sidebar(page).getByRole("button", { name: "New page", exact: true }).click();
  await expect(page.locator(".skele-prose")).toBeVisible();
  await page.getByLabel("Page title").fill("Backed up note");
  await page.getByLabel("Page title").press("Enter");
  await page.keyboard.type("Keep this safe");
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();

  await page.goto("/settings/?tab=backup");
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export backup" }).click()]);
  expect(download.suggestedFilename()).toMatch(/\.skele$/);
  const path = await download.path();
  const zip = unzipSync(new Uint8Array(readFileSync(path)));
  expect(Object.keys(zip)).toContain("skele.json");
  expect(new TextDecoder().decode(zip["skele.json"])).toContain("Keep this safe");

  // Import it as a second workspace.
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("button", { name: "Import as new workspace" }).click()]);
  await chooser.setFiles(path);
  await expect(sidebar(page).getByText("Backed up note")).toBeVisible({ timeout: 30_000 });
  await sidebar(page).getByText("Backed up note").click();
  await expect(page.locator(".skele-prose")).toContainText("Keep this safe");
});

test("Markdown export produces .md files with wiki links", async ({ page }) => {
  await page.goto("/welcome/");
  await page.getByRole("button", { name: "Open the sample" }).click();
  await expect(sidebar(page)).toContainText("Meeting notes", { timeout: 30_000 });
  await page.goto("/settings/?tab=backup");
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export as Markdown" }).click()]);
  const zip = unzipSync(new Uint8Array(readFileSync(await download.path())));
  const names = Object.keys(zip);
  const meeting = names.find((n) => n.endsWith("Meeting notes.md"));
  expect(meeting).toBeTruthy();
  expect(new TextDecoder().decode(zip[meeting!])).toContain("[[Team handbook]]");
});
