import { expect, test, type Page, type Route } from "@playwright/test";
import { createWorkspace } from "./helpers";

// The AI workspace in the browser. No accounts or network: the Claude API and a local Ollama
// server are answered by the test.

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "*",
  "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
  "access-control-expose-headers": "*",
};

async function preflight(route: Route) {
  if (route.request().method() !== "OPTIONS") return false;
  await route.fulfill({ status: 204, headers: CORS });
  return true;
}

/** A local Ollama with one model that answers "Hi from llama". */
async function fakeOllama(page: Page) {
  await page.route("http://127.0.0.1:11434/**", async (route) => {
    if (await preflight(route)) return;
    const path = new URL(route.request().url()).pathname;
    const json = (body: unknown) => route.fulfill({ headers: { ...CORS, "content-type": "application/json" }, body: JSON.stringify(body) });
    if (path === "/api/version") return json({ version: "0.9.0" });
    if (path === "/api/tags") return json({ models: [{ name: "llama3.2:latest", size: 2_000_000_000, details: { parameter_size: "3.2B" } }] });
    if (path === "/api/chat") {
      const lines = [
        { message: { role: "assistant", content: "Hi from " } },
        { message: { role: "assistant", content: "llama" } },
        { done: true, prompt_eval_count: 20, eval_count: 4 },
      ];
      return route.fulfill({ headers: { ...CORS, "content-type": "application/x-ndjson" }, body: lines.map((l) => JSON.stringify(l)).join("\n") + "\n" });
    }
    return route.fulfill({ status: 404, headers: CORS, body: "{}" });
  });
}

/** The Claude API: rate-limited until `state.limited` is false, then a streamed reply. */
async function fakeClaude(page: Page, state: { limited: boolean }) {
  await page.route("https://api.anthropic.com/**", async (route) => {
    if (await preflight(route)) return;
    if (state.limited) {
      return route.fulfill({
        status: 429,
        headers: { ...CORS, "content-type": "application/json", "x-should-retry": "false" },
        body: JSON.stringify({ type: "error", error: { type: "rate_limit_error", message: "Rate limited" } }),
      });
    }
    const events: [string, unknown][] = [
      [
        "message_start",
        {
          type: "message_start",
          message: { id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5-5", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 12, output_tokens: 1 } },
        },
      ],
      ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }],
      ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello from Claude" } }],
      ["content_block_stop", { type: "content_block_stop", index: 0 }],
      ["message_delta", { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 5 } }],
      ["message_stop", { type: "message_stop" }],
    ];
    return route.fulfill({
      headers: { ...CORS, "content-type": "text/event-stream" },
      body: events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join(""),
    });
  });
}

const composer = (page: Page) => page.getByLabel("Message", { exact: true });

async function send(page: Page, text: string) {
  await composer(page).fill(text);
  await composer(page).press("Enter");
}

test("AI settings: providers, local models, agents and desktop-only sections", async ({ page }) => {
  await fakeOllama(page);
  await createWorkspace(page, "AI settings");
  await page.goto("/settings/?tab=ai");
  await expect(page.getByRole("tab", { name: "Providers" })).toHaveAttribute("aria-selected", "true");

  for (const name of ["MCP servers", "Plugins", "Skills"]) {
    await page.getByRole("tab", { name }).click();
    await expect(page.getByRole("heading", { name: "Desktop app only" })).toBeVisible();
  }

  await page.getByRole("tab", { name: "Local models" }).click();
  await expect(page.getByText(/Running at http:\/\/127\.0\.0\.1:11434 · version 0\.9\.0/)).toBeVisible();
  await page.getByRole("radio", { name: /llama3\.2:latest/ }).click();
  await expect(page.getByRole("radio", { name: /llama3\.2:latest/ })).toHaveAttribute("aria-checked", "true");

  await page.getByRole("tab", { name: "Agents" }).click();
  await page.getByRole("button", { name: "@reviewer", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("@reviewer").first()).toBeVisible();
  await expect(page).toHaveURL(/ai=agents/);

  // Settings survive a reload.
  await page.reload();
  await expect(page.getByRole("tab", { name: "Agents" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("@reviewer").first()).toBeVisible();
});

test("the local model answers when the Claude API is rate-limited, then Claude answers again", async ({ page }) => {
  const claude = { limited: true };
  await fakeOllama(page);
  await fakeClaude(page, claude);
  await createWorkspace(page, "AI fallback");

  await page.goto("/settings/?tab=ai");
  await page.getByLabel("Anthropic API key").fill("sk-ant-test");
  await page.getByRole("button", { name: "Save" }).click();
  await page.getByRole("tab", { name: "Local models" }).click();
  await page.getByRole("radio", { name: /llama3\.2:latest/ }).click();

  await page.goto("/chat/");
  await expect(composer(page)).toBeVisible();
  await expect(page.getByRole("button", { name: /Claude API/ })).toBeVisible();
  await send(page, "Hello there");
  await expect(page.getByText("Hi from llama")).toBeVisible();
  await expect(page.getByText("Claude API is at its usage limit. Answered by the local model instead.")).toBeVisible();
  await expect(page.getByText("20 in · 4 out")).toBeAttached();

  claude.limited = false;
  await send(page, "And now?");
  await expect(page.getByText("Hello from Claude")).toBeVisible();
  await expect(page.getByText("12 in · 5 out")).toBeAttached();

  // Usage is recorded per provider.
  await page.goto("/settings/?tab=ai&ai=usage");
  await expect(page.getByRole("cell", { name: "Claude API" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Ollama" })).toBeVisible();
});

test("chat with a local model, slash commands and @agents in the browser", async ({ page }) => {
  await fakeOllama(page);
  await createWorkspace(page, "AI local");
  await page.goto("/settings/?tab=ai&ai=local");
  await page.getByRole("radio", { name: /llama3\.2:latest/ }).click();
  await page.getByRole("tab", { name: "Agents" }).click();
  await page.getByRole("button", { name: "@editor", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("@editor").first()).toBeVisible();

  await page.goto("/chat/");
  await expect(page.getByRole("button", { name: /Ollama · llama3\.2:latest/ })).toBeVisible();
  // File access is for the desktop CLIs only.
  await expect(page.getByRole("button", { name: /^Access:/ })).toHaveCount(0);

  await composer(page).fill("/");
  const menu = page.getByRole("listbox", { name: "Commands, skills and plugins" });
  await expect(menu.getByRole("option", { name: /\/compact/ })).toBeVisible();
  await composer(page).fill("");

  await send(page, "/mode read");
  await expect(page.getByText(/can only chat/)).toBeVisible();

  await composer(page).fill("Please ask @ed");
  await page.getByRole("listbox", { name: "Agents" }).getByRole("option", { name: /@editor/ }).click();
  await expect(composer(page)).toHaveValue("Please ask @editor ");
  await composer(page).press("Enter");
  await expect(page.getByText("@editor", { exact: true }).last()).toBeVisible();
  await expect(page.getByText("Hi from llama").last()).toBeVisible();
});
