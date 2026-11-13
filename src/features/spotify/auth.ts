// Spotify OAuth 2.0 — Authorization Code with PKCE (no client secret).
// Tokens are stored in Skele's app registry (separate from workspaces, never exported).

import { appMeta } from "@/data/registry";
import { isDesktop, openExternal } from "@/lib/desktop";

export const SPOTIFY_SCOPES = [
  "user-read-playback-state",
  "user-modify-playback-state",
  "user-read-currently-playing",
  "user-read-recently-played",
  "playlist-read-private",
  "playlist-read-collaborative",
];

const AUTHORIZE_URL = "https://accounts.spotify.com/authorize";
export const TOKEN_URL = "https://accounts.spotify.com/api/token";
const KEY_TOKENS = "spotify:tokens";
const KEY_CLIENT = "spotify:clientId";
const KEY_PENDING = "skele-spotify-pkce";

export type SpotifyTokens = { accessToken: string; refreshToken: string; expiresAt: number; scope: string };

export function base64url(bytes: Uint8Array) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function randomVerifier(length = 64) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return [...bytes].map((b) => chars[b % chars.length]).join("");
}

export async function codeChallenge(verifier: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

/** The desktop app receives the sign-in on this loopback address (src-tauri/src/oauth.rs). */
export const DESKTOP_REDIRECT_URI = "http://127.0.0.1:43827/callback";

/** The redirect URI to register in the Spotify developer dashboard for this origin. */
export function redirectUri(origin = window.location.origin) {
  if (isDesktop()) return DESKTOP_REDIRECT_URI;
  return `${origin}/integrations/spotify/callback/`;
}

/** Spotify only accepts http redirect URIs on loopback IPs (127.0.0.1), not "localhost". */
export function originProblem(origin = window.location.origin): string | null {
  if (isDesktop()) return null;
  const url = new URL(origin);
  if (url.protocol === "http:" && url.hostname === "localhost") {
    return `Spotify doesn't accept “localhost” in redirect URIs. Open Skele at http://127.0.0.1:${url.port || "80"} to connect.`;
  }
  if (url.protocol === "http:" && url.hostname !== "127.0.0.1" && url.hostname !== "[::1]") {
    return "Spotify requires HTTPS (or a 127.0.0.1 loopback address) for the redirect URI.";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return "Connecting Spotify isn't available in this window yet. Use Skele in a browser to connect.";
  }
  return null;
}

export async function getClientId(): Promise<string> {
  return (await appMeta.get<string>(KEY_CLIENT)) || process.env.NEXT_PUBLIC_SPOTIFY_CLIENT_ID || "";
}

export async function setClientId(id: string) {
  const clean = id.trim();
  if (clean && !/^[0-9a-f]{32}$/i.test(clean)) throw new Error("A Spotify Client ID is 32 hexadecimal characters.");
  if (clean) await appMeta.set(KEY_CLIENT, clean);
  else await appMeta.delete(KEY_CLIENT);
}

export function buildAuthorizeUrl(args: { clientId: string; redirectUri: string; state: string; challenge: string }) {
  const url = new URL(AUTHORIZE_URL);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: args.clientId,
    scope: SPOTIFY_SCOPES.join(" "),
    redirect_uri: args.redirectUri,
    state: args.state,
    code_challenge_method: "S256",
    code_challenge: args.challenge,
  }).toString();
  return url.toString();
}

/**
 * Starts the sign-in. In a browser this redirects the page (resolves "redirected"); in the
 * desktop app it opens the system browser, waits for the loopback redirect and finishes the
 * exchange (resolves "connected").
 */
export async function beginConnect(): Promise<"redirected" | "connected"> {
  const clientId = await getClientId();
  if (!clientId) throw new Error("Add your Spotify Client ID first.");
  const problem = originProblem();
  if (problem) throw new Error(problem);
  const verifier = randomVerifier();
  const state = randomVerifier(24);
  sessionStorage.setItem(KEY_PENDING, JSON.stringify({ verifier, state, returnTo: window.location.pathname + window.location.search }));
  const url = buildAuthorizeUrl({ clientId, redirectUri: redirectUri(), state, challenge: await codeChallenge(verifier) });
  if (!isDesktop()) {
    window.location.assign(url);
    return "redirected";
  }
  const { invoke } = await import("@tauri-apps/api/core");
  const redirect = invoke<string>("oauth_wait");
  await openExternal(url);
  await completeConnect(`?${await redirect}`);
  return "connected";
}

/** Stops waiting for a desktop sign-in (the user closed the browser tab, for example). */
export async function cancelConnect() {
  if (!isDesktop()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("oauth_cancel");
}

async function tokenRequest(body: Record<string, string>): Promise<SpotifyTokens> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error_description || data.error || "Spotify authorization failed");
  return {
    accessToken: data.access_token,
    // Spotify may omit refresh_token on refresh; keep the previous one then.
    refreshToken: data.refresh_token ?? body.refresh_token ?? "",
    expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000 - 60_000,
    scope: data.scope ?? "",
  };
}

/** Completes the redirect: validates state, exchanges the code, stores tokens. Returns where to go next. */
export async function completeConnect(search: string): Promise<string> {
  const params = new URLSearchParams(search);
  const pending = JSON.parse(sessionStorage.getItem(KEY_PENDING) ?? "null") as { verifier: string; state: string; returnTo: string } | null;
  sessionStorage.removeItem(KEY_PENDING);
  if (params.get("error")) throw new Error(params.get("error") === "access_denied" ? "Spotify access was not granted." : `Spotify: ${params.get("error")}`);
  if (!pending || params.get("state") !== pending.state) throw new Error("This Spotify sign-in can't be verified. Please try connecting again.");
  const code = params.get("code");
  if (!code) throw new Error("Spotify didn't return an authorization code.");
  const tokens = await tokenRequest({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri(),
    client_id: await getClientId(),
    code_verifier: pending.verifier,
  });
  await appMeta.set(KEY_TOKENS, tokens);
  return pending.returnTo || "/settings?tab=integrations";
}

let refreshing: Promise<SpotifyTokens | null> | null = null;

/** A valid access token (refreshing if needed), or null when not connected. */
export async function accessToken(force = false): Promise<string | null> {
  const tokens = await appMeta.get<SpotifyTokens>(KEY_TOKENS);
  if (!tokens) return null;
  if (!force && tokens.expiresAt > Date.now()) return tokens.accessToken;
  refreshing ??= (async () => {
    try {
      const next = await tokenRequest({ grant_type: "refresh_token", refresh_token: tokens.refreshToken, client_id: await getClientId() });
      await appMeta.set(KEY_TOKENS, next);
      return next;
    } catch {
      // Refresh token revoked/expired: treat as disconnected.
      await appMeta.delete(KEY_TOKENS);
      return null;
    } finally {
      refreshing = null;
    }
  })();
  return (await refreshing)?.accessToken ?? null;
}

export async function isConnected() {
  return !!(await appMeta.get<SpotifyTokens>(KEY_TOKENS));
}

export async function disconnect() {
  await appMeta.delete(KEY_TOKENS);
}
