// Spotify OAuth 2.0 — Authorization Code with PKCE (no client secret). Works the same for Free
// and Premium accounts; Premium only matters later, for playback control.
// Tokens are stored in Skele's app registry (separate from workspaces, never exported).

import { appMeta } from "@/data/registry";
import { isDesktop, openExternal } from "@/lib/desktop";
import { base64url, codeChallenge, errorText, randomVerifier } from "@/lib/oauth";

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

type Pending = { verifier: string; state: string; returnTo: string; redirectUri?: string };

export type SpotifyAuthErrorCode =
  | "no-client-id"
  | "origin"
  | "listen-failed"
  | "cancelled"
  | "timeout"
  | "denied"
  | "unverified"
  | "no-code"
  | "network"
  | "invalid-client"
  | "redirect-mismatch"
  | "invalid-grant"
  | "server"
  | "unknown";

export class SpotifyAuthError extends Error {
  constructor(
    public code: SpotifyAuthErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SpotifyAuthError";
  }
}

export { base64url, codeChallenge, errorText, randomVerifier };

/**
 * The redirect URI to register for the desktop app. Spotify lets loopback redirect URIs that
 * are registered without a port use any port, so this keeps working when Skele has to fall back
 * from its usual port (src-tauri/src/oauth.rs).
 */
export const DESKTOP_REDIRECT_URI = "http://127.0.0.1/callback";
/** The desktop app's usual port; a redirect URI registered with it also works while it's free. */
export const DESKTOP_PREFERRED_PORT = 43827;
export const DESKTOP_LEGACY_REDIRECT_URI = `http://127.0.0.1:${DESKTOP_PREFERRED_PORT}/callback`;

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

/** What the desktop sign-in is waiting on, so the settings page can help if the browser didn't open. */
export type DesktopSignIn = {
  /** The Spotify sign-in page, to copy into a browser by hand. */
  url: string;
  redirectUri: string;
  port: number;
  browserOpened: boolean;
  browserError?: string;
  /** Set when Skele couldn't use its usual port: what that means for the registered redirect URI. */
  portNote?: string;
};

type NativeSession = { port: number; redirectUri: string; preferredPort: boolean; preferredPortError: string | null };

const NATIVE_CODES: Record<string, SpotifyAuthErrorCode> = {
  listen_failed: "listen-failed",
  cancelled: "cancelled",
  timeout: "timeout",
};

/** Turns a rejected Tauri command into a SpotifyAuthError with the native message. */
function nativeError(e: unknown, fallback: string) {
  const code = e && typeof e === "object" && "code" in e ? NATIVE_CODES[String(e.code)] : undefined;
  return new SpotifyAuthError(code ?? "unknown", errorText(e, fallback));
}

function savePending(p: Pending) {
  sessionStorage.setItem(KEY_PENDING, JSON.stringify(p));
}

/**
 * Starts the sign-in. In a browser this redirects the page (resolves "redirected"); in the
 * desktop app it starts the loopback listener, opens the system browser, waits for the redirect
 * and finishes the exchange (resolves "connected"). Failures are SpotifyAuthErrors whose
 * message says what to do.
 */
export async function beginConnect(opts: { onWaiting?: (signIn: DesktopSignIn) => void } = {}): Promise<"redirected" | "connected"> {
  const clientId = await getClientId();
  if (!clientId) throw new SpotifyAuthError("no-client-id", "Add your Spotify Client ID under “Set up” first.");
  const problem = originProblem();
  if (problem) throw new SpotifyAuthError("origin", problem);
  const verifier = randomVerifier();
  const state = randomVerifier(24);
  const challenge = await codeChallenge(verifier);
  const returnTo = window.location.pathname + window.location.search;

  if (!isDesktop()) {
    const uri = redirectUri();
    savePending({ verifier, state, returnTo, redirectUri: uri });
    window.location.assign(buildAuthorizeUrl({ clientId, redirectUri: uri, state, challenge }));
    return "redirected";
  }

  const { invoke } = await import("@tauri-apps/api/core");
  // Listen first, so a port problem is reported before a browser tab opens for nothing.
  let session: NativeSession;
  try {
    session = await invoke<NativeSession>("oauth_start", { state, provider: "Spotify" });
  } catch (e) {
    throw nativeError(e, "Skele couldn't start listening for the Spotify sign-in.");
  }
  savePending({ verifier, state, returnTo, redirectUri: session.redirectUri });
  const url = buildAuthorizeUrl({ clientId, redirectUri: session.redirectUri, state, challenge });

  let browserError: string | undefined;
  try {
    if (!(await openExternal(url))) browserError = "This window can't open a browser.";
  } catch (e) {
    browserError = errorText(e, "The system didn't open a browser.");
  }
  opts.onWaiting?.({
    url,
    redirectUri: session.redirectUri,
    port: session.port,
    browserOpened: !browserError,
    browserError,
    portNote: session.preferredPortError
      ? `${session.preferredPortError} Skele is using port ${session.port} instead, which works only if your Spotify app's redirect URI is ${DESKTOP_REDIRECT_URI} (without a port).`
      : undefined,
  });

  let query: string;
  try {
    query = await invoke<string>("oauth_wait");
  } catch (e) {
    sessionStorage.removeItem(KEY_PENDING);
    throw nativeError(e, "The Spotify sign-in stopped unexpectedly. Please try again.");
  }
  await completeConnect(query.startsWith("?") ? query : `?${query}`);
  return "connected";
}

/** Stops waiting for a desktop sign-in (the user closed the browser tab, for example). */
export async function cancelConnect() {
  if (!isDesktop()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("oauth_cancel");
}

/** Explains a failed token request (RFC 6749 §5.2 error codes, as Spotify returns them). */
function tokenError(status: number, data: { error?: string; error_description?: string }, grant: string, redirect?: string) {
  const description = data.error_description ?? "";
  if (data.error === "invalid_client") {
    return new SpotifyAuthError(
      "invalid-client",
      `Spotify doesn't accept this Client ID${description ? ` (${description})` : ""}. Check that it matches your app in the Spotify developer dashboard.`,
    );
  }
  if (data.error === "invalid_grant") {
    if (grant === "refresh_token") return new SpotifyAuthError("invalid-grant", "Your Spotify sign-in expired or was revoked. Connect Spotify again.");
    if (/redirect/i.test(description)) {
      return new SpotifyAuthError("redirect-mismatch", `Spotify rejected the redirect URI${redirect ? ` ${redirect}` : ""}. Add the redirect URI shown in Settings → Integrations to your Spotify app, then try again.`);
    }
    if (/verifier/i.test(description)) return new SpotifyAuthError("invalid-grant", "Spotify couldn't verify this sign-in. Click Connect Spotify to try again.");
    return new SpotifyAuthError("invalid-grant", "This Spotify sign-in expired or was already used. Click Connect Spotify to try again.");
  }
  if (status >= 500) return new SpotifyAuthError("server", `Spotify's sign-in service isn't responding (HTTP ${status}). Try again in a few minutes.`);
  return new SpotifyAuthError("unknown", `Spotify sign-in failed: ${description || data.error || `HTTP ${status}`}.`);
}

async function tokenRequest(body: Record<string, string>): Promise<SpotifyTokens> {
  let res: Response;
  try {
    res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body),
    });
  } catch {
    throw new SpotifyAuthError("network", "Couldn't reach accounts.spotify.com. Check your internet connection (and any proxy or firewall), then try again.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw tokenError(res.status, data, body.grant_type, body.redirect_uri);
  if (typeof data.access_token !== "string" || !data.access_token) {
    throw new SpotifyAuthError("unknown", "Spotify's reply didn't include an access token. Please try connecting again.");
  }
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
  const pending = JSON.parse(sessionStorage.getItem(KEY_PENDING) ?? "null") as Pending | null;
  sessionStorage.removeItem(KEY_PENDING);
  const error = params.get("error");
  if (error) {
    throw error === "access_denied"
      ? new SpotifyAuthError("denied", "Spotify access wasn't granted. Click Connect Spotify and choose Agree to connect.")
      : new SpotifyAuthError("unknown", `Spotify sign-in failed (${params.get("error_description") || error}).`);
  }
  if (!pending || params.get("state") !== pending.state) {
    throw new SpotifyAuthError("unverified", "This Spotify sign-in can't be verified (it may have started in another window or expired). Please try connecting again.");
  }
  const code = params.get("code");
  if (!code) throw new SpotifyAuthError("no-code", "Spotify didn't return an authorization code. Please try connecting again.");
  const tokens = await tokenRequest({
    grant_type: "authorization_code",
    code,
    // Must be exactly the redirect URI of the authorization request (including the port).
    redirect_uri: pending.redirectUri ?? redirectUri(),
    client_id: await getClientId(),
    code_verifier: pending.verifier,
  });
  await appMeta.set(KEY_TOKENS, tokens);
  return pending.returnTo || "/settings?tab=integrations";
}

let refreshing: Promise<SpotifyTokens | null> | null = null;

/**
 * A valid access token (refreshing if needed), or null when not connected. Tokens are dropped
 * only when Spotify rejects the refresh token; being offline keeps the connection and throws.
 */
export async function accessToken(force = false): Promise<string | null> {
  const tokens = await appMeta.get<SpotifyTokens>(KEY_TOKENS);
  if (!tokens) return null;
  if (!force && tokens.expiresAt > Date.now()) return tokens.accessToken;
  refreshing ??= (async () => {
    try {
      if (!tokens.refreshToken) throw new SpotifyAuthError("invalid-grant", "No refresh token");
      const next = await tokenRequest({ grant_type: "refresh_token", refresh_token: tokens.refreshToken, client_id: await getClientId() });
      await appMeta.set(KEY_TOKENS, next);
      return next;
    } catch (e) {
      if (e instanceof SpotifyAuthError && (e.code === "invalid-grant" || e.code === "invalid-client")) {
        // Refresh token revoked/expired, or the app is gone: treat as disconnected.
        await appMeta.delete(KEY_TOKENS);
        return null;
      }
      throw e;
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
