import { expect, test, type Page, type Route } from "@playwright/test";
import { createWorkspace, sidebar } from "./helpers";

// Gmail in the browser: set up the client, sign in, read, reply and save an email as a page.
// Google's sign-in, token endpoint and the Gmail API are answered by the test.

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
};
const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64url");

const HTML = `<div><h1>Spring sale</h1><p>Hello <b>Ada</b>, see <a href="https://shop.example.com/sale">our sale</a>.</p>
<ul><li>Tea</li><li>Cake</li></ul><img src="https://tracker.example.com/pixel.gif" alt=""><script>window.parent.document.title="pwned"</script></div>`;

const MESSAGES = {
  m1: {
    id: "m1",
    threadId: "t1",
    labelIds: ["INBOX", "UNREAD"],
    snippet: "Hello Ada, see our sale",
    internalDate: String(Date.now() - 60_000),
    payload: {
      mimeType: "multipart/alternative",
      headers: [
        { name: "From", value: "Shop <news@shop.example.com>" },
        { name: "To", value: "ada@example.com" },
        { name: "Subject", value: "Spring sale" },
        { name: "Message-ID", value: "<sale@shop>" },
      ],
      parts: [{ mimeType: "text/html", body: { size: HTML.length, data: b64(HTML) } }],
    },
  },
  m2: {
    id: "m2",
    threadId: "t2",
    labelIds: ["INBOX"],
    snippet: "Lunch on Friday?",
    internalDate: String(Date.now() - 3_600_000),
    payload: {
      mimeType: "text/plain",
      headers: [
        { name: "From", value: "Bob <bob@example.com>" },
        { name: "To", value: "ada@example.com" },
        { name: "Subject", value: "Lunch" },
        { name: "Message-ID", value: "<lunch@bob>" },
      ],
      body: { size: 10, data: b64("Lunch on Friday?\nBob") },
    },
  },
} as const;

async function fakeGoogle(page: Page) {
  const sent: { raw: string; threadId?: string }[] = [];
  // The consent screen: approve straight away and go back to Skele's callback.
  await page.route("https://accounts.google.com/**", async (route) => {
    const url = new URL(route.request().url());
    const back = new URL(url.searchParams.get("redirect_uri")!);
    back.search = new URLSearchParams({ code: "c1", state: url.searchParams.get("state")!, scope: url.searchParams.get("scope")! }).toString();
    await route.fulfill({ status: 302, headers: { location: back.toString() } });
  });
  await page.route("https://oauth2.googleapis.com/**", async (route: Route) => {
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    const body = new URLSearchParams(route.request().postData() ?? "");
    expect(body.get("client_secret")).toBe("GOCSPX-test");
    await route.fulfill({
      headers: { ...CORS, "content-type": "application/json" },
      body: JSON.stringify({
        access_token: "a1",
        refresh_token: "r1",
        expires_in: 3600,
        scope: "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send",
      }),
    });
  });
  await page.route("https://gmail.googleapis.com/**", async (route: Route) => {
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    const url = new URL(route.request().url());
    const path = url.pathname.replace("/gmail/v1/users/me", "");
    const json = (body: unknown) => route.fulfill({ headers: { ...CORS, "content-type": "application/json" }, body: JSON.stringify(body) });
    if (path === "/profile") return json({ emailAddress: "ada@example.com", messagesTotal: 2 });
    if (path === "/labels/INBOX") return json({ id: "INBOX", messagesUnread: 1 });
    if (path === "/messages") return json({ messages: [{ id: "m1" }, { id: "m2" }], resultSizeEstimate: 2 });
    if (path === "/messages/send") {
      sent.push(JSON.parse(route.request().postData() ?? "{}"));
      return json({ id: "s1", threadId: "t2" });
    }
    const id = path.split("/").pop() as keyof typeof MESSAGES;
    if (MESSAGES[id]) return json(MESSAGES[id]);
    return route.fulfill({ status: 404, headers: CORS, body: "{}" });
  });
  return sent;
}

test("connect Gmail, read, reply and save an email as a page", async ({ page }) => {
  const sent = await fakeGoogle(page);
  await createWorkspace(page);

  await page.goto("/settings?tab=integrations");
  await page.getByLabel("Client ID").first().fill("123-abc.apps.googleusercontent.com");
  await page.getByLabel("Client secret").fill("GOCSPX-test");
  await page.getByRole("button", { name: "Save" }).first().click();
  await expect(page.getByText("Google client saved")).toBeVisible();
  await page.getByRole("button", { name: "Connect Gmail" }).click();
  await expect(page.getByText("Connected as ada@example.com")).toBeVisible({ timeout: 30_000 });

  // Mail appears in the sidebar with the unread count.
  const mailLink = sidebar(page).getByRole("link", { name: /Mail/ });
  await expect(mailLink).toContainText("1");
  await mailLink.click();
  const saleRow = page.getByRole("button", { name: /Shop[\s\S]*Spring sale/ });
  await expect(saleRow).toBeVisible({ timeout: 30_000 });

  // HTML email: sandboxed, no scripts, remote images held back until asked.
  await saleRow.click();
  const frame = page.frameLocator('iframe[title="Email"]');
  await expect(frame.getByRole("heading", { name: "Spring sale" })).toBeVisible();
  await expect(page.getByText("Images are hidden")).toBeVisible();
  expect(await page.title()).not.toBe("pwned");

  // Save as a page: the HTML becomes Markdown with the link kept.
  await page.getByRole("button", { name: "Save as a page" }).click();
  await page.getByRole("button", { name: "Open", exact: true }).click();
  const editor = page.locator(".ProseMirror").first();
  await expect(editor).toContainText("Hello Ada, see our sale.", { timeout: 30_000 });
  await expect(editor.getByRole("link", { name: "our sale" })).toHaveAttribute("href", "https://shop.example.com/sale");
  await expect(editor).toContainText("Tea");
  await expect(editor.getByRole("link", { name: "Open in Gmail" })).toBeVisible();

  // Reply in the thread.
  await page.goto("/mail?m=m2");
  await expect(page.getByText("Lunch on Friday?").last()).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Reply", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("To")).toHaveValue("Bob <bob@example.com>");
  await expect(dialog.getByLabel("Subject")).toHaveValue("Re: Lunch");
  await dialog.getByLabel("Message").press("Control+Home");
  await dialog.getByLabel("Message").pressSequentially("Sounds good!");
  await dialog.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Email sent")).toBeVisible();
  expect(sent).toHaveLength(1);
  expect(sent[0].threadId).toBe("t2");
  const mime = Buffer.from(sent[0].raw, "base64url").toString("utf8");
  expect(mime).toContain("In-Reply-To: <lunch@bob>");
  const body = Buffer.from(mime.split("\r\n\r\n")[1].replace(/\r\n/g, ""), "base64").toString("utf8");
  expect(body).toMatch(/^Sounds good!\r\n\r\nOn .*, Bob wrote:\r\n> Lunch on Friday\?/);
});
