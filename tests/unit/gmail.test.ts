import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appMeta } from "@/data/registry";
import {
  accessToken,
  beginConnect,
  buildAuthorizeUrl,
  builtInClient,
  completeConnect,
  disconnect,
  endedReason,
  GMAIL_SCOPES,
  getClient,
  GmailAuthError,
  missingScopes,
  ownClient,
  setClient,
  TOKEN_URL,
} from "@/features/gmail/auth";
import { bodies, buildMime, checkAddresses, decodeBody, decodeEntities, encodeHeader, gmailFetch, GmailError, listMail, parseAddress, toMail } from "@/features/gmail/api";
import { forwardSubject, mailToPage, quoted, replyAllCc, replySubject } from "@/features/gmail/text";
import { gmailTools } from "@/features/gmail/ai-tools";
import { base64url } from "@/lib/oauth";

const native = vi.hoisted(() => ({ invoke: vi.fn(), openUrl: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: native.openUrl }));

const CLIENT = { clientId: "123-abc.apps.googleusercontent.com", clientSecret: "GOCSPX-secret" };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const b64 = (s: string) => base64url(new TextEncoder().encode(s));

let store: Map<string, string>;
let startedState = "";

function desktop(wait?: () => Promise<string>) {
  store = new Map();
  vi.stubGlobal("window", { __TAURI_INTERNALS__: {}, location: { origin: "http://tauri.localhost", pathname: "/settings", search: "?tab=integrations" } });
  vi.stubGlobal("sessionStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
  native.invoke.mockImplementation(async (cmd: string, args?: { state: string; provider: string }) => {
    if (cmd === "oauth_start") {
      startedState = args!.state;
      return { port: 43827, redirectUri: "http://127.0.0.1:43827/callback", preferredPort: true, preferredPortError: null };
    }
    if (cmd === "oauth_wait") return wait ? wait() : `code=c1&state=${startedState}&scope=${encodeURIComponent(GMAIL_SCOPES.join(" "))}`;
    throw new Error(`unexpected command ${cmd}`);
  });
}

const tokens = (over: Record<string, unknown> = {}) => json(200, { access_token: "a1", refresh_token: "r1", expires_in: 3600, scope: GMAIL_SCOPES.join(" "), ...over });

beforeEach(async () => {
  native.invoke.mockReset();
  native.openUrl.mockReset().mockResolvedValue(undefined);
  await setClient(CLIENT);
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await appMeta.delete("gmail:tokens");
  await appMeta.delete("gmail:ended");
});

describe("gmail built-in client", () => {
  const BUILT_IN = { clientId: "999-built.apps.googleusercontent.com", clientSecret: "GOCSPX-built" };
  beforeEach(async () => {
    vi.stubEnv("NEXT_PUBLIC_GMAIL_CLIENT_ID", BUILT_IN.clientId);
    vi.stubEnv("NEXT_PUBLIC_GMAIL_CLIENT_SECRET", BUILT_IN.clientSecret);
    await setClient({ clientId: "", clientSecret: "" });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("is used in the desktop app when the user saved no client of their own", async () => {
    desktop();
    expect(builtInClient()).toEqual(BUILT_IN);
    expect(await getClient()).toEqual(BUILT_IN);
    expect(await ownClient()).toEqual({ clientId: "", clientSecret: "" });
  });

  it("is not used in a browser, where Google needs a Web application client", async () => {
    vi.stubGlobal("window", { location: { origin: "http://127.0.0.1:3000", pathname: "/", search: "" } });
    expect(builtInClient()).toBeNull();
    expect((await getClient()).clientId).toBe("");
  });

  it("gives way to the user's own client, and switching clients signs Gmail out", async () => {
    desktop();
    await appMeta.set("gmail:tokens", { accessToken: "a", refreshToken: "r", expiresAt: Date.now() + 60_000, scope: GMAIL_SCOPES.join(" ") });
    await setClient(CLIENT);
    expect(await getClient()).toEqual(CLIENT);
    expect(await appMeta.get("gmail:tokens")).toBeUndefined();

    await appMeta.set("gmail:tokens", { accessToken: "a", refreshToken: "r", expiresAt: Date.now() + 60_000, scope: GMAIL_SCOPES.join(" ") });
    await setClient({ clientId: "", clientSecret: "" });
    expect(await getClient()).toEqual(BUILT_IN);
    expect(await appMeta.get("gmail:tokens")).toBeUndefined();
  });

  it("signs in with the built-in client in one click", async () => {
    desktop();
    vi.stubGlobal("fetch", vi.fn(async () => tokens()));
    await expect(beginConnect()).resolves.toBe("connected");
    const opened = new URL(native.openUrl.mock.calls[0][0]);
    expect(opened.searchParams.get("client_id")).toBe(BUILT_IN.clientId);
  });
});

describe("gmail auth", () => {
  it("validates the OAuth client", async () => {
    await expect(setClient({ clientId: "nope", clientSecret: "x" })).rejects.toThrow(/apps\.googleusercontent\.com/);
    await expect(setClient({ clientId: CLIENT.clientId, clientSecret: "" })).rejects.toThrow(/secret/);
  });

  it("asks for offline access with PKCE and both scopes", () => {
    const url = new URL(buildAuthorizeUrl({ clientId: "id", redirectUri: "http://127.0.0.1:1/callback", state: "s", challenge: "c" }));
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      response_type: "code",
      scope: GMAIL_SCOPES.join(" "),
      code_challenge_method: "S256",
      access_type: "offline",
      prompt: "consent",
    });
  });

  it("signs in on desktop through the loopback listener and stores tokens", async () => {
    desktop();
    const fetchMock = vi.fn().mockResolvedValue(tokens());
    vi.stubGlobal("fetch", fetchMock);
    expect(await beginConnect()).toBe("connected");
    expect(native.invoke.mock.calls[0]).toEqual(["oauth_start", { state: startedState, provider: "Gmail" }]);
    expect(fetchMock.mock.calls[0][0]).toBe(TOKEN_URL);
    const body = new URLSearchParams(String(fetchMock.mock.calls[0][1].body));
    expect(Object.fromEntries(body)).toMatchObject({
      grant_type: "authorization_code",
      code: "c1",
      redirect_uri: "http://127.0.0.1:43827/callback",
      client_id: CLIENT.clientId,
      client_secret: CLIENT.clientSecret,
    });
    expect(body.get("code_verifier")).toMatch(/^[A-Za-z0-9._~-]{64}$/);
    expect(await appMeta.get("gmail:tokens")).toMatchObject({ accessToken: "a1", refreshToken: "r1" });
  });

  it("refuses a sign-in with permissions unticked, and revokes it", async () => {
    desktop();
    const fetchMock = vi.fn().mockResolvedValueOnce(tokens({ scope: GMAIL_SCOPES[0] })).mockResolvedValue(new Response(""));
    vi.stubGlobal("fetch", fetchMock);
    await expect(beginConnect()).rejects.toMatchObject({ code: "scopes" });
    expect(fetchMock.mock.calls[1][0]).toMatch(/revoke/);
    expect(await appMeta.get("gmail:tokens")).toBeUndefined();
    expect(missingScopes(GMAIL_SCOPES.join(" "))).toEqual([]);
  });

  it("explains a denied consent screen (usually a missing test user)", async () => {
    desktop(async () => `error=access_denied&state=${startedState}`);
    await expect(beginConnect()).rejects.toThrow(/test user/);
  });

  it("rejects a redirect whose state doesn't match", async () => {
    desktop();
    store.set("skele-gmail-pkce", JSON.stringify({ verifier: "v", state: "mine", returnTo: "/", redirectUri: "x" }));
    await expect(completeConnect("?code=c&state=other")).rejects.toBeInstanceOf(GmailAuthError);
  });

  it("refreshes with the client secret and keeps the refresh token", async () => {
    await appMeta.set("gmail:tokens", { accessToken: "old", refreshToken: "r1", expiresAt: 0, scope: "" });
    const fetchMock = vi.fn().mockResolvedValue(json(200, { access_token: "new", expires_in: 3600 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await accessToken()).toBe("new");
    const body = new URLSearchParams(String(fetchMock.mock.calls[0][1].body));
    expect(body.get("client_secret")).toBe(CLIENT.clientSecret);
    expect(await appMeta.get("gmail:tokens")).toMatchObject({ accessToken: "new", refreshToken: "r1" });
  });

  it("disconnects with a reason when Google ends the sign-in (7-day Testing limit)", async () => {
    await appMeta.set("gmail:tokens", { accessToken: "old", refreshToken: "r1", expiresAt: 0, scope: "" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(400, { error: "invalid_grant" })));
    expect(await accessToken()).toBeNull();
    expect(await appMeta.get("gmail:tokens")).toBeUndefined();
    expect(await endedReason()).toMatch(/7 days/);
  });

  it("stays connected while offline", async () => {
    await appMeta.set("gmail:tokens", { accessToken: "old", refreshToken: "r1", expiresAt: 0, scope: "" });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(accessToken()).rejects.toMatchObject({ code: "network" });
    expect(await appMeta.get("gmail:tokens")).toBeDefined();
  });

  it("revokes the token on disconnect", async () => {
    await appMeta.set("gmail:tokens", { accessToken: "a", refreshToken: "r", expiresAt: Date.now() + 1e6, scope: "" });
    const fetchMock = vi.fn().mockResolvedValue(new Response(""));
    vi.stubGlobal("fetch", fetchMock);
    await disconnect();
    expect(fetchMock.mock.calls[0][0]).toMatch(/oauth2\.googleapis\.com\/revoke/);
    expect(String(fetchMock.mock.calls[0][1].body)).toBe("token=r");
    expect(await appMeta.get("gmail:tokens")).toBeUndefined();
  });
});

describe("gmail api", () => {
  beforeEach(async () => {
    await appMeta.set("gmail:tokens", { accessToken: "a1", refreshToken: "r1", expiresAt: Date.now() + 1e6, scope: "" });
  });

  it("explains a disabled Gmail API", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(403, { error: { message: "Gmail API has not been used in project 1 before or it is disabled." } })));
    await expect(gmailFetch("/profile")).rejects.toThrow(/Enable it/);
  });

  it("retries once with a fresh token after a 401", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(401, { error: { message: "bad" } }))
      .mockResolvedValueOnce(json(200, { access_token: "a2", expires_in: 3600 }))
      .mockResolvedValueOnce(json(200, { emailAddress: "me@example.com" }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await gmailFetch("/profile")).toEqual({ emailAddress: "me@example.com" });
    expect(fetchMock.mock.calls[2][1].headers.Authorization).toBe("Bearer a2");
  });

  it("reports not-connected without tokens", async () => {
    await appMeta.delete("gmail:tokens");
    await expect(gmailFetch("/profile")).rejects.toMatchObject({ kind: "not-connected" });
    expect(new GmailError("unknown", "x")).toBeInstanceOf(Error);
  });

  it("lists a folder by label, and searches all mail", async () => {
    const meta = { id: "m1", threadId: "t1", labelIds: ["UNREAD", "INBOX"], snippet: "Hi &amp; bye", internalDate: "1700000000000", payload: { mimeType: "text/plain", headers: [{ name: "From", value: "Ada <ada@x.com>" }, { name: "Subject", value: "Hello" }] } };
    const fetchMock = vi.fn(async (url: string) => (url.includes("/messages?") ? json(200, { messages: [{ id: "m1" }], nextPageToken: "n" }) : json(200, meta)));
    vi.stubGlobal("fetch", fetchMock);
    const page = await listMail({ folder: "inbox" });
    expect(new URL(fetchMock.mock.calls[0][0]).searchParams.getAll("labelIds")).toEqual(["INBOX"]);
    expect(page.messages[0]).toMatchObject({ id: "m1", from: "Ada <ada@x.com>", subject: "Hello", unread: true, snippet: "Hi & bye", date: 1700000000000 });
    expect(page.nextPageToken).toBe("n");

    fetchMock.mockClear();
    await listMail({ folder: "sent", query: "invoice" });
    const search = new URL(fetchMock.mock.calls[0][0]).searchParams;
    expect(search.get("q")).toBe("invoice");
    expect(search.getAll("labelIds")).toEqual([]);
  });

  it("decodes multipart bodies and finds attachments", () => {
    const parsed = bodies({
      mimeType: "multipart/mixed",
      parts: [
        {
          mimeType: "multipart/alternative",
          parts: [
            { mimeType: "text/plain", body: { size: 5, data: b64("Héllo ✓") } },
            { mimeType: "text/html", body: { size: 5, data: b64("<p>Héllo</p>") } },
          ],
        },
        { mimeType: "application/pdf", filename: "a.pdf", body: { size: 1200, attachmentId: "att" } },
      ],
    });
    expect(parsed).toEqual({ text: "Héllo ✓", html: "<p>Héllo</p>", attachments: [{ filename: "a.pdf", mimeType: "application/pdf", size: 1200 }] });
    expect(decodeBody(b64("~~~???"))).toBe("~~~???");
    expect(decodeEntities("&lt;a&gt; &#39;x&#x27;")).toBe("<a> 'x'");
  });

  it("parses addresses", () => {
    expect(parseAddress('"Ada L." <ada@x.com>')).toEqual({ name: "Ada L.", email: "ada@x.com" });
    expect(parseAddress("ada@x.com")).toEqual({ name: "ada@x.com", email: "ada@x.com" });
    expect(checkAddresses("ada@x.com, Bob <bob@y.org>")).toBeNull();
    expect(checkAddresses("ada@x.com, bob")).toBe("bob");
  });
});

describe("sending", () => {
  const decode = (mime: string) => {
    const [head, body] = mime.split("\r\n\r\n");
    return { head, body: new TextDecoder().decode(Uint8Array.from(atob(body.replace(/\r\n/g, "")), (c) => c.charCodeAt(0))) };
  };

  it("builds a UTF-8 plain-text message with encoded headers", () => {
    const { head, body } = decode(buildMime({ to: "Zoë <zoe@x.com>, bob@y.org", cc: "c@z.com", subject: "Café ☕", body: "Line 1\nLine 2 ✓" }));
    expect(head).toContain(`To: ${encodeHeader("Zoë")} <zoe@x.com>, bob@y.org`);
    expect(head).toContain("Cc: c@z.com");
    expect(head).toContain(`Subject: =?UTF-8?B?`);
    expect(head).toContain("Content-Type: text/plain; charset=UTF-8");
    expect(head).not.toContain("In-Reply-To");
    expect(body).toBe("Line 1\r\nLine 2 ✓");
    expect(encodeHeader("plain")).toBe("plain");
  });

  it("threads replies and can't be tricked into extra headers", () => {
    const { head } = decode(buildMime({ to: "a@x.com", subject: "Re: hi\r\nBcc: evil@x.com", body: "", inReplyTo: "<m2@x>", references: "<m1@x>" }));
    expect(head).toContain("In-Reply-To: <m2@x>");
    expect(head).toContain("References: <m1@x> <m2@x>");
    expect(head.split("\r\n").filter((l) => l.startsWith("Bcc:"))).toEqual([]);
  });

  it("sends through the API with the thread id", async () => {
    await appMeta.set("gmail:tokens", { accessToken: "a1", refreshToken: "r1", expiresAt: Date.now() + 1e6, scope: "" });
    const fetchMock = vi.fn().mockResolvedValue(json(200, { id: "s1", threadId: "t1" }));
    vi.stubGlobal("fetch", fetchMock);
    const { sendMail } = await import("@/features/gmail/api");
    await sendMail({ to: "a@x.com", subject: "s", body: "b", threadId: "t1" });
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/messages\/send$/);
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sent.threadId).toBe("t1");
    expect(sent.raw).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe("replies and pages", () => {
  const mail = toMail({
    id: "m1",
    threadId: "t1",
    internalDate: "1700000000000",
    payload: {
      mimeType: "text/plain",
      headers: [
        { name: "From", value: "Ada <ada@x.com>" },
        { name: "To", value: "me@x.com, Bob <bob@x.com>" },
        { name: "Cc", value: "carol@x.com" },
        { name: "Subject", value: "Plans" },
        { name: "Message-ID", value: "<id1@x>" },
      ],
      body: { size: 3, data: b64("See you *soon*\nAda") },
    },
  });

  it("quotes, prefixes subjects once and builds Reply all", () => {
    expect(replySubject("Plans")).toBe("Re: Plans");
    expect(replySubject("RE: Plans")).toBe("RE: Plans");
    expect(forwardSubject("Fwd: x")).toBe("Fwd: x");
    expect(quoted(mail)).toMatch(/Ada wrote:\n> See you \*soon\*\n> Ada$/);
    expect(replyAllCc(mail, "ME@x.com")).toBe("Bob <bob@x.com>, carol@x.com");
  });

  it("turns an email into a page with a link back to Gmail", () => {
    const page = mailToPage(mail, "me@x.com");
    expect(page.title).toBe("Plans");
    expect(page.markdown).toContain("**From:** Ada \\<ada@x.com\\>");
    expect(page.markdown).toContain("[Open in Gmail](https://mail.google.com/mail/?authuser=me%40x.com#all/t1)");
    expect(page.markdown).toContain("See you *soon*");
  });
});

describe("gmail AI tools", () => {
  it("lists search results with ids and reads one email", async () => {
    await appMeta.set("gmail:tokens", { accessToken: "a1", refreshToken: "r1", expiresAt: Date.now() + 1e6, scope: "" });
    const raw = { id: "m1", threadId: "t1", snippet: "Your invoice", internalDate: "1700000000000", payload: { mimeType: "text/plain", headers: [{ name: "From", value: "Shop <s@x.com>" }, { name: "Subject", value: "Invoice" }], body: { size: 1, data: b64("Total: 12 €") } } };
    vi.stubGlobal("fetch", vi.fn(async (url: string) => (url.includes("/messages?") ? json(200, { messages: [{ id: "m1" }] }) : json(200, raw))));
    const [search, read] = gmailTools();
    const found = await search.run({ query: "invoice" });
    expect(found.text).toMatch(/id: m1 .*from: Shop <s@x.com> \| subject: Invoice/);
    const full = await read.run({ id: "m1" });
    expect(full.text).toMatch(/^From: Shop <s@x.com>/);
    expect(full.text).toContain("Total: 12 €");
  });
});
