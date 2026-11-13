import { expect, test } from "@playwright/test";
import { createWorkspace, openSample, sidebar } from "./helpers";

test("create, write, nest, trash and restore a page", async ({ page }) => {
  await createWorkspace(page);

  // Create a page and give it a title + content.
  await sidebar(page).getByRole("button", { name: "New page", exact: true }).click();
  await expect(page).toHaveURL(/\/page\/\?id=/);
  const title = page.getByLabel("Page title");
  await expect(page.locator(".skele-prose")).toBeVisible();
  await title.fill("Release plan");
  await title.press("Enter");
  await page.keyboard.type("Ship on Friday");
  await expect(page.getByText("Saved", { exact: true })).toBeVisible({ timeout: 10_000 });

  // Persisted across a reload.
  await page.reload();
  await expect(page.getByLabel("Page title")).toHaveValue("Release plan");
  await expect(page.locator(".skele-prose")).toContainText("Ship on Friday");

  // Add a subpage from the sidebar row.
  const row = sidebar(page).getByRole("treeitem", { name: /Release plan/ });
  await row.hover();
  await row.getByRole("button", { name: "Add a page inside" }).first().click();
  await expect(page.getByLabel("Page title")).toHaveValue("");
  await page.getByLabel("Page title").fill("Checklist");
  await page.getByLabel("Page title").blur();
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText("Release plan");

  // Trash the parent: the child goes with it.
  await sidebar(page).getByRole("link", { name: "Home" }).click();
  await row.hover();
  await row.getByRole("button", { name: "Page actions" }).first().click();
  await page.getByRole("menuitem", { name: "Move to trash" }).click();
  await expect(sidebar(page).getByText("Release plan")).toHaveCount(0);

  // Restore from the trash.
  await sidebar(page).getByRole("button", { name: "Trash" }).click();
  await page.getByRole("button", { name: "Restore" }).click();
  await expect(sidebar(page).getByText("Release plan")).toBeVisible();
});

test("slash menu inserts blocks", async ({ page }) => {
  await createWorkspace(page);
  await sidebar(page).getByRole("button", { name: "New page", exact: true }).click();
  await expect(page.locator(".skele-prose")).toBeVisible();
  await page.getByLabel("Page title").press("Enter");
  await page.keyboard.type("/todo");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Buy milk");
  await expect(page.locator(".skele-prose ul[data-type='taskList']")).toContainText("Buy milk");
});

test("command palette finds pages by content", async ({ page }) => {
  await createWorkspace(page);
  await page.keyboard.press("Control+k");
  await page.getByRole("dialog", { name: "Search" }).getByRole("combobox").fill("anywhere to insert");
  await expect(page.getByRole("option", { name: /Getting started/ })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/page\/\?id=/);
});

test("wiki links connect pages and show up as backlinks", async ({ page }) => {
  await openSample(page);
  await sidebar(page).getByText("Getting started").click();
  await expect(page.locator(".skele-prose")).toBeVisible();
  await page.locator(".skele-prose").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("See [[Meeting");
  await expect(page.getByRole("option", { name: /Meeting notes/ })).toBeVisible();
  await page.keyboard.press("Enter");
  const link = page.locator(".skele-prose [data-wiki-link]", { hasText: "Meeting notes" });
  await expect(link).toBeVisible();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();

  await page.reload();
  await expect(link).toBeVisible();
  await link.click();
  await expect(page.getByLabel("Page title")).toHaveValue("Meeting notes");
  await page.getByRole("button", { name: /Details/ }).click();
  await expect(page.getByRole("complementary", { name: "Page details" })).toContainText("Getting started");
});
