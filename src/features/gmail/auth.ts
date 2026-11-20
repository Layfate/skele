// Gmail sign-in: Google OAuth 2.0, Authorization Code with PKCE, using Skele's built-in Google
// OAuth client (desktop builds made with NEXT_PUBLIC_GMAIL_CLIENT_ID) or the user's own Google
// Cloud OAuth client (see docs/GMAIL.md). Google's token endpoint wants the client secret even
// with PKCE; for a "Desktop app" client Google treats it as public, and Skele keeps it, like the
// tokens, only in its local app registry (never in workspaces, backups or exports).

import { appMeta } from "@/data/registry";
import { isDesktop, openExternal } from "@/lib/desktop";
import { codeChallenge, errorText, randomVerifier } from "@/lib/oauth";

export const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
];

const AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const KEY_TOKENS = "gmail:tokens";
const KEY_CLIENT = "gmail:client";
/** Why the last connection ended on its own (an expired sign-in), shown until the next connect. */
const KEY_ENDED = "gmail:ended";
const KEY_PENDING = "skele-gmail-pkce";

export type GmailTokens = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scope: string;
};
export type GmailClient = { clientId: string; clientSecret: string };

type Pending = {
  verifier: string;
  state: string;
  returnTo: string;
  redirectUri: string;
};

export type GmailAuthErrorCode =
  | "no-client"
  | "origin"
  | "listen-failed"
  | "cancelled"
  | "timeout"
  | "denied"
  | "scopes"
  | "unverified"
  | "no-code"
  | "network"
  | "invalid-client"
  | "redirect-mismatch"
  | "invalid-grant"
  | "server"
  | "unknown";

export class GmailAuthError extends Error {
  constructor(
    public code: GmailAuthErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "GmailAuthError";
  }
}

/** The redirect URI for a browser copy of Skele (a "Web application" client must list it). */
export function redirectUri(origin = window.location.origin) {
  return `${origin}/integrations/gmail/callback/`;
}

/** Google only accepts http redirect URIs on localhost / loopback addresses. */
export function originProblem(origin = window.location.origin): string | null {
  if (isDesktop()) return null;
  const url = new URL(origin);
  if (
    url.protocol === "http:" &&
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  ) {
    return "Google requires HTTPS (or a localhost address) for the redirect URI.";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return "Connecting Gmail isn't available in this window. Use the desktop app or Skele in a browser.";
  }
  return null;
}

/**
 * The Google client this build ships with, so connecting is one click: a "Desktop app" client
 * set at build time. Only the desktop app uses it, since Google only lets a Desktop client
 * redirect to 127.0.0.1; a browser copy of Skele needs the user's own "Web application" client.
 */
export function builtInClient(): GmailClient | null {
  const clientId = process.env.NEXT_PUBLIC_GMAIL_CLIENT_ID?.trim() ?? "";
  const clientSecret =
    process.env.NEXT_PUBLIC_GMAIL_CLIENT_SECRET?.trim() ?? "";
  if (!clientId || !clientSecret || !isDesktop()) return null;
  return { clientId, clientSecret };
}

/** The client the user saved under "Use your own Google client", if any. */
export async function ownClient(): Promise<GmailClient> {
  return (
    (await appMeta.get<GmailClient>(KEY_CLIENT)) ?? {
      clientId: "",
      clientSecret: "",
    }
  );
}

/** The client Skele signs in with: the user's own when saved, otherwise the built-in one. */
export async function getClient(): Promise<GmailClient> {
  const own = await ownClient();
  if (own.clientId && own.clientSecret) return own;
  return builtInClient() ?? own;
}

/**
 * Checks and saves the OAuth client. Clearing the Client ID removes it (falling back to the
 * built-in client). A sign-in belongs to the client that made it, so changing which client
 * Skele uses signs Gmail out.
 */
export async function setClient(client: GmailClient) {
  const clientId = client.clientId.trim();
  const clientSecret = client.clientSecret.trim();
  const before = (await getClient()).clientId;
  if (!clientId) {
    await appMeta.delete(KEY_CLIENT);
    if ((await getClient()).clientId !== before)
      await appMeta.delete(KEY_TOKENS);
    return;
  }
  if (!/^[\w-]+\.apps\.googleusercontent\.com$/.test(clientId)) {
    throw new Error(
      "A Google Client ID ends in “.apps.googleusercontent.com”. Copy it from your OAuth client in Google Cloud.",
    );
  }
  if (!clientSecret)
    throw new Error(
      "Add the client secret too. Google asks for it even for desktop apps.",
    );
  if (/\s/.test(clientSecret))
    throw new Error("The client secret can't contain spaces.");
  await appMeta.set(KEY_CLIENT, { clientId, clientSecret });
  if (clientId !== before) await appMeta.delete(KEY_TOKENS);
}

export function buildAuthorizeUrl(args: {
  clientId: string;
  redirectUri: string;
  state: string;
  challenge: string;
  loginHint?: string;
}) {
  const url = new URL(AUTHORIZE_URL);
  const params: Record<string, string> = {
    response_type: "code",
    client_id: args.clientId,
    scope: GMAIL_SCOPES.join(" "),
    redirect_uri: args.redirectUri,
    state: args.state,
    code_challenge_method: "S256",
    code_challenge: args.challenge,
    // A refresh token, so Skele stays connected; "consent" makes Google send one every time.
    access_type: "offline",
    prompt: "consent",
  };
  if (args.loginHint) params.login_hint = args.loginHint;
  url.search = new URLSearchParams(params).toString();
  return url.toString();
}

/** What the desktop sign-in is waiting on, so the settings page can help if the browser didn't open. */
export type DesktopSignIn = {
  url: string;
  redirectUri: string;
  port: number;
  browserOpened: boolean;
  browserError?: string;
};

type NativeSession = { port: number; redirectUri: string };

const NATIVE_CODES: Record<string, GmailAuthErrorCode> = {
  listen_failed: "listen-failed",
  cancelled: "cancelled",
  timeout: "timeout",
};

function nativeError(e: unknown, fallback: string) {
  const code =
    e && typeof e === "object" && "code" in e
      ? NATIVE_CODES[String(e.code)]
      : undefined;
  return new GmailAuthError(code ?? "unknown", errorText(e, fallback));
}

function savePending(p: Pending) {
  sessionStorage.setItem(KEY_PENDING, JSON.stringify(p));
}

/**
 * Starts the sign-in. In a browser this redirects the page (resolves "redirected"); in the
 * desktop app it listens on 127.0.0.1, opens the system browser, waits for Google's redirect
 * and finishes the exchange (resolves "connected").
 */
export async function beginConnect(
  opts: { onWaiting?: (signIn: DesktopSignIn) => void } = {},
): Promise<"redirected" | "connected"> {
  const { clientId, clientSecret } = await getClient();
  if (!clientId || !clientSecret)
    throw new GmailAuthError(
      "no-client",
      "Add your Google Client ID and secret under “Use your own Google client” first.",
    );
  const problem = originProblem();
  if (problem) throw new GmailAuthError("origin", problem);
  const verifier = randomVerifier();
  const state = randomVerifier(24);
  const challenge = await codeChallenge(verifier);
  const returnTo = window.location.pathname + window.location.search;

  if (!isDesktop()) {
    const uri = redirectUri();
    savePending({ verifier, state, returnTo, redirectUri: uri });
    window.location.assign(
      buildAuthorizeUrl({ clientId, redirectUri: uri, state, challenge }),
    );
    return "redirected";
  }

  const { invoke } = await import("@tauri-apps/api/core");
  let session: NativeSession;
  try {
    session = await invoke<NativeSession>("oauth_start", {
      state,
      provider: "Gmail",
    });
  } catch (e) {
    throw nativeError(
      e,
      "Skele couldn't start listening for the Google sign-in.",
    );
  }
  savePending({ verifier, state, returnTo, redirectUri: session.redirectUri });
  const url = buildAuthorizeUrl({
    clientId,
    redirectUri: session.redirectUri,
    state,
    challenge,
  });

  let browserError: string | undefined;
  try {
    if (!(await openExternal(url)))
      browserError = "This window can't open a browser.";
  } catch (e) {
    browserError = errorText(e, "The system didn't open a browser.");
  }
  opts.onWaiting?.({
    url,
    redirectUri: session.redirectUri,
    port: session.port,
    browserOpened: !browserError,
    browserError,
  });

  let query: string;
  try {
    query = await invoke<string>("oauth_wait");
  } catch (e) {
    sessionStorage.removeItem(KEY_PENDING);
    throw nativeError(
      e,
      "The Google sign-in stopped unexpectedly. Please try again.",
    );
  }
  await completeConnect(query.startsWith("?") ? query : `?${query}`);
  return "connected";
}

export async function cancelConnect() {
  if (!isDesktop()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("oauth_cancel");
}

/** Explains a failed token request (RFC 6749 §5.2 codes, as Google returns them). */
function tokenError(
  status: number,
  data: { error?: string; error_description?: string },
  grant: string,
) {
  const description = data.error_description ?? "";
  if (data.error === "invalid_client" || data.error === "unauthorized_client") {
    return new GmailAuthError(
      "invalid-client",
      `Google doesn't accept this OAuth client${description ? ` (${description})` : ""}. Check the Client ID and secret in Settings → Integrations.`,
    );
  }
  if (data.error === "invalid_grant") {
    if (grant === "refresh_token") {
      return new GmailAuthError(
        "invalid-grant",
        "Your Gmail sign-in expired or was revoked. Google ends sign-ins after 7 days while your Google Cloud app is in Testing. Connect Gmail again.",
      );
    }
    return new GmailAuthError(
      "invalid-grant",
      "This Google sign-in expired or was already used. Click Connect Gmail to try again.",
    );
  }
  if (data.error === "redirect_uri_mismatch") {
    return new GmailAuthError(
      "redirect-mismatch",
      "Google rejected the redirect URI. Use a “Desktop app” OAuth client for the desktop app (see Set up).",
    );
  }
  if (status >= 500)
    return new GmailAuthError(
      "server",
      `Google's sign-in service isn't responding (HTTP ${status}). Try again in a few minutes.`,
    );
  return new GmailAuthError(
    "unknown",
    `Google sign-in failed: ${description || data.error || `HTTP ${status}`}.`,
  );
}

async function tokenRequest(
  body: Record<string, string>,
): Promise<GmailTokens> {
  let res: Response;
  try {
    res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body),
    });
  } catch {
    throw new GmailAuthError(
      "network",
      "Couldn't reach Google. Check your internet connection (and any proxy or firewall), then try again.",
    );
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw tokenError(res.status, data, body.grant_type);
  if (typeof data.access_token !== "string" || !data.access_token) {
    throw new GmailAuthError(
      "unknown",
      "Google's reply didn't include an access token. Please try connecting again.",
    );
  }
  return {
    accessToken: data.access_token,
    // Google omits refresh_token on refresh; keep the previous one then.
    refreshToken: data.refresh_token ?? body.refresh_token ?? "",
    expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000 - 60_000,
    scope: data.scope ?? "",
  };
}

/** Scopes the user didn't grant (Google lets them untick some on the consent screen). */
export function missingScopes(granted: string) {
  const have = new Set(granted.split(/\s+/));
  return GMAIL_SCOPES.filter((s) => !have.has(s));
}

/** Completes the redirect: validates state, exchanges the code, stores tokens. Returns where to go next. */
export async function completeConnect(search: string): Promise<string> {
  const params = new URLSearchParams(search);
  const pending = JSON.parse(
    sessionStorage.getItem(KEY_PENDING) ?? "null",
  ) as Pending | null;
  sessionStorage.removeItem(KEY_PENDING);
  const error = params.get("error");
  if (error) {
    throw error === "access_denied"
      ? new GmailAuthError(
          "denied",
          "Google didn't grant access. If it said the app hasn't been verified or you can't use it, add your Gmail address as a test user in Google Cloud (Google Auth Platform → Audience), then try again.",
        )
      : new GmailAuthError(
          "unknown",
          `Google sign-in failed (${params.get("error_description") || error}).`,
        );
  }
  if (!pending || params.get("state") !== pending.state) {
    throw new GmailAuthError(
      "unverified",
      "This Google sign-in can't be verified (it may have started in another window or expired). Please try connecting again.",
    );
  }
  const code = params.get("code");
  if (!code)
    throw new GmailAuthError(
      "no-code",
      "Google didn't return an authorization code. Please try connecting again.",
    );
  const { clientId, clientSecret } = await getClient();
  const tokens = await tokenRequest({
    grant_type: "authorization_code",
    code,
    redirect_uri: pending.redirectUri,
    client_id: clientId,
    client_secret: clientSecret,
    code_verifier: pending.verifier,
  });
  const missing = missingScopes(tokens.scope);
  if (tokens.scope && missing.length) {
    await revoke(tokens.accessToken);
    throw new GmailAuthError(
      "scopes",
      `Skele needs every permission on Google's consent screen (missing: ${missing.map((s) => s.split("/").pop()).join(", ")}). Connect again and leave all the boxes ticked.`,
    );
  }
  await appMeta.set(KEY_TOKENS, tokens);
  await appMeta.delete(KEY_ENDED);
  return pending.returnTo || "/settings?tab=integrations";
}

let refreshing: Promise<GmailTokens | null> | null = null;

/**
 * A valid access token (refreshing if needed), or null when not connected. Tokens are dropped
 * only when Google rejects the refresh token; being offline keeps the connection and throws.
 */
export async function accessToken(force = false): Promise<string | null> {
  const tokens = await appMeta.get<GmailTokens>(KEY_TOKENS);
  if (!tokens) return null;
  if (!force && tokens.expiresAt > Date.now()) return tokens.accessToken;
  refreshing ??= (async () => {
    try {
      if (!tokens.refreshToken)
        throw new GmailAuthError(
          "invalid-grant",
          "Your Gmail sign-in has no refresh token. Connect Gmail again.",
        );
      const { clientId, clientSecret } = await getClient();
      const next = await tokenRequest({
        grant_type: "refresh_token",
        refresh_token: tokens.refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      });
      await appMeta.set(KEY_TOKENS, next);
      return next;
    } catch (e) {
      if (
        e instanceof GmailAuthError &&
        (e.code === "invalid-grant" || e.code === "invalid-client")
      ) {
        await appMeta.delete(KEY_TOKENS);
        await appMeta.set(KEY_ENDED, e.message);
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
  return !!(await appMeta.get<GmailTokens>(KEY_TOKENS));
}

/** Why Gmail disconnected by itself, if it did (cleared on the next connect). */
export async function endedReason() {
  return (await appMeta.get<string>(KEY_ENDED)) ?? null;
}

const KEY_AI = "gmail:ai";

/** Whether AI chats may search and read your mail (off until you turn it on). */
export async function aiAccess() {
  return (await appMeta.get<boolean>(KEY_AI)) === true;
}

export async function setAiAccess(on: boolean) {
  await appMeta.set(KEY_AI, on);
}

async function revoke(token: string) {
  try {
    await fetch(REVOKE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
    });
  } catch {
    // Offline: the tokens are deleted locally anyway, and the user can revoke in their Google account.
  }
}

/** Forgets the tokens and asks Google to revoke them. */
export async function disconnect() {
  const tokens = await appMeta.get<GmailTokens>(KEY_TOKENS);
  await appMeta.delete(KEY_TOKENS);
  await appMeta.delete(KEY_ENDED);
  if (tokens) await revoke(tokens.refreshToken || tokens.accessToken);
}
