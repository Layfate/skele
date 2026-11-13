import { expect, test } from "@playwright/test";
import { createWorkspace, sidebar } from "./helpers";

test("create a project, add tasks and drag one across the board", async ({ page }) => {
  await createWorkspace(page);
  await sidebar(page).getByRole("link", { name: "Projects" }).click();
  await page.getByRole("button", { name: "New project" }).first().click();
  await page.getByLabel("Name").fill("Launch");
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page).toHaveURL(/\/project\/\?id=/);

  for (const t of ["Write copy", "Design hero"]) {
    await page.getByLabel("New task title").first().fill(t);
    await page.getByLabel("New task title").first().press("Enter");
    await expect(page.getByText(t)).toBeVisible();
  }

  await page.getByRole("tab", { name: "Board" }).click();
  const column = page.locator("section[aria-label='In progress']");
  const card = page.locator("section[aria-label='Not started']").getByText("Design hero");
  await expect(card).toBeVisible();
  await expect(column).toBeVisible();
  // dnd-kit needs real pointer movement past its 5px activation distance.
  await card.hover();
  await page.mouse.down();
  const from = (await card.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2 + 12, from.y + from.height / 2 + 12, { steps: 5 });
  const to = (await column.boundingBox())!;
  await page.mouse.move(to.x + to.width / 2, to.y + 80, { steps: 15 });
  await page.mouse.up();
  await expect(column.getByText("Design hero")).toBeVisible();

  // The new status is persisted.
  await page.reload();
  await expect(page.locator("section[aria-label='In progress']").getByText("Design hero")).toBeVisible();
});

test("database: add a record and set its status", async ({ page }) => {
  await createWorkspace(page);
  await page.getByRole("button", { name: "New database" }).click();
  await expect(page.getByRole("tablist", { name: "Views" })).toBeVisible();
  await page.getByRole("button", { name: "New record" }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByLabel("Record name").fill("Fix login bug");
  await sheet.getByRole("button", { name: "Empty" }).first().click();
  await page.getByRole("option", { name: "In progress" }).click();
  await expect(sheet.getByRole("button", { name: "In progress" })).toBeVisible();
  await sheet.getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("row", { name: /Fix login bug/ })).toContainText("In progress");
});

test("bulk-select tasks and change their status together", async ({ page }) => {
  await createWorkspace(page);
  await sidebar(page).getByRole("link", { name: "Projects" }).click();
  await page.getByRole("button", { name: "New project" }).first().click();
  await page.getByLabel("Name").fill("Bulk");
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page).toHaveURL(/\/project\/\?id=/);
  for (const t of ["Alpha", "Beta", "Gamma"]) {
    await page.getByLabel("New task title").first().fill(t);
    await page.getByLabel("New task title").first().press("Enter");
    await expect(page.getByText(t)).toBeVisible();
  }

  await page.getByRole("checkbox", { name: "Select Alpha" }).click();
  await page.getByRole("button", { name: /Gamma/ }).click({ modifiers: ["Shift"] });
  const bar = page.getByRole("toolbar", { name: "Selected tasks" });
  await expect(bar).toContainText("3 selected");
  await page.getByRole("button", { name: /Beta/ }).click(); // plain click toggles while selecting
  await expect(bar).toContainText("2 selected");

  await bar.getByRole("button", { name: "Status" }).click();
  await page.getByRole("menuitem", { name: "Completed" }).click();
  const done = page.locator("section[aria-label='Completed']");
  await expect(done.getByText("Alpha")).toBeVisible();
  await expect(done.getByText("Gamma")).toBeVisible();
  await expect(page.locator("section[aria-label='Not started']").getByText("Beta")).toBeVisible();

  await page.reload();
  await expect(page.locator("section[aria-label='Completed']").getByText("Gamma")).toBeVisible();
});

test("a task can get its own note, which lists the task back", async ({ page }) => {
  await createWorkspace(page);
  await sidebar(page).getByRole("link", { name: "My tasks" }).click();
  await page.getByLabel("New task title").first().fill("Draft launch post");
  await page.getByLabel("New task title").first().press("Enter");
  await page.getByRole("button", { name: /Draft launch post/ }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByRole("button", { name: "New note" }).click();
  await expect(sheet.getByLabel("Linked note")).toHaveValue(/.+/);
  await sheet.getByRole("link", { name: "Open" }).click();
  await expect(page.getByLabel("Page title")).toHaveValue("Draft launch post");
  await page.getByRole("button", { name: /Details/ }).click();
  const tasks = page.getByRole("complementary", { name: "Page details" });
  await expect(tasks.getByRole("link", { name: "Draft launch post" })).toBeVisible();
});
