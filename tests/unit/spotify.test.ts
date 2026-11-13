import { afterEach, describe, expect, it, vi } from "vitest";
import { appMeta } from "@/data/registry";
import { accessToken, buildAuthorizeUrl, codeChallenge, originProblem, setClientId, SPOTIFY_SCOPES, TOKEN_URL } from "@/features/spotify/auth";
import { spotify, SpotifyError } from "@/features/spotify/api";

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
