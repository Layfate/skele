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
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { routes } from "@/lib/routes";
import { cn } from "@/lib/utils";
import { useCodexModels, useOllamaModels } from "../hooks";
import { listOpenAIModels } from "../providers/openai";
import { providerAvailable } from "../run";
import {
  ANTHROPIC_MODELS,
  CLAUDE_CLI_MODELS,
  CLAUDE_MORE_MODELS,
  CODEX_DEFAULT_MODEL,
  EFFORTS,
  effortFor,
  maxEffort,
  prettyModel,
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

/**
 * A model's name with its version ("Opus 5.5"). `resolved` is the exact model the provider
 * reported, used for "Default" (e.g. Claude Code's configured model).
 */
export function modelLabel(provider: ProviderId, model: string, resolved?: string | null) {
  const lists: Partial<Record<ProviderId, ModelOption[]>> = {
    "claude-cli": [...CLAUDE_CLI_MODELS, ...CLAUDE_MORE_MODELS],
    "codex-cli": [CODEX_DEFAULT_MODEL],
    anthropic: ANTHROPIC_MODELS,
  };
  if (!model && resolved) return prettyModel(resolved);
  const found = lists[provider]?.find((m) => m.id === model);
  if (found) return found.id ? found.label : PROVIDERS[provider].label;
  return prettyModel(model) || PROVIDERS[provider].label;
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

function ModelItem({ m, active, onSelect }: { m: ModelOption; active: boolean; onSelect: () => void }) {
  return (
    <DropdownMenuItem onSelect={onSelect} className="items-start gap-2">
      <Check className={cn("mt-0.5 size-4 shrink-0", !active && "invisible")} />
      <span className="min-w-0">
        <span className="block truncate">{m.label}</span>
        {m.hint && <span className="block text-xs text-muted-foreground">{m.hint}</span>}
      </span>
    </DropdownMenuItem>
  );
}

/** Provider + model picker for the composer. `claudeDefault` is the model Claude Code uses by default. */
export function ProviderMenu({
  settings,
  provider,
  model,
  onChange,
  claudeDefault,
  open,
  onOpenChange,
}: {
  settings: AiSettings;
  provider: ProviderId;
  model: string;
  onChange: (provider: ProviderId, model: string) => void;
  claudeDefault?: string | null;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
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
  const claudeModels = CLAUDE_CLI_MODELS.map((m) =>
    m.id === "" ? { ...m, label: "Default (recommended)", hint: claudeDefault ? `${prettyModel(claudeDefault)} · Claude Code's configured model` : m.hint } : m,
  );
  // A model typed with /model that isn't in the lists still shows as chosen.
  if (provider === "claude-cli" && model && ![...CLAUDE_CLI_MODELS, ...CLAUDE_MORE_MODELS].some((m) => m.id === model)) {
    claudeModels.push({ id: model, label: prettyModel(model), hint: "Chosen with /model" });
  }
  const groups: { id: ProviderId; models: ModelOption[]; more?: ModelOption[] }[] = [
    { id: "claude-cli", models: claudeModels, more: CLAUDE_MORE_MODELS },
    { id: "anthropic", models: ANTHROPIC_MODELS },
    { id: "codex-cli", models: [CODEX_DEFAULT_MODEL, ...(codex.data ?? [])] },
    { id: "openai", models: openaiModels },
    { id: "ollama", models: ollamaModels },
  ];
  const unavailable = groups.filter((g) => !providerAvailable(g.id, settings));
  const current = modelLabel(provider, model, provider === "claude-cli" ? claudeDefault : undefined);

  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title="Model (/model)"
          className="flex h-8 max-w-60 items-center gap-1.5 rounded-lg px-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground data-[state=open]:bg-accent"
        >
          <ProviderIcon provider={provider} className="size-5" />
          <span className="truncate">
            {PROVIDERS[provider].kind === "cli" ? (
              <>
                <span className="hidden @xl:inline">{PROVIDERS[provider].label} · </span>
                {current === PROVIDERS[provider].label ? PROVIDERS[provider].label : current}
              </>
            ) : (
              `${PROVIDERS[provider].label} · ${current.replace(/^Claude /, "")}`
            )}
          </span>
          <ChevronDown className="size-3.5 shrink-0" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        collisionPadding={8}
        className="max-h-[min(70vh,var(--radix-dropdown-menu-content-available-height))] w-80 overflow-y-auto scrollbar-thin"
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
              {g.models.map((m) => (
                <ModelItem key={m.id || "default"} m={m} active={provider === g.id && model === m.id} onSelect={() => onChange(g.id, m.id)} />
              ))}
              {g.more && (
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger className="gap-2 pl-8 text-muted-foreground">
                    More models
                    {provider === g.id && g.more.some((m) => m.id === model) && <span className="ml-auto text-xs">{prettyModel(model)}</span>}
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="w-52">
                    {g.more.map((m) => (
                      <ModelItem key={m.id} m={m} active={provider === g.id && model === m.id} onSelect={() => onChange(g.id, m.id)} />
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              )}
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

/** Effort picker: a Faster ↔ Smarter scale, like Claude Code's /effort. */
export function EffortMenu({
  provider,
  effort,
  onChange,
  open,
  onOpenChange,
}: {
  provider: ProviderId;
  effort: Effort;
  onChange: (e: Effort) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const max = maxEffort(provider);
  if (!max) return null;
  const last = EFFORTS.findIndex((e) => e.id === max);
  const used = effortFor(provider, effort);
  const index = EFFORTS.findIndex((e) => e.id === used);
  const pick = (i: number) => onChange(EFFORTS[Math.max(0, Math.min(last, i))].id);
  const pos = (i: number) => `${(i / (EFFORTS.length - 1)) * 100}%`;
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title="Effort: how long the model thinks (/effort)"
          className="flex h-8 items-center gap-1.5 rounded-lg px-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground data-[state=open]:bg-accent"
        >
          <Gauge className="size-4" strokeWidth={1.75} />
          <span className="hidden @md:inline">{used}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-80 p-4"
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
            e.preventDefault();
            pick(index + (e.key === "ArrowRight" ? 1 : -1));
          } else if (e.key === "Enter") {
            e.preventDefault();
            onOpenChange?.(false);
          }
        }}
      >
        <p className="text-sm font-medium">Effort</p>
        <div className="mt-3 flex justify-between text-xs font-medium">
          <span>Faster</span>
          <span>Smarter</span>
        </div>
        <div className="relative mx-4 mt-2 h-4" role="radiogroup" aria-label="Effort">
          <div className="absolute inset-x-0 top-1.5 h-px bg-border" />
          <div className="absolute top-1.5 left-0 h-px bg-brand" style={{ width: pos(index) }} />
          {EFFORTS.map((e, i) => (
            <button
              key={e.id}
              type="button"
              role="radio"
              aria-checked={i === index}
              aria-label={e.label}
              disabled={i > last}
              onClick={() => pick(i)}
              style={{ left: pos(i) }}
              className={cn(
                "absolute top-0 size-3.5 -translate-x-1/2 rounded-full border-2 bg-popover transition disabled:opacity-30",
                i === index ? "scale-125 border-brand bg-brand" : i < index ? "border-brand" : "border-muted-foreground/40",
              )}
            />
          ))}
        </div>
        <div className="relative mx-4 mt-1.5 h-5 text-xs">
          {EFFORTS.map((e, i) => (
            <button
              key={e.id}
              type="button"
              disabled={i > last}
              onClick={() => pick(i)}
              style={{ left: pos(i) }}
              className={cn(
                "absolute -translate-x-1/2 rounded px-1 text-muted-foreground hover:text-foreground disabled:opacity-35",
                i === index && "font-semibold text-brand",
              )}
            >
              {e.label}
            </button>
          ))}
        </div>
        <p className="mt-2 text-center text-xs text-muted-foreground">
          {EFFORTS[index].hint}
          {last < EFFORTS.length - 1 && ` · ${PROVIDERS[provider].label} goes up to ${max}`}
        </p>
        <p className="mt-3 border-t pt-2 text-[11px] text-muted-foreground">← → to adjust · Enter to close</p>
      </PopoverContent>
    </Popover>
  );
}
