"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Check, ChevronDown, Gauge, Settings2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { routes } from "@/lib/routes";
import { cn } from "@/lib/utils";
import { useCodexModels, useOllamaModels } from "../hooks";
import { listOpenAIModels } from "../providers/openai";
import { providerAvailable } from "../run";
import {
  ANTHROPIC_MODELS,
  CLAUDE_CLI_MODELS,
  CODEX_DEFAULT_MODEL,
  PROVIDERS,
  type AiSettings,
  type Effort,
  type ModelOption,
  type ProviderId,
} from "../types";
import { BrandMark, type BrandLogo } from "./brand-logos";

const PROVIDER_LOGOS: Record<ProviderId, BrandLogo> = {
  "claude-cli": "claude",
  anthropic: "claude",
  "codex-cli": "codex",
  openai: "openai",
  ollama: "ollama",
};

export function ProviderIcon({ provider, className }: { provider: ProviderId; className?: string }) {
  const family = PROVIDERS[provider].family;
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-6 shrink-0 items-center justify-center rounded-md",
        family === "claude" ? "bg-[#d97757]/15 text-[#d97757]" : "bg-foreground/8 text-foreground",
        className,
      )}
    >
      <BrandMark logo={PROVIDER_LOGOS[provider]} className="size-3.5" />
    </span>
  );
}

export function modelLabel(provider: ProviderId, model: string) {
  const lists: Partial<Record<ProviderId, ModelOption[]>> = {
    "claude-cli": CLAUDE_CLI_MODELS,
    "codex-cli": [CODEX_DEFAULT_MODEL],
    anthropic: ANTHROPIC_MODELS,
  };
  const found = lists[provider]?.find((m) => m.id === model);
  if (found) return found.id ? found.label : PROVIDERS[provider].label;
  return model || PROVIDERS[provider].label;
}

export function useOpenAIModels(settings: AiSettings | undefined) {
  return useQuery({
    queryKey: ["openai-models", settings?.openaiKey ? settings.openaiKey.slice(-6) : ""],
    queryFn: () => listOpenAIModels(settings!.openaiKey),
    enabled: !!settings?.openaiKey,
    staleTime: 60 * 60_000,
    retry: false,
  });
}

/** Provider + model picker for the composer. */
export function ProviderMenu({
  settings,
  provider,
  model,
  onChange,
}: {
  settings: AiSettings;
  provider: ProviderId;
  model: string;
  onChange: (provider: ProviderId, model: string) => void;
}) {
  const openai = useOpenAIModels(settings);
  const openaiModels: ModelOption[] = (openai.data ?? []).slice(0, 14).map((id) => ({ id, label: id }));
  if (settings.openaiModel && !openaiModels.some((m) => m.id === settings.openaiModel)) {
    openaiModels.unshift({ id: settings.openaiModel, label: settings.openaiModel });
  }
  const codex = useCodexModels(providerAvailable("codex-cli", settings));
  const ollama = useOllamaModels(settings, !!settings.ollamaModel);
  const ollamaModels: ModelOption[] = (ollama.data ?? []).map((m) => ({ id: m.name, label: m.name, hint: m.details?.parameter_size }));
  if (settings.ollamaModel && !ollamaModels.some((m) => m.id === settings.ollamaModel)) {
    ollamaModels.unshift({ id: settings.ollamaModel, label: settings.ollamaModel, hint: ollama.isError ? "Ollama isn't running" : undefined });
  }
  const groups: { id: ProviderId; models: ModelOption[] }[] = [
    { id: "claude-cli", models: CLAUDE_CLI_MODELS },
    { id: "anthropic", models: ANTHROPIC_MODELS },
    { id: "codex-cli", models: [CODEX_DEFAULT_MODEL, ...(codex.data ?? [])] },
    { id: "openai", models: openaiModels },
    { id: "ollama", models: ollamaModels },
  ];
  const unavailable = groups.filter((g) => !providerAvailable(g.id, settings));

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex h-8 max-w-56 items-center gap-1.5 rounded-lg px-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground data-[state=open]:bg-accent"
        >
          <ProviderIcon provider={provider} className="size-5" />
          <span className="truncate">
            {PROVIDERS[provider].label}
            {model && PROVIDERS[provider].kind === "cli" ? ` · ${modelLabel(provider, model)}` : ""}
            {PROVIDERS[provider].kind !== "cli" ? ` · ${modelLabel(provider, model).replace(/^Claude /, "")}` : ""}
          </span>
          <ChevronDown className="size-3.5 shrink-0" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        collisionPadding={8}
        className="max-h-[min(70vh,var(--radix-dropdown-menu-content-available-height))] w-72 overflow-y-auto scrollbar-thin"
      >
        {groups
          .filter((g) => providerAvailable(g.id, settings))
          .map((g, i) => (
            <div key={g.id}>
              {i > 0 && <DropdownMenuSeparator />}
              <DropdownMenuLabel className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <ProviderIcon provider={g.id} className="size-4 rounded [&_svg]:size-2.5" />
                {PROVIDERS[g.id].label}
                {PROVIDERS[g.id].kind === "cli" && <span className="ml-auto font-normal">your account</span>}
                {PROVIDERS[g.id].kind === "local" && <span className="ml-auto font-normal">on this computer</span>}
              </DropdownMenuLabel>
              {g.models.length === 0 && (
                <p className="px-2 py-1.5 text-xs text-muted-foreground">{openai.isPending ? "Loading models…" : "No models found for this key."}</p>
              )}
              {g.models.map((m) => {
                const active = provider === g.id && model === m.id;
                return (
                  <DropdownMenuItem key={m.id || "default"} onSelect={() => onChange(g.id, m.id)} className="items-start gap-2">
                    <Check className={cn("mt-0.5 size-4 shrink-0", !active && "invisible")} />
                    <span className="min-w-0">
                      <span className="block truncate">{m.label}</span>
                      {m.hint && <span className="block text-xs text-muted-foreground">{m.hint}</span>}
                    </span>
                  </DropdownMenuItem>
                );
              })}
            </div>
          ))}
        {unavailable.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href={routes.settings("ai")} className="gap-2 text-muted-foreground">
                <Settings2 className="size-4" />
                Set up {unavailable.map((g) => PROVIDERS[g.id].label).join(", ")}
              </Link>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const EFFORTS: { id: Effort; label: string; hint: string }[] = [
  { id: "low", label: "Quick", hint: "Fast answers, less reasoning" },
  { id: "medium", label: "Balanced", hint: "Good for most questions" },
  { id: "high", label: "Thorough", hint: "Thinks longer on hard problems" },
];

export function EffortMenu({ effort, onChange }: { effort: Effort; onChange: (e: Effort) => void }) {
  const current = EFFORTS.find((e) => e.id === effort) ?? EFFORTS[1];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title="How much the model thinks before answering"
          className="flex h-8 items-center gap-1.5 rounded-lg px-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground data-[state=open]:bg-accent"
        >
          <Gauge className="size-4" strokeWidth={1.75} />
          <span className="hidden @md:inline">{current.label}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60">
        <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">Thinking</DropdownMenuLabel>
        {EFFORTS.map((e) => (
          <DropdownMenuItem key={e.id} onSelect={() => onChange(e.id)} className="items-start gap-2">
            <Check className={cn("mt-0.5 size-4 shrink-0", e.id !== effort && "invisible")} />
            <span>
              <span className="block">{e.label}</span>
              <span className="block text-xs text-muted-foreground">{e.hint}</span>
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
