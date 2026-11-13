"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Copy, ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { SettingsCard } from "@/features/settings/components/settings-page";
import { isDesktop } from "@/lib/desktop";
import { beginConnect, cancelConnect, disconnect, originProblem, redirectUri, setClientId, SPOTIFY_SCOPES } from "../auth";
import { spotifyKeys, usePlayerDisplay, useSetPlayerDisplay, useSpotifyMe, useSpotifyStatus, type PlayerDisplay } from "../hooks";
import { SpotifyLogo } from "./spotify-player";

export function SpotifySettings() {
  const qc = useQueryClient();
  const status = useSpotifyStatus();
  const me = useSpotifyMe(!!status.data?.connected);
  const display = usePlayerDisplay();
  const setDisplay = useSetPlayerDisplay();
  const [clientId, setClientIdDraft] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  if (!status.data) return <Skeleton className="h-48" />;
  const uri = typeof window !== "undefined" ? redirectUri() : "";
  const problem = typeof window !== "undefined" ? originProblem() : null;

  return (
    <>
      <SettingsCard
        title="Spotify"
        description="Optional. Control your music from Skele. Skele works the same with or without it, and only talks to Spotify after you connect."
      >
        <div className="flex items-center gap-3">
          <SpotifyLogo className="size-8" />
          <div className="flex-1 text-sm">
            {status.data.connected ? (
              <>
                <p className="font-medium">Connected{me.data ? ` as ${me.data.display_name}` : ""}</p>
                <p className="text-muted-foreground">
                  {me.data?.product === "premium"
                    ? "Premium — full playback control."
                    : me.data
                      ? "Free account — you can see what's playing and browse playlists; playback control needs Premium."
                      : "Checking your account…"}
                </p>
              </>
            ) : (
              <p className="text-muted-foreground">Not connected</p>
            )}
          </div>
          {status.data.connected ? (
            <Button
              variant="outline"
              onClick={async () => {
                await disconnect();
                qc.removeQueries({ queryKey: ["spotify"] });
                qc.invalidateQueries({ queryKey: spotifyKeys.status });
                toast.success("Spotify disconnected");
              }}
            >
              Disconnect
            </Button>
          ) : connecting && isDesktop() ? (
            <div className="flex items-center gap-2">
              <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Finish signing in in your browser…
              </span>
              <Button variant="ghost" size="sm" onClick={() => void cancelConnect()}>
                Cancel
              </Button>
            </div>
          ) : (
            <Button
              disabled={!status.data.clientId || !!problem || connecting}
              onClick={async () => {
                setConnecting(true);
                try {
                  if ((await beginConnect()) === "connected") {
                    setConnecting(false);
                    qc.invalidateQueries({ queryKey: ["spotify"] });
                    toast.success("Spotify connected");
                  }
                } catch (e) {
                  setConnecting(false);
                  toast.error(e instanceof Error ? e.message : "Couldn't start Spotify sign-in");
                }
              }}
            >
              {connecting && <Loader2 className="animate-spin" />} Connect Spotify
            </Button>
          )}
        </div>
        {problem && !status.data.connected && <p className="mt-3 rounded-md bg-amber-500/10 px-3 py-2 text-sm">{problem}</p>}
      </SettingsCard>

      {status.data.connected && (
        <SettingsCard title="Player">
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Where to show the player">
            {(
              [
                ["sidebar", "In the sidebar"],
                ["floating", "Floating mini-player"],
                ["off", "Hidden"],
              ] as [PlayerDisplay, string][]
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={display.data === value}
                onClick={() => setDisplay.mutate(value)}
                className={cn("h-9 rounded-md border px-3 text-sm hover:bg-accent", display.data === value && "border-brand ring-1 ring-brand")}
              >
                {label}
              </button>
            ))}
          </div>
        </SettingsCard>
      )}

      <SettingsCard
        title="Set up (one time)"
        description="Skele uses your own Spotify app so nothing passes through anyone else's servers. It takes about two minutes."
      >
        <ol className="list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
          <li>
            Open the{" "}
            <a href="https://developer.spotify.com/dashboard" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-foreground underline">
              Spotify developer dashboard <ExternalLink className="size-3" />
            </a>{" "}
            and create an app (choose “Web API”).
          </li>
          <li>
            Add this exact Redirect URI to the app:
            <span className="mt-1 flex items-center gap-2 rounded-md bg-muted px-2 py-1.5 font-mono text-xs text-foreground">
              <span className="min-w-0 flex-1 truncate">{uri}</span>
              <button
                type="button"
                aria-label="Copy redirect URI"
                onClick={async () => {
                  await navigator.clipboard.writeText(uri);
                  toast.success("Copied");
                }}
              >
                <Copy className="size-3.5" />
              </button>
            </span>
          </li>
          <li>Copy the app&apos;s Client ID below. No client secret is needed (Skele uses PKCE).</li>
        </ol>
        <form
          className="mt-4 flex items-end gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await setClientId(clientId ?? "");
              qc.invalidateQueries({ queryKey: spotifyKeys.status });
              setClientIdDraft(null);
              toast.success("Client ID saved");
            } catch (err) {
              toast.error(err instanceof Error ? err.message : "Invalid Client ID");
            }
          }}
        >
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="spotify-client">Client ID</Label>
            <Input
              id="spotify-client"
              placeholder="32 characters"
              autoComplete="off"
              spellCheck={false}
              value={clientId ?? status.data.clientId}
              onChange={(e) => setClientIdDraft(e.target.value)}
              className="font-mono"
            />
          </div>
          <Button type="submit" variant="outline" disabled={clientId === null}>
            Save
          </Button>
        </form>
        <p className="mt-3 text-xs text-muted-foreground">
          Permissions requested: {SPOTIFY_SCOPES.join(", ")}. Skele never sees your Spotify password and doesn&apos;t download or store audio.
          Apps in Spotify&apos;s development mode work for up to 25 users you add in the dashboard.
        </p>
      </SettingsCard>
    </>
  );
}
