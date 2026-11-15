import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appMeta } from "@/data/registry";
import {
  accessToken,
  beginConnect,
  buildAuthorizeUrl,
  codeChallenge,
  completeConnect,
  DESKTOP_REDIRECT_URI,
  errorText,
  originProblem,
  setClientId,
  SPOTIFY_SCOPES,
  SpotifyAuthError,
  TOKEN_URL,
  type DesktopSignIn,
} from "@/features/spotify/auth";
import { spotify, SpotifyError } from "@/features/spotify/api";

const native = vi.hoisted(() => ({ invoke: vi.fn(), openUrl: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: native.openUrl }));

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(body === null ? null : JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

afterEach(async () => {
  vi.unstubAllGlobals();
  await appMeta.delete("spotify:tokens");
});

describe("spotify auth (PKCE)", () => {
  it("derives the S256 challenge per RFC 7636", async () => {
    expect(await codeChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  it("builds an authorization URL without any client secret", () => {
    const url = new URL(buildAuthorizeUrl({ clientId: "abc", redirectUri: "http://127.0.0.1:3000/integrations/spotify/callback/", state: "s1", challenge: "c1" }));
    expect(url.origin + url.pathname).toBe("https://accounts.spotify.com/authorize");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: "code",
      client_id: "abc",
      scope: SPOTIFY_SCOPES.join(" "),
      redirect_uri: "http://127.0.0.1:3000/integrations/spotify/callback/",
      state: "s1",
      code_challenge_method: "S256",
      code_challenge: "c1",
    });
    expect(url.toString()).not.toMatch(/secret/i);
  });

  it("explains redirect URIs Spotify won't accept", () => {
    expect(originProblem("http://localhost:3000")).toMatch(/127\.0\.0\.1:3000/);
    expect(originProblem("http://127.0.0.1:3000")).toBeNull();
    expect(originProblem("https://skele.example.com")).toBeNull();
    expect(originProblem("http://example.com")).toMatch(/HTTPS/);
  });

  it("validates client ids", async () => {
    await expect(setClientId("not-an-id")).rejects.toThrow(/32/);
    await setClientId("0123456789abcdef0123456789abcdef");
  });

  it("refreshes expired tokens and keeps the refresh token when Spotify omits it", async () => {
    await appMeta.set("spotify:tokens", { accessToken: "old", refreshToken: "r1", expiresAt: Date.now() - 1000, scope: "" });
    const fetchMock = vi.fn().mockResolvedValue(json(200, { access_token: "new", expires_in: 3600, scope: "x" }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await accessToken()).toBe("new");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(TOKEN_URL);
    expect(String(init.body)).toContain("grant_type=refresh_token");
    expect(String(init.body)).toContain("refresh_token=r1");
    expect((await appMeta.get<{ refreshToken: string }>("spotify:tokens"))?.refreshToken).toBe("r1");
  });

  it("disconnects when the refresh token is revoked", async () => {
    await appMeta.set("spotify:tokens", { accessToken: "old", refreshToken: "r1", expiresAt: 0, scope: "" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(400, { error: "invalid_grant" })));
    expect(await accessToken()).toBeNull();
    expect(await appMeta.get("spotify:tokens")).toBeUndefined();
  });
});

describe("spotify api", () => {
  const connect = () => appMeta.set("spotify:tokens", { accessToken: "tok", refreshToken: "r", expiresAt: Date.now() + 3_600_000, scope: "" });

  it("classifies Premium, no-device and rate-limit errors", async () => {
    await connect();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(403, { error: { status: 403, message: "Player command failed", reason: "PREMIUM_REQUIRED" } })));
    await expect(spotify.pause()).rejects.toMatchObject({ kind: "premium" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(404, { error: { status: 404, message: "Player command failed: No active device found", reason: "NO_ACTIVE_DEVICE" } })));
    await expect(spotify.next()).rejects.toMatchObject({ kind: "no-device" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(429, { error: { status: 429 } }, { "Retry-After": "7" })));
    await expect(spotify.playback()).rejects.toMatchObject({ kind: "rate-limited", retryAfter: 7 });
  });

  it("treats 204 (nothing playing) as null and sends the bearer token", async () => {
    await connect();
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await spotify.playback()).toBeNull();
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer tok");
  });

  it("refuses requests when not connected", async () => {
    await expect(spotify.me()).rejects.toBeInstanceOf(SpotifyError);
  });
});

describe("spotify desktop sign-in", () => {
  const CLIENT = "0123456789abcdef0123456789abcdef";
  let store: Map<string, string>;
  let startedState: string;

  /** Pretends to be the Tauri window: a desktop origin, sessionStorage and the oauth commands. */
  function desktop(overrides: { start?: () => unknown; wait?: () => Promise<string> } = {}) {
    store = new Map();
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {}, location: { origin: "tauri://localhost", pathname: "/settings", search: "?tab=integrations" } });
    vi.stubGlobal("sessionStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
    native.invoke.mockImplementation(async (cmd: string, args?: { state: string }) => {
      if (cmd === "oauth_start") {
        startedState = args!.state;
        return overrides.start ? overrides.start() : { port: 43827, redirectUri: "http://127.0.0.1:43827/callback", preferredPort: true, preferredPortError: null };
      }
      if (cmd === "oauth_wait") return overrides.wait ? overrides.wait() : `code=c1&state=${startedState}`;
      if (cmd === "oauth_cancel") return null;
      throw new Error(`unexpected command ${cmd}`);
    });
  }

  const tokenOk = () => vi.fn().mockResolvedValue(json(200, { access_token: "a1", refresh_token: "r1", expires_in: 3600, scope: SPOTIFY_SCOPES.join(" ") }));

  beforeEach(async () => {
    native.invoke.mockReset();
    native.openUrl.mockReset().mockResolvedValue(undefined);
    await setClientId(CLIENT);
  });

  it("listens before opening the browser, then exchanges the code with the same redirect URI", async () => {
    desktop();
    const fetchMock = tokenOk();
    vi.stubGlobal("fetch", fetchMock);
    const waiting = vi.fn();
    expect(await beginConnect({ onWaiting: waiting })).toBe("connected");

    expect(native.invoke.mock.calls.map((c) => c[0])).toEqual(["oauth_start", "oauth_wait"]);
    expect(native.invoke.mock.invocationCallOrder[0]).toBeLessThan(native.openUrl.mock.invocationCallOrder[0]);
    const authorize = new URL(native.openUrl.mock.calls[0][0]);
    expect(authorize.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:43827/callback");
    expect(authorize.searchParams.get("state")).toBe(startedState);
    expect(authorize.searchParams.get("code_challenge_method")).toBe("S256");
    expect(waiting.mock.calls[0][0]).toMatchObject({ browserOpened: true, port: 43827, portNote: undefined });

    const body = new URLSearchParams(String(fetchMock.mock.calls[0][1].body));
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("redirect_uri")).toBe("http://127.0.0.1:43827/callback");
    expect(body.get("client_id")).toBe(CLIENT);
    expect(body.get("code_verifier")).toMatch(/^[A-Za-z0-9._~-]{64}$/);
    expect(body.has("client_secret")).toBe(false);
    expect(await appMeta.get("spotify:tokens")).toMatchObject({ accessToken: "a1", refreshToken: "r1" });
  });

  it("uses the fallback port Skele was given and explains what it needs", async () => {
    desktop({
      start: () => ({
        port: 51234,
        redirectUri: "http://127.0.0.1:51234/callback",
        preferredPort: false,
        preferredPortError: "Port 43827 on 127.0.0.1 is already in use by another program.",
      }),
    });
    const fetchMock = tokenOk();
    vi.stubGlobal("fetch", fetchMock);
    let signIn: DesktopSignIn | undefined;
    await beginConnect({ onWaiting: (s) => (signIn = s) });
    expect(new URL(native.openUrl.mock.calls[0][0]).searchParams.get("redirect_uri")).toBe("http://127.0.0.1:51234/callback");
    expect(signIn?.portNote).toContain("43827");
    expect(signIn?.portNote).toContain(DESKTOP_REDIRECT_URI);
    expect(new URLSearchParams(String(fetchMock.mock.calls[0][1].body)).get("redirect_uri")).toBe("http://127.0.0.1:51234/callback");
  });

  it("reports a listener failure with the native reason and doesn't open the browser", async () => {
    desktop({
      start: () => {
        throw { code: "listen_failed", message: "Port 43827 on 127.0.0.1 is reserved by the system. Skele also couldn't open another local port." };
      },
    });
    const err = await beginConnect().catch((e) => e);
    expect(err).toBeInstanceOf(SpotifyAuthError);
    expect(err).toMatchObject({ code: "listen-failed", message: expect.stringContaining("reserved by the system") });
    expect(native.openUrl).not.toHaveBeenCalled();
  });

  it("keeps waiting with a copyable link when the browser can't be opened", async () => {
    desktop();
    vi.stubGlobal("fetch", tokenOk());
    // Tauri rejects with a plain string, which used to end up as a generic toast.
    native.openUrl.mockRejectedValue("Not allowed to open url https://accounts.spotify.com/authorize?…");
    let signIn: DesktopSignIn | undefined;
    expect(await beginConnect({ onWaiting: (s) => (signIn = s) })).toBe("connected");
    expect(signIn).toMatchObject({ browserOpened: false, browserError: expect.stringContaining("Not allowed to open url") });
    expect(signIn?.url).toMatch(/^https:\/\/accounts\.spotify\.com\/authorize\?/);
  });

  it("recovers from a cancelled or timed-out sign-in", async () => {
    desktop({ wait: () => Promise.reject({ code: "cancelled", message: "Sign-in cancelled." }) });
    await expect(beginConnect()).rejects.toMatchObject({ code: "cancelled" });
    expect(store.size).toBe(0);
    desktop({ wait: () => Promise.reject({ code: "timeout", message: "Spotify didn't send the sign-in back to Skele within 5 minutes." }) });
    await expect(beginConnect()).rejects.toMatchObject({ code: "timeout", message: expect.stringContaining("5 minutes") });
    // A new attempt works afterwards.
    desktop();
    vi.stubGlobal("fetch", tokenOk());
    expect(await beginConnect()).toBe("connected");
  });

  it("asks for a client ID before anything starts", async () => {
    desktop();
    await setClientId("");
    await expect(beginConnect()).rejects.toMatchObject({ code: "no-client-id" });
    expect(native.invoke).not.toHaveBeenCalled();
  });
});

describe("spotify callback handling", () => {
  let store: Map<string, string>;
  const pending = (extra: object = {}) => JSON.stringify({ verifier: "v", state: "s1", returnTo: "/x", ...extra });

  beforeEach(async () => {
    store = new Map([["skele-spotify-pkce", pending({ redirectUri: "http://127.0.0.1:43827/callback" })]]);
    vi.stubGlobal("window", { location: { origin: "http://127.0.0.1:3000", pathname: "/", search: "" } });
    vi.stubGlobal("sessionStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
    await setClientId("0123456789abcdef0123456789abcdef");
  });

  it("explains a denied sign-in", async () => {
    await expect(completeConnect("?error=access_denied&state=s1")).rejects.toMatchObject({ code: "denied" });
  });

  it("rejects a redirect with the wrong state", async () => {
    await expect(completeConnect("?code=c&state=other")).rejects.toMatchObject({ code: "unverified" });
  });

  it("explains token-endpoint failures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(400, { error: "invalid_grant", error_description: "Invalid redirect URI" })));
    await expect(completeConnect("?code=c&state=s1")).rejects.toMatchObject({ code: "redirect-mismatch" });
    store.set("skele-spotify-pkce", pending());
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(400, { error: "invalid_client", error_description: "Invalid client" })));
    await expect(completeConnect("?code=c&state=s1")).rejects.toMatchObject({ code: "invalid-client", message: expect.stringContaining("Client ID") });
    store.set("skele-spotify-pkce", pending());
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(completeConnect("?code=c&state=s1")).rejects.toMatchObject({ code: "network", message: expect.stringContaining("accounts.spotify.com") });
  });

  it("stays connected when a refresh fails because Spotify is unreachable", async () => {
    await appMeta.set("spotify:tokens", { accessToken: "old", refreshToken: "r1", expiresAt: 0, scope: "" });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(accessToken()).rejects.toMatchObject({ code: "network" });
    expect(await appMeta.get("spotify:tokens")).toBeDefined();
    await expect(spotify.me()).rejects.toMatchObject({ kind: "unknown", message: expect.stringContaining("accounts.spotify.com") });
  });

  it("explains Spotify's development-mode user allowlist", async () => {
    await appMeta.set("spotify:tokens", { accessToken: "tok", refreshToken: "r", expiresAt: Date.now() + 3_600_000, scope: "" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(403, { error: { status: 403, message: "User not registered in the Developer Dashboard" } })));
    await expect(spotify.me()).rejects.toMatchObject({ kind: "forbidden", message: expect.stringContaining("User Management") });
  });

  it("reads Spotify's plain-text development-mode errors", async () => {
    await appMeta.set("spotify:tokens", { accessToken: "tok", refreshToken: "r", expiresAt: Date.now() + 3_600_000, scope: "" });
    const text = (body: string) => vi.fn().mockResolvedValue(new Response(body, { status: 403, headers: { "Content-Type": "text/plain" } }));
    vi.stubGlobal(
      "fetch",
      text("Active premium subscription required for the owner of the app. When the subscription status changes, it can take a few hours before requests are allowed again."),
    );
    await expect(spotify.me()).rejects.toMatchObject({ kind: "forbidden", message: expect.stringMatching(/owner of your Spotify developer app to have Premium/) });
    vi.stubGlobal("fetch", text("Check settings on developer.spotify.com/dashboard, the user may not be registered."));
    await expect(spotify.me()).rejects.toMatchObject({ kind: "forbidden", message: expect.stringContaining("User Management") });
    vi.stubGlobal("fetch", text("Something new"));
    await expect(spotify.me()).rejects.toMatchObject({ kind: "forbidden", message: "Something new" });
  });
});

describe("spotify errors and permissions", () => {
  it("reads messages from strings and Tauri error objects", () => {
    expect(errorText("Not allowed to open url x", "fallback")).toBe("Not allowed to open url x");
    expect(errorText({ code: "timeout", message: "Timed out" }, "fallback")).toBe("Timed out");
    expect(errorText(new Error("boom"), "fallback")).toBe("boom");
    expect(errorText(undefined, "fallback")).toBe("fallback");
  });

  it("lets the desktop window open http(s) links in the system browser", () => {
    // Regression: "opener:allow-open-url" alone has no URL scope, so every openUrl was refused.
    const capability = JSON.parse(readFileSync(path.resolve("src-tauri/capabilities/default.json"), "utf8")) as { permissions: (string | { identifier: string })[] };
    const ids = capability.permissions.map((p) => (typeof p === "string" ? p : p.identifier));
    expect(ids).toContain("opener:allow-open-url");
    expect(ids).toContain("opener:allow-default-urls");
  });
});
