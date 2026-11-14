"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Download, ExternalLink, Play, RefreshCw, Square, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { isDesktop } from "@/lib/desktop";
import { errorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";
import { SettingsCard } from "@/features/settings/components/settings-page";
import { aiKeys, useOllamaModels, useUpdateAiSettings } from "../../hooks";
import { deleteOllamaModel, ollamaStatus, pullOllamaModel, startOllama, type PullProgress } from "../../providers/ollama";
import type { AiSettings } from "../../types";
import { Confirm, StatusLine } from "./shared";
import { Toggle } from "./providers";

const SUGGESTED = ["llama3.2", "qwen3", "gemma3", "mistral", "deepseek-r1", "phi4-mini"];
const CONTEXTS = [4096, 8192, 16384, 32768, 65536, 131072];

const size = (bytes?: number) => (!bytes ? "" : bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.round(bytes / 1e6)} MB`);

export function LocalTab({ settings: s }: { settings: AiSettings }) {
  const update = useUpdateAiSettings();
  const qc = useQueryClient();
  const desktop = isDesktop();
  const status = useQuery({
    queryKey: ["ollama-status", s.ollamaUrl, s.ollamaPath],
    queryFn: () => ollamaStatus(s.ollamaUrl, s.ollamaPath),
    refetchInterval: (q) => (q.state.data?.running ? false : 5000),
  });
  const running = !!status.data?.running;
  const models = useOllamaModels(s, running);
  const [starting, setStarting] = useState(false);
  const [toDelete, setToDelete] = useState<string | null>(null);

  const refresh = () => {
    void status.refetch();
    void qc.invalidateQueries({ queryKey: aiKeys.ollamaModels(s.ollamaUrl) });
  };

  const start = async () => {
    setStarting(true);
    try {
      await startOllama(s.ollamaPath);
      // The server takes a moment to come up.
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 500));
        if ((await ollamaStatus(s.ollamaUrl, s.ollamaPath)).running) break;
      }
      refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setStarting(false);
    }
  };

  return (
    <>
      <SettingsCard
        title="Ollama"
        description="Run open models on this computer: private, free, and available offline. Skele uses them like any other provider, and as a fallback when Claude Code or Codex can't answer."
      >
        <div className="space-y-3">
          {status.isPending ? (
            <StatusLine tone="busy">Looking for Ollama…</StatusLine>
          ) : running ? (
            <StatusLine tone="ok">
              Running at {status.data!.url} · version {status.data!.version}
            </StatusLine>
          ) : status.data?.binary ? (
            <div className="flex flex-wrap items-center gap-3">
              <StatusLine tone="idle">Installed but not running.</StatusLine>
              <Button size="sm" onClick={() => void start()} disabled={starting}>
                <Play className="size-3.5" /> {starting ? "Starting…" : "Start Ollama"}
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              <StatusLine tone="idle">
                Not found at {s.ollamaUrl}.{" "}
                {desktop ? "Install Ollama, open it once, then check again." : "Start Ollama on this computer, then check again."}
              </StatusLine>
              <Button variant="outline" size="sm" asChild>
                <a href="https://ollama.com/download" target="_blank" rel="noreferrer noopener">
                  <ExternalLink className="size-3.5" /> Get Ollama
                </a>
              </Button>
              {!desktop && (
                <p className="text-xs text-muted-foreground">
                  In the browser, Ollama must allow this site: start it with <code className="font-mono">OLLAMA_ORIGINS={typeof window !== "undefined" ? window.location.origin : "…"}</code>.
                </p>
              )}
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ollama-url">Address</Label>
              <Input
                id="ollama-url"
                key={s.ollamaUrl}
                defaultValue={s.ollamaUrl}
                spellCheck={false}
                placeholder="http://127.0.0.1:11434"
                onBlur={(e) => {
                  const v = e.target.value.trim() || "http://127.0.0.1:11434";
                  if (v !== s.ollamaUrl) update.mutate({ ollamaUrl: v });
                }}
                className="h-8 font-mono text-xs"
              />
            </div>
            {desktop && (
              <div className="space-y-1.5">
                <Label htmlFor="ollama-path">Program location (optional)</Label>
                <Input
                  id="ollama-path"
                  key={s.ollamaPath}
                  defaultValue={s.ollamaPath}
                  spellCheck={false}
                  placeholder={status.data?.binary ?? "Found automatically"}
                  onBlur={(e) => e.target.value.trim() !== s.ollamaPath && update.mutate({ ollamaPath: e.target.value.trim() })}
                  className="h-8 font-mono text-xs"
                />
              </div>
            )}
          </div>
          <Button variant="outline" size="sm" onClick={refresh} disabled={status.isFetching}>
            <RefreshCw className={cn("size-3.5", status.isFetching && "animate-spin")} /> Check again
          </Button>
        </div>
      </SettingsCard>

      {running && (
        <SettingsCard title="Models" description="Choose the model local chats (and the fallback) use.">
          {models.isPending ? (
            <StatusLine tone="busy">Loading models…</StatusLine>
          ) : models.isError ? (
            <StatusLine tone="bad">{models.error.message}</StatusLine>
          ) : models.data.length === 0 ? (
            <p className="text-sm text-muted-foreground">No models yet. Download one below.</p>
          ) : (
            <div className="divide-y rounded-lg border" role="radiogroup" aria-label="Local model">
              {models.data.map((m) => {
                const active = s.ollamaModel === m.name;
                return (
                  <div key={m.name} className="flex items-center gap-3 px-3 py-2">
                    <button
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => update.mutate({ ollamaModel: m.name })}
                      className="flex min-w-0 flex-1 items-center gap-3 text-left text-sm"
                    >
                      <span className={cn("size-3.5 shrink-0 rounded-full border", active && "border-[5px] border-brand")} />
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{m.name}</span>
                        <span className="block text-xs text-muted-foreground">
                          {[m.details?.parameter_size, m.details?.quantization_level, size(m.size)].filter(Boolean).join(" · ")}
                        </span>
                      </span>
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete ${m.name}`}
                      onClick={() => setToDelete(m.name)}
                      className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-destructive"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
          <PullModel settings={s} onDone={(name) => {
            refresh();
            if (!s.ollamaModel) update.mutate({ ollamaModel: name });
          }} />
          <div className="mt-5 space-y-4">
            <div className="flex items-center justify-between gap-4 text-sm">
              <span>
                <span className="block">Context window</span>
                <span className="block text-xs text-muted-foreground">How much of the conversation the model can see. Larger uses more memory.</span>
              </span>
              <Select value={String(s.ollamaContext)} onValueChange={(v) => update.mutate({ ollamaContext: Number(v) })}>
                <SelectTrigger className="w-28" aria-label="Context window">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CONTEXTS.map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n / 1024}k tokens
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Toggle
              label="Use as fallback"
              hint="Answer with this model when Claude Code, Codex or an API can't (usage limit, offline, signed out)."
              checked={s.localFallback}
              disabled={!s.ollamaModel}
              onChange={(localFallback) => update.mutate({ localFallback })}
            />
          </div>
        </SettingsCard>
      )}

      <Confirm
        open={!!toDelete}
        onOpenChange={(o) => !o && setToDelete(null)}
        title={`Delete ${toDelete}?`}
        description="The model is removed from Ollama on this computer. You can download it again later."
        action="Delete"
        onConfirm={async () => {
          const name = toDelete!;
          setToDelete(null);
          try {
            await deleteOllamaModel(s.ollamaUrl, name);
            if (s.ollamaModel === name) update.mutate({ ollamaModel: "" });
            refresh();
          } catch (e) {
            toast.error(errorMessage(e));
          }
        }}
      />
    </>
  );
}

function PullModel({ settings, onDone }: { settings: AiSettings; onDone: (name: string) => void }) {
  const [name, setName] = useState("");
  const [progress, setProgress] = useState<PullProgress | null>(null);
  const controller = useRef<AbortController | null>(null);

  const pull = async (model: string) => {
    if (!model.trim() || controller.current) return;
    const c = new AbortController();
    controller.current = c;
    setProgress({ status: "Starting…" });
    try {
      await pullOllamaModel(settings.ollamaUrl, model.trim(), setProgress, c.signal);
      if (!c.signal.aborted) {
        toast.success(`Downloaded ${model.trim()}`);
        setName("");
        onDone(model.trim());
      }
    } catch (e) {
      if (!c.signal.aborted) toast.error(errorMessage(e));
    } finally {
      controller.current = null;
      setProgress(null);
    }
  };

  return (
    <div className="mt-4 space-y-2">
      <Label htmlFor="ollama-pull">Download a model</Label>
      <div className="flex gap-2">
        <Input
          id="ollama-pull"
          value={name}
          disabled={!!progress}
          spellCheck={false}
          placeholder="e.g. llama3.2 or qwen3:8b"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void pull(name)}
          className="h-8 font-mono text-xs"
        />
        {progress ? (
          <Button variant="outline" size="sm" onClick={() => controller.current?.abort()}>
            <Square className="size-3 fill-current" /> Stop
          </Button>
        ) : (
          <Button size="sm" onClick={() => void pull(name)} disabled={!name.trim()}>
            <Download className="size-3.5" /> Download
          </Button>
        )}
      </div>
      {progress ? (
        <div className="space-y-1">
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className={cn("h-full rounded-full bg-brand transition-[width]", progress.fraction === undefined && "w-1/3 animate-pulse")}
              style={progress.fraction !== undefined ? { width: `${Math.round(progress.fraction * 100)}%` } : undefined}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {progress.status}
            {progress.fraction !== undefined ? ` · ${Math.round(progress.fraction * 100)}%` : ""}
          </p>
        </div>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {SUGGESTED.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setName(m)}
              className="h-6 rounded-full border px-2.5 font-mono text-xs text-muted-foreground hover:border-brand/40 hover:text-foreground"
            >
              {m}
            </button>
          ))}
          <a href="https://ollama.com/library" target="_blank" rel="noreferrer noopener" className="flex h-6 items-center px-1 text-xs text-brand hover:underline">
            Browse all
          </a>
        </div>
      )}
    </div>
  );
}
