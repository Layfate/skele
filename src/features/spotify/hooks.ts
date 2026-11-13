"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { appMeta } from "@/data/registry";
import { spotify, SpotifyError } from "./api";
import { getClientId, isConnected } from "./auth";

export type PlayerDisplay = "sidebar" | "floating" | "off";
export const spotifyKeys = {
  status: ["spotify", "status"] as const,
  me: ["spotify", "me"] as const,
  playback: ["spotify", "playback"] as const,
  devices: ["spotify", "devices"] as const,
  playlists: ["spotify", "playlists"] as const,
  recent: ["spotify", "recent"] as const,
  display: ["spotify", "display"] as const,
};

export function useSpotifyStatus() {
  return useQuery({
    queryKey: spotifyKeys.status,
    queryFn: async () => ({ connected: await isConnected(), clientId: await getClientId() }),
    staleTime: Infinity,
  });
}

export function usePlayerDisplay() {
  return useQuery({ queryKey: spotifyKeys.display, queryFn: async () => (await appMeta.get<PlayerDisplay>("spotify:display")) ?? "sidebar", staleTime: Infinity });
}

export function useSetPlayerDisplay() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (d: PlayerDisplay) => appMeta.set("spotify:display", d),
    onMutate: (d) => qc.setQueryData(spotifyKeys.display, d),
  });
}

function useVisible() {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const on = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, []);
  return visible;
}

export function useSpotifyMe(enabled: boolean) {
  return useQuery({ queryKey: spotifyKeys.me, queryFn: spotify.me, enabled, staleTime: 10 * 60_000, retry: false });
}

/** Current playback, polled while the window is visible (Spotify has no push API for the web). */
export function usePlayback(enabled: boolean) {
  const visible = useVisible();
  return useQuery({
    queryKey: spotifyKeys.playback,
    queryFn: spotify.playback,
    enabled,
    refetchInterval: (q) => {
      const err = q.state.error;
      if (err instanceof SpotifyError && err.kind === "rate-limited") return (err.retryAfter ?? 10) * 1000;
      return visible ? 4000 : false;
    },
    retry: false,
  });
}

/** Runs a playback command, explains failures, and refreshes state shortly after. */
export function useSpotifyAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => {
      // Spotify applies commands asynchronously; give it a moment before re-reading.
      setTimeout(() => qc.invalidateQueries({ queryKey: spotifyKeys.playback }), 350);
      setTimeout(() => qc.invalidateQueries({ queryKey: spotifyKeys.playback }), 1200);
    },
    onError: (e) => {
      if (e instanceof SpotifyError && e.kind === "not-connected") qc.invalidateQueries({ queryKey: spotifyKeys.status });
      toast.error(e instanceof Error ? e.message : "Spotify request failed");
    },
  });
}
