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
import {
  beginConnect,
  cancelConnect,
  DESKTOP_LEGACY_REDIRECT_URI,
  disconnect,
  errorText,
  originProblem,
  redirectUri,
  setClientId,
  SPOTIFY_SCOPES,
  SpotifyAuthError,
  type DesktopSignIn,
} from "../auth";
import { spotifyKeys, useLocalSupported, usePlayerDisplay, useSetPlayerDisplay, useSpotifyMe, useSpotifyStatus, type PlayerDisplay } from "../hooks";
import { SpotifyLogo } from "./spotify-player";

export function SpotifySettings() {
  const qc = useQueryClient();
  const status = useSpotifyStatus();
  const me = useSpotifyMe(!!status.data?.connected);
  const display = usePlayerDisplay();
  const localSupported = !!useLocalSupported().data;
  const setDisplay = useSetPlayerDisplay();
  const [clientId, setClientIdDraft] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [signIn, setSignIn] = useState<DesktopSignIn | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);
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
                      ? localSupported
                        ? "Free account — play, pause and skip work through the Spotify app on this computer; starting playlists needs Premium."
                        : "Free account — you can see what's playing and browse playlists; playback control needs Premium."
                      : me.error
                        ? errorText(me.error, "Spotify didn't return your account details.")
                        : "Checking your account…"}
                </p>
              </>
            ) : (
              <p className="text-muted-foreground">
                Not connected
                {localSupported ? ". Play, pause and skip still work for the Spotify app on this computer, with any account." : ""}
              </p>
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
                setConnectError(null);
                try {
                  if ((await beginConnect({ onWaiting: setSignIn })) === "connected") {
                    setConnecting(false);
                    setSignIn(null);
                    qc.invalidateQueries({ queryKey: ["spotify"] });
                    toast.success("Spotify connected");
                  }
                } catch (e) {
                  setConnecting(false);
                  setSignIn(null);
                  if (e instanceof SpotifyAuthError && e.code === "cancelled") return;
                  const message = errorText(e, "Couldn't start the Spotify sign-in. Please try again.");
                  setConnectError(message);
                  toast.error(message);
                }
              }}
            >
              {connecting && <Loader2 className="animate-spin" />} Connect Spotify
            </Button>
          )}
        </div>
        {problem && !status.data.connected && <p className="mt-3 rounded-md bg-amber-500/10 px-3 py-2 text-sm">{problem}</p>}
        {connectError && !connecting && !status.data.connected && (
          <p role="alert" className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-sm">
            {connectError}
          </p>
        )}
        {connecting && signIn && (
          <div className="mt-3 space-y-2 text-sm">
            {!signIn.browserOpened && (
              <p className="rounded-md bg-amber-500/10 px-3 py-2">
                Your browser didn&apos;t open{signIn.browserError ? ` (${signIn.browserError})` : ""}. Copy the sign-in link and open it in any browser on this
                computer.
              </p>
            )}
            {signIn.portNote && <p className="rounded-md bg-amber-500/10 px-3 py-2">{signIn.portNote}</p>}
            <p className="text-muted-foreground">
              {signIn.browserOpened ? "Browser didn't open? " : ""}
              <button
                type="button"
                className="text-foreground underline"
                onClick={async () => {
                  await navigator.clipboard.writeText(signIn.url);
                  toast.success("Sign-in link copied");
                }}
              >
                Copy sign-in link
              </button>
              . If Spotify says “Invalid redirect URI”, add {uri} to your Spotify app, then try again.
            </p>
          </div>
        )}
      </SettingsCard>

      {(status.data.connected || localSupported) && (
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
            {isDesktop() && (
              <span className="mt-1 block text-xs">
                It has no port number on purpose: Spotify then accepts whichever local port Skele uses. {DESKTOP_LEGACY_REDIRECT_URI} also works if you
                added it before.
              </span>
            )}
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
          Spotify apps in development mode need the app owner to have Spotify Premium, and work for up to 5 Spotify accounts you add under User
          Management (those accounts can be Free or Premium).
        </p>
      </SettingsCard>
    </>
  );
}
