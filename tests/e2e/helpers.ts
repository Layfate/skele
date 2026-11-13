import { expect, type Page } from "@playwright/test";

/**
 * Every Playwright test runs in a fresh browser context, so local storage (IndexedDB)
 * starts empty and the app opens on the welcome screen. No accounts are involved.
 */
export async function createWorkspace(page: Page, name = "E2E workspace") {
  await page.goto("/");
  await expect(page).toHaveURL(/\/welcome\/?$/, { timeout: 60_000 });
  await page.getByLabel("Workspace name").fill(name);
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(sidebar(page)).toBeVisible({ timeout: 30_000 });
  await expect(sidebar(page)).toContainText(name);
}

export async function openSample(page: Page) {
  await page.goto("/welcome/");
  await page.getByRole("button", { name: "Open the sample" }).click();
  await expect(sidebar(page)).toContainText("Team handbook", { timeout: 30_000 });
}

export const sidebar = (page: Page) => page.getByRole("complementary", { name: "Sidebar" });
