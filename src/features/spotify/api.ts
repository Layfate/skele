// Minimal Spotify Web API client (official endpoints only). Playback control requires Spotify
// Premium; errors are classified so the UI can explain instead of showing dead buttons.

import { accessToken } from "./auth";

const API = "https://api.spotify.com/v1";

export type SpotifyErrorKind = "not-connected" | "premium" | "no-device" | "rate-limited" | "forbidden" | "unknown";

export class SpotifyError extends Error {
  constructor(
    public kind: SpotifyErrorKind,
    message: string,
    public retryAfter?: number,
  ) {
    super(message);
    this.name = "SpotifyError";
  }
}

export async function spotifyFetch<T>(path: string, init: RequestInit = {}, retry = true): Promise<T | null> {
  const token = await accessToken();
  if (!token) throw new SpotifyError("not-connected", "Spotify isn't connected.");
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.body ? { "Content-Type": "application/json" } : {}), ...init.headers },
  });
  if (res.status === 401 && retry) {
    await accessToken(true);
    return spotifyFetch<T>(path, init, false);
  }
  if (res.status === 204 || res.status === 202) return null;
  const data = await res.json().catch(() => null);
  if (res.ok) return data as T;
  const reason = data?.error?.reason as string | undefined;
  const message = (data?.error?.message as string | undefined) ?? res.statusText;
  if (res.status === 429) throw new SpotifyError("rate-limited", "Spotify is busy — try again in a moment.", Number(res.headers.get("Retry-After")) || 5);
  if (reason === "PREMIUM_REQUIRED") throw new SpotifyError("premium", "Playback control needs Spotify Premium.");
  if (reason === "NO_ACTIVE_DEVICE" || (res.status === 404 && /device/i.test(message))) {
    throw new SpotifyError("no-device", "No active Spotify device. Open Spotify on a phone, computer or speaker, then try again.");
  }
  if (res.status === 403) throw new SpotifyError("forbidden", message || "Spotify refused this request for your account or app.");
  throw new SpotifyError("unknown", message || "Spotify request failed");
}

export type SpotifyImage = { url: string; width: number | null; height: number | null };
export type SpotifyTrack = {
  id: string;
  name: string;
  uri: string;
  duration_ms: number;
  artists: { name: string }[];
  album: { name: string; images: SpotifyImage[] };
  external_urls: { spotify: string };
};
export type SpotifyDevice = { id: string | null; name: string; type: string; is_active: boolean; volume_percent: number | null; supports_volume?: boolean; is_restricted: boolean };
export type PlaybackState = {
  is_playing: boolean;
  progress_ms: number | null;
  item: SpotifyTrack | null;
  device: SpotifyDevice;
  currently_playing_type: string;
  actions?: { disallows?: Record<string, boolean> };
};
export type SimplePlaylist = { id: string; name: string; uri: string; images: SpotifyImage[] | null; tracks: { total: number }; owner: { display_name: string } };

const q = (params: Record<string, string | number | undefined>) => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) s.set(k, String(v));
  return s.toString();
};

export const spotify = {
  me: () => spotifyFetch<{ display_name: string; product: "premium" | "free" | "open" | string; country: string }>("/me"),
  playback: () => spotifyFetch<PlaybackState>("/me/player?additional_types=episode"),
  devices: async () => (await spotifyFetch<{ devices: SpotifyDevice[] }>("/me/player/devices"))?.devices ?? [],
  play: (body?: { context_uri?: string; uris?: string[] }, deviceId?: string) =>
    spotifyFetch(`/me/player/play?${q({ device_id: deviceId })}`, { method: "PUT", body: body ? JSON.stringify(body) : undefined }),
  pause: () => spotifyFetch("/me/player/pause", { method: "PUT" }),
  next: () => spotifyFetch("/me/player/next", { method: "POST" }),
  previous: () => spotifyFetch("/me/player/previous", { method: "POST" }),
  volume: (percent: number) => spotifyFetch(`/me/player/volume?${q({ volume_percent: Math.round(Math.min(100, Math.max(0, percent))) })}`, { method: "PUT" }),
  seek: (ms: number) => spotifyFetch(`/me/player/seek?${q({ position_ms: Math.max(0, Math.round(ms)) })}`, { method: "PUT" }),
  transfer: (deviceId: string, play = true) => spotifyFetch("/me/player", { method: "PUT", body: JSON.stringify({ device_ids: [deviceId], play }) }),
  playlists: async () => (await spotifyFetch<{ items: SimplePlaylist[] }>(`/me/playlists?${q({ limit: 50 })}`))?.items ?? [],
  recentlyPlayed: async () => (await spotifyFetch<{ items: { track: SpotifyTrack; played_at: string }[] }>(`/me/player/recently-played?${q({ limit: 20 })}`))?.items ?? [],
  search: async (query: string) =>
    (await spotifyFetch<{ tracks: { items: SpotifyTrack[] }; playlists: { items: (SimplePlaylist | null)[] } }>(`/search?${q({ q: query, type: "track,playlist", limit: 10 })}`)) ?? {
      tracks: { items: [] },
      playlists: { items: [] },
    },
};

/** Smallest image at least `min` px wide (falls back to the largest). */
export function pickImage(images: SpotifyImage[] | null | undefined, min = 64) {
  if (!images?.length) return null;
  const sorted = [...images].sort((a, b) => (a.width ?? 0) - (b.width ?? 0));
  return (sorted.find((i) => (i.width ?? 0) >= min) ?? sorted.at(-1))!.url;
}
