"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import {
  ExternalLink,
  ListMusic,
  Loader2,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  Search,
  SkipBack,
  SkipForward,
  Speaker,
  Volume2,
  History,
} from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useUI } from "@/stores/ui";
import { pickImage, spotify, SpotifyError, type PlaybackState } from "../api";
import { spotifyKeys, usePlayback, usePlayerDisplay, useSpotifyAction, useSpotifyMe, useSpotifyStatus } from "../hooks";

export function SpotifyLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={cn("size-4 shrink-0", className)} fill="#1DB954">
      <path d="M12 0a12 12 0 1 0 0 24 12 12 0 0 0 0-24Zm5.5 17.3a.75.75 0 0 1-1 .25c-2.86-1.75-6.46-2.15-10.7-1.18a.75.75 0 1 1-.33-1.46c4.64-1.06 8.62-.6 11.8 1.35.36.22.47.69.25 1.04Zm1.47-3.27a.94.94 0 0 1-1.29.31c-3.27-2.01-8.26-2.6-12.13-1.42a.94.94 0 1 1-.55-1.8c4.42-1.34 9.92-.69 13.66 1.62.44.27.58.85.31 1.29Zm.13-3.4C15.18 8.3 8.73 8.08 5 9.21a1.13 1.13 0 1 1-.66-2.16c4.28-1.3 11.4-1.05 15.9 1.62a1.13 1.13 0 0 1-1.15 1.95Z" />
    </svg>
  );
}

const fmt = (ms: number | null | undefined) => {
  if (ms == null) return "0:00";
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** Buttons never take focus from the editor, so music control doesn't interrupt typing. */
function Ctl({ label, onClick, disabled, children, big }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode; big?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cn(
        "flex items-center justify-center rounded-full text-foreground hover:bg-accent disabled:opacity-40 disabled:hover:bg-transparent",
        big ? "size-8 bg-foreground text-background hover:bg-foreground/85" : "size-7",
      )}
    >
      {children}
    </button>
  );
}

/** Interpolates progress between polls so the bar moves smoothly. */
function useProgress(p: PlaybackState | null | undefined, fetchedAt: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!p?.is_playing) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [p?.is_playing]);
  if (!p?.item) return 0;
  const base = p.progress_ms ?? 0;
  return Math.min(p.item.duration_ms, p.is_playing ? base + Math.max(0, now - fetchedAt) : base);
}

function usePlayerState() {
  const status = useSpotifyStatus();
  const connected = !!status.data?.connected;
  const me = useSpotifyMe(connected);
  const playback = usePlayback(connected);
  const action = useSpotifyAction();
  const premium = me.data ? me.data.product === "premium" : true;
  return { connected, playback, action, premium, me };
}

function Transport({ state, size = "sm" }: { state: ReturnType<typeof usePlayerState>; size?: "sm" | "lg" }) {
  const p = state.playback.data;
  const disallow = p?.actions?.disallows ?? {};
  const can = state.premium && !!p?.device;
  return (
    <div className={cn("flex items-center", size === "lg" ? "gap-3" : "gap-1")}>
      <Ctl label="Previous" disabled={!can || disallow.skipping_prev} onClick={() => state.action.mutate(spotify.previous)}>
        <SkipBack className="size-3.5" />
      </Ctl>
      <Ctl
        big
        label={p?.is_playing ? "Pause" : "Play"}
        disabled={!state.premium}
        onClick={() => state.action.mutate(p?.is_playing ? spotify.pause : () => spotify.play())}
      >
        {state.action.isPending ? <Loader2 className="size-3.5 animate-spin" /> : p?.is_playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
      </Ctl>
      <Ctl label="Next" disabled={!can || disallow.skipping_next} onClick={() => state.action.mutate(spotify.next)}>
        <SkipForward className="size-3.5" />
      </Ctl>
    </div>
  );
}

function NowPlaying({ state, compact }: { state: ReturnType<typeof usePlayerState>; compact?: boolean }) {
  const p = state.playback.data;
  const progress = useProgress(p, state.playback.dataUpdatedAt);
  const err = state.playback.error;
  if (err instanceof SpotifyError && err.kind !== "rate-limited") {
    return <p className="text-xs text-muted-foreground">{err.message}</p>;
  }
  if (!p?.item) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <SpotifyLogo />
        <span className="flex-1">Nothing playing. Start music in Spotify on any device.</span>
      </div>
    );
  }
  const art = pickImage(p.item.album.images, compact ? 64 : 300);
  return (
    <div>
      <div className="flex items-center gap-2.5">
        {art && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={art} alt={`${p.item.album.name} cover`} className={cn("shrink-0 rounded", compact ? "size-9" : "size-14")} />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium" title={p.item.name}>
            {p.item.name}
          </p>
          <p className="truncate text-xs text-muted-foreground">{p.item.artists.map((a) => a.name).join(", ")}</p>
        </div>
        {compact && <Transport state={state} />}
      </div>
      <div className="mt-1.5 flex items-center gap-2 text-[10px] text-muted-foreground tabular-nums">
        {!compact && <span>{fmt(progress)}</span>}
        <div
          className="h-1 flex-1 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-label="Playback progress"
          aria-valuenow={Math.round((progress / p.item.duration_ms) * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div className="h-full bg-[#1DB954]" style={{ width: `${(progress / p.item.duration_ms) * 100}%` }} />
        </div>
        {!compact && <span>{fmt(p.item.duration_ms)}</span>}
      </div>
    </div>
  );
}

/** Compact player at the bottom of the sidebar. */
export function SpotifySidebarWidget() {
  const state = usePlayerState();
  const display = usePlayerDisplay();
  const setPanel = useUI((s) => s.setSpotifyPanelOpen);
  if (!state.connected || display.data !== "sidebar") return null;
  return (
    <section aria-label="Spotify" className="group mx-2 mb-1 rounded-lg border bg-background/60 p-2">
      <NowPlaying state={state} compact />
      <div className="mt-1 flex items-center justify-between">
        <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <SpotifyLogo className="size-3" />
          {state.playback.data?.device?.name ?? "Spotify"}
        </span>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setPanel(true)}
          className="flex items-center gap-1 rounded px-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <Maximize2 className="size-3" /> More
        </button>
      </div>
    </section>
  );
}

/** Optional floating mini-player + the expanded panel (rendered once in the shell). */
export function SpotifyFloatingPlayer() {
  const state = usePlayerState();
  const display = usePlayerDisplay();
  const open = useUI((s) => s.spotifyPanelOpen);
  const setOpen = useUI((s) => s.setSpotifyPanelOpen);
  if (!state.connected) return null;
  return (
    <>
      {display.data === "floating" && (
        <aside aria-label="Spotify mini player" className="fixed right-4 bottom-4 z-40 w-72 rounded-xl border bg-popover p-3 shadow-lg">
          <NowPlaying state={state} compact />
          <div className="mt-1 flex justify-end">
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => setOpen(true)} className="flex items-center gap-1 rounded px-1 text-[11px] text-muted-foreground hover:bg-accent">
              <Maximize2 className="size-3" /> Expand
            </button>
          </div>
        </aside>
      )}
      <Sheet open={open} onOpenChange={setOpen} modal={false}>
        <SheetContent side="right" className="gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-sm" onOpenAutoFocus={(e) => e.preventDefault()}>
          <SheetTitle className="sr-only">Spotify</SheetTitle>
          <SheetDescription className="sr-only">Control your Spotify playback</SheetDescription>
          <ExpandedPlayer state={state} onClose={() => setOpen(false)} />
        </SheetContent>
      </Sheet>
    </>
  );
}

function ExpandedPlayer({ state, onClose }: { state: ReturnType<typeof usePlayerState>; onClose: () => void }) {
  const [tab, setTab] = useState<"playlists" | "search" | "recent" | "devices">("playlists");
  const p = state.playback.data;
  const [volume, setVolume] = useState<number | null>(null);
  const supportsVolume = !!p?.device && p.device.volume_percent !== null && p.device.supports_volume !== false;
  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-2 border-b px-4 py-3">
        <SpotifyLogo />
        <span className="flex-1 text-sm font-medium">Spotify</span>
        <button type="button" aria-label="Minimise player" onClick={onClose} className="flex size-7 items-center justify-center rounded-md hover:bg-accent">
          <Minimize2 className="size-4" />
        </button>
      </header>
      <div className="border-b p-4">
        <NowPlaying state={state} />
        <div className="mt-3 flex items-center justify-between">
          <Transport state={state} size="lg" />
          {p?.item && (
            <a href={p.item.external_urls.spotify} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
              Open in Spotify <ExternalLink className="size-3" />
            </a>
          )}
        </div>
        {supportsVolume && state.premium && (
          <label className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
            <Volume2 className="size-4" />
            <input
              type="range"
              min={0}
              max={100}
              value={volume ?? p!.device.volume_percent ?? 50}
              onChange={(e) => setVolume(Number(e.target.value))}
              onMouseUp={() => volume !== null && state.action.mutate(() => spotify.volume(volume))}
              onKeyUp={() => volume !== null && state.action.mutate(() => spotify.volume(volume))}
              aria-label="Volume"
              className="flex-1 accent-[#1DB954]"
            />
          </label>
        )}
        {p?.device && <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground"><Speaker className="size-3.5" /> Playing on {p.device.name}</p>}
        {!state.premium && (
          <p className="mt-3 rounded-md bg-muted px-2.5 py-2 text-xs text-muted-foreground">
            Spotify only allows playback control (play, pause, skip, volume, devices) for Premium accounts. You can still see what&apos;s playing and browse your playlists.
          </p>
        )}
      </div>
      <nav className="flex border-b text-xs" role="tablist">
        {(
          [
            ["playlists", ListMusic, "Playlists"],
            ["search", Search, "Search"],
            ["recent", History, "Recent"],
            ["devices", Speaker, "Devices"],
          ] as const
        ).map(([id, Icon, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={cn("flex flex-1 items-center justify-center gap-1 py-2 text-muted-foreground hover:text-foreground", tab === id && "border-b-2 border-foreground text-foreground")}
          >
            <Icon className="size-3.5" /> {label}
          </button>
        ))}
      </nav>
      <div className="min-h-0 flex-1 overflow-y-auto p-2 scrollbar-thin">
        {tab === "playlists" && <Playlists state={state} />}
        {tab === "search" && <SearchTab state={state} />}
        {tab === "recent" && <Recent state={state} />}
        {tab === "devices" && <Devices state={state} />}
      </div>
    </div>
  );
}

function Row({ image, title, subtitle, onClick, disabled }: { image: string | null; title: string; subtitle?: string; onClick?: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-accent disabled:hover:bg-transparent"
    >
      {image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={image} alt="" className="size-9 shrink-0 rounded" />
      ) : (
        <span className="flex size-9 shrink-0 items-center justify-center rounded bg-muted">
          <ListMusic className="size-4 text-muted-foreground" />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm">{title}</span>
        {subtitle && <span className="block truncate text-xs text-muted-foreground">{subtitle}</span>}
      </span>
    </button>
  );
}

function Loading() {
  return (
    <div className="space-y-2 p-2">
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} className="h-10" />
      ))}
    </div>
  );
}

function ErrorNote({ error }: { error: unknown }) {
  return <p className="p-3 text-sm text-muted-foreground">{error instanceof Error ? error.message : "Couldn't load from Spotify."}</p>;
}

function Playlists({ state }: { state: ReturnType<typeof usePlayerState> }) {
  const list = useQuery({ queryKey: spotifyKeys.playlists, queryFn: spotify.playlists, retry: false });
  if (list.error) return <ErrorNote error={list.error} />;
  if (!list.data) return <Loading />;
  if (!list.data.length) return <p className="p-3 text-sm text-muted-foreground">No playlists yet.</p>;
  return (
    <>
      {list.data.filter(Boolean).map((pl) => (
        <Row
          key={pl.id}
          image={pickImage(pl.images)}
          title={pl.name}
          subtitle={`${pl.tracks.total} tracks · ${pl.owner.display_name}`}
          disabled={!state.premium}
          onClick={() => state.action.mutate(() => spotify.play({ context_uri: pl.uri }))}
        />
      ))}
    </>
  );
}

function SearchTab({ state }: { state: ReturnType<typeof usePlayerState> }) {
  const [query, setQuery] = useState("");
  const [term, setTerm] = useState("");
  const results = useQuery({ queryKey: ["spotify", "search", term], queryFn: () => spotify.search(term), enabled: term.length > 1, retry: false });
  return (
    <div>
      <form
        className="p-1"
        onSubmit={(e) => {
          e.preventDefault();
          setTerm(query.trim());
        }}
      >
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search songs and playlists"
          aria-label="Search Spotify"
          className="h-8 w-full rounded-md border bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring"
        />
      </form>
      {results.error && <ErrorNote error={results.error} />}
      {results.isFetching && <Loading />}
      {results.data && (
        <>
          {results.data.tracks.items.map((t) => (
            <Row
              key={t.id}
              image={pickImage(t.album.images)}
              title={t.name}
              subtitle={t.artists.map((a) => a.name).join(", ")}
              disabled={!state.premium}
              onClick={() => state.action.mutate(() => spotify.play({ uris: [t.uri] }))}
            />
          ))}
          {results.data.playlists.items
            .filter((pl): pl is NonNullable<typeof pl> => !!pl)
            .map((pl) => (
              <Row
                key={pl.id}
                image={pickImage(pl.images)}
                title={pl.name}
                subtitle="Playlist"
                disabled={!state.premium}
                onClick={() => state.action.mutate(() => spotify.play({ context_uri: pl.uri }))}
              />
            ))}
        </>
      )}
    </div>
  );
}

function Recent({ state }: { state: ReturnType<typeof usePlayerState> }) {
  const recent = useQuery({ queryKey: spotifyKeys.recent, queryFn: spotify.recentlyPlayed, retry: false });
  if (recent.error) return <ErrorNote error={recent.error} />;
  if (!recent.data) return <Loading />;
  return (
    <>
      {recent.data.map(({ track, played_at }) => (
        <Row
          key={`${track.id}-${played_at}`}
          image={pickImage(track.album.images)}
          title={track.name}
          subtitle={track.artists.map((a) => a.name).join(", ")}
          disabled={!state.premium}
          onClick={() => state.action.mutate(() => spotify.play({ uris: [track.uri] }))}
        />
      ))}
    </>
  );
}

function Devices({ state }: { state: ReturnType<typeof usePlayerState> }) {
  const devices = useQuery({ queryKey: spotifyKeys.devices, queryFn: spotify.devices, retry: false, refetchInterval: 10_000 });
  if (devices.error) return <ErrorNote error={devices.error} />;
  if (!devices.data) return <Loading />;
  if (!devices.data.length) return <p className="p-3 text-sm text-muted-foreground">No devices found. Open Spotify on your phone, computer or speaker.</p>;
  return (
    <>
      {devices.data.map((d) => (
        <button
          key={d.id ?? d.name}
          type="button"
          disabled={!d.id || d.is_restricted || !state.premium || d.is_active}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => d.id && state.action.mutate(() => spotify.transfer(d.id!))}
          className="flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left text-sm hover:bg-accent disabled:hover:bg-transparent"
        >
          <Speaker className={cn("size-4", d.is_active ? "text-[#1DB954]" : "text-muted-foreground")} />
          <span className="flex-1 truncate">{d.name}</span>
          <span className="text-xs text-muted-foreground">{d.is_active ? "Playing" : d.is_restricted ? "Can't control" : d.type}</span>
        </button>
      ))}
    </>
  );
}

