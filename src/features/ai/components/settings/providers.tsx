"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { CheckCircle2, CircleDashed, Eye, EyeOff, Loader2, RefreshCw, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { isDesktop } from "@/lib/desktop";
import { cn } from "@/lib/utils";
import { SettingsCard } from "@/features/settings/components/settings-page";
import { useUpdateAiSettings } from "../../hooks";
import { cliStatus, type CliStatus } from "../../providers/cli";
import { defaultProvider, providerAvailable } from "../../run";
import { PROVIDERS, PROVIDER_IDS, type AiSettings } from "../../types";
import { ProviderIcon, useOpenAIModels } from "../provider-menu";

export function ProvidersTab({ settings: s }: { settings: AiSettings }) {
  const update = useUpdateAiSettings();
  const desktop = isDesktop();
  return (
    <>
      {desktop ? (
        <CliCard settings={s} />
      ) : (
        <SettingsCard title="Claude Code and Codex apps">
          <p className="text-sm text-muted-foreground">
            In the Skele desktop app, chats can use the Claude Code and Codex apps you&apos;re already signed in to, with no API key. In the
            browser, use an API key below or a local model.
          </p>
        </SettingsCard>
      )}
      <SettingsCard
        title="API keys"
        description="Optional. Your keys are stored only on this device, outside your workspaces, and are sent only to Anthropic or OpenAI."
      >
        <div className="space-y-4">
          <KeyField
            id="anthropic-key"
            label="Anthropic API key"
            hint="For Claude models. Create one at console.anthropic.com."
            placeholder="sk-ant-…"
            value={s.anthropicKey}
            onSave={(anthropicKey) => update.mutate({ anthropicKey })}
          />
          <KeyField
            id="openai-key"
            label="OpenAI API key"
            hint="For Codex and GPT models. Create one at platform.openai.com."
            placeholder="sk-…"
            value={s.openaiKey}
            onSave={(openaiKey) => update.mutate({ openaiKey })}
          />
          {s.openaiKey && <OpenAIKeyCheck settings={s} />}
        </div>
      </SettingsCard>
      <SettingsCard title="Default" description="Used for new chats. You can switch for any chat from the message box.">
        <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Default AI">
          {PROVIDER_IDS.map((id) => {
            const available = providerAvailable(id, s);
            const active = defaultProvider(s) === id;
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={!available}
                onClick={() => update.mutate({ defaultProvider: id })}
                className={cn(
                  "flex items-start gap-3 rounded-lg border p-3 text-left text-sm hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent",
                  active && "border-brand ring-1 ring-brand",
                )}
              >
                <ProviderIcon provider={id} className="size-7 rounded-lg [&_svg]:size-4" />
                <span className="min-w-0">
                  <span className="block font-medium">{PROVIDERS[id].label}</span>
                  <span className="block text-xs text-muted-foreground">
                    {available
                      ? PROVIDERS[id].description
                      : PROVIDERS[id].kind === "cli"
                        ? "Desktop app only"
                        : id === "ollama"
                          ? "Choose a model under Local models"
                          : "Add an API key first"}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </SettingsCard>
      <SettingsCard title="When a provider can't answer">
        <div className="space-y-4">
          <Toggle
            label="Answer with the local model instead"
            hint={
              s.ollamaModel
                ? `If Claude Code, Codex or an API is at its usage limit, signed out, offline or not installed, ${s.ollamaModel} answers instead (marked on the reply).`
                : "Choose a model under Local models first."
            }
            checked={s.localFallback}
            disabled={!s.ollamaModel}
            onChange={(localFallback) => update.mutate({ localFallback })}
          />
          <div className="flex items-center justify-between gap-4 text-sm">
            <span>
              <span className="block">Warn when a plan limit is this full</span>
              <span className="block text-xs text-muted-foreground">Shown next to the send button for Claude Code and Codex.</span>
            </span>
            <Select value={String(s.limitWarnPercent)} onValueChange={(v) => update.mutate({ limitWarnPercent: Number(v) })}>
              <SelectTrigger className="w-24" aria-label="Warning threshold">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[50, 75, 80, 90, 95, 101].map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n > 100 ? "Never" : `${n}%`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </SettingsCard>
      <SettingsCard title="Chat">
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="ai-instructions">Custom instructions</Label>
            <Textarea
              id="ai-instructions"
              key={s.instructions}
              defaultValue={s.instructions}
              maxLength={2000}
              rows={3}
              placeholder="e.g. I'm a product designer. Answer briefly and use British spelling."
              onBlur={(e) => e.target.value !== s.instructions && update.mutate({ instructions: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">Added to every chat.</p>
          </div>
          <Toggle
            label="Show reasoning"
            hint="Show a summary of how the model thought about its answer, when it shares one."
            checked={s.showThinking}
            onChange={(showThinking) => update.mutate({ showThinking })}
          />
          <Toggle
            label="Summarize long conversations automatically"
            hint="When a chat no longer fits an API or local model's context window, older messages are summarized first. You can also type /compact."
            checked={s.autoCompact}
            onChange={(autoCompact) => update.mutate({ autoCompact })}
          />
          {desktop && (
            <Toggle
              label="Use Claude Code's and Codex's own extensions"
              hint="Also give chats the MCP servers, plugins and skills you set up in the CLIs themselves, not just the ones turned on in Skele. Their tools still follow each chat's access setting."
              checked={s.useCliExtensions}
              onChange={(useCliExtensions) => update.mutate({ useCliExtensions })}
            />
          )}
        </div>
      </SettingsCard>
      <SettingsCard title="Privacy">
        <p className="text-sm text-muted-foreground">
          Chats are saved on this device and aren&apos;t part of workspace backups. Your messages, and the text of pages you attach, are sent to the
          provider you choose (Anthropic or OpenAI, or your own Ollama server) to get a reply. Nothing is sent until you send a message. Skele never
          reads the CLIs&apos; passwords or tokens: they sign in on their own.
        </p>
      </SettingsCard>
    </>
  );
}

export function Toggle({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className={cn("flex items-center justify-between gap-4 text-sm", disabled && "opacity-60")}>
      <span>
        <span className="block">{label}</span>
        {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
      </span>
      <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </label>
  );
}

function KeyField({
  id,
  label,
  hint,
  placeholder,
  value,
  onSave,
}: {
  id: string;
  label: string;
  hint: string;
  placeholder: string;
  value: string;
  onSave: (v: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [shown, setShown] = useState(false);
  const current = draft ?? value;
  const dirty = draft !== null && draft.trim() !== value;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Input
            id={id}
            type={shown ? "text" : "password"}
            autoComplete="off"
            spellCheck={false}
            value={current}
            placeholder={placeholder}
            onChange={(e) => setDraft(e.target.value)}
            className="pr-9 font-mono text-[13px]"
          />
          <button
            type="button"
            aria-label={shown ? "Hide key" : "Show key"}
            onClick={() => setShown(!shown)}
            className="absolute top-1/2 right-1.5 flex size-6 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:text-foreground"
          >
            {shown ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
          </button>
        </div>
        {dirty ? (
          <Button
            onClick={() => {
              onSave(draft!.trim());
              setDraft(null);
            }}
          >
            Save
          </Button>
        ) : (
          value && (
            <Button
              variant="outline"
              onClick={() => {
                onSave("");
                setDraft(null);
              }}
            >
              Remove
            </Button>
          )
        )}
      </div>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

function OpenAIKeyCheck({ settings }: { settings: AiSettings }) {
  const models = useOpenAIModels(settings);
  if (models.isPending)
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" /> Checking the OpenAI key…
      </p>
    );
  if (models.isError)
    return (
      <p className="flex items-center gap-1.5 text-xs text-destructive">
        <XCircle className="size-3.5" /> Couldn&apos;t list models with this key: {models.error.message}
      </p>
    );
  return (
    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <CheckCircle2 className="size-3.5 text-green-600" /> OpenAI key works · {models.data.length} chat models available
    </p>
  );
}

export function useCliStatus(settings: AiSettings) {
  return useQuery({
    queryKey: ["ai-cli-status", settings.claudePath, settings.codexPath, settings.ollamaPath],
    queryFn: () => cliStatus({ claude: settings.claudePath, codex: settings.codexPath, ollama: settings.ollamaPath }),
    enabled: isDesktop(),
    staleTime: 60_000,
  });
}

function CliCard({ settings }: { settings: AiSettings }) {
  const update = useUpdateAiSettings();
  const status = useCliStatus(settings);
  const rows: { tool: "claude" | "codex"; provider: "claude-cli" | "codex-cli"; pathKey: "claudePath" | "codexPath"; install: string }[] = [
    { tool: "claude", provider: "claude-cli", pathKey: "claudePath", install: "npm install -g @anthropic-ai/claude-code, then run claude once to sign in" },
    { tool: "codex", provider: "codex-cli", pathKey: "codexPath", install: "npm install -g @openai/codex, then run codex once to sign in" },
  ];
  return (
    <SettingsCard
      title="Claude Code and Codex"
      description="Chats can use the Claude Code and Codex apps on this computer with the accounts they're signed in to. No API key needed. By default they only chat; each chat's shield button can let them read or edit files in a folder you choose."
    >
      <div className="divide-y">
        {rows.map((r) => {
          const st: CliStatus | undefined = status.data?.find((x) => x.tool === r.tool);
          return (
            <div key={r.tool} className="space-y-2 py-3 first:pt-0 last:pb-0">
              <div className="flex items-center gap-3">
                <ProviderIcon provider={r.provider} className="size-8 rounded-lg [&_svg]:size-4" />
                <div className="min-w-0 flex-1 text-sm">
                  <p className="font-medium">{PROVIDERS[r.provider].label}</p>
                  {status.isPending ? (
                    <p className="text-muted-foreground">Looking for it…</p>
                  ) : st?.path && st.version ? (
                    <p className="flex items-center gap-1.5 text-muted-foreground">
                      <CheckCircle2 className="size-3.5 shrink-0 text-green-600" />
                      <span className="truncate">{st.version}</span>
                    </p>
                  ) : st?.path ? (
                    <p className="flex items-center gap-1.5 text-destructive">
                      <XCircle className="size-3.5 shrink-0" />
                      <span className="truncate">Found, but it didn&apos;t start: {st.error || "unknown error"}</span>
                    </p>
                  ) : (
                    <p className="flex items-center gap-1.5 text-muted-foreground">
                      <CircleDashed className="size-3.5 shrink-0" /> Not found
                    </p>
                  )}
                </div>
              </div>
              {st?.path && (
                <p className="truncate pl-11 font-mono text-xs text-muted-foreground" title={st.path}>
                  {st.path}
                </p>
              )}
              {!status.isPending && !st?.path && <p className="pl-11 text-xs text-muted-foreground">Install: {r.install}.</p>}
              <div className="flex items-center gap-2 pl-11">
                <Input
                  key={settings[r.pathKey]}
                  defaultValue={settings[r.pathKey]}
                  placeholder="Custom location (optional)"
                  aria-label={`${PROVIDERS[r.provider].label} location`}
                  spellCheck={false}
                  onBlur={(e) => e.target.value.trim() !== settings[r.pathKey] && update.mutate({ [r.pathKey]: e.target.value.trim() })}
                  className="h-8 font-mono text-xs"
                />
              </div>
            </div>
          );
        })}
      </div>
      <Button variant="outline" size="sm" className="mt-4" onClick={() => status.refetch()} disabled={status.isFetching}>
        <RefreshCw className={cn("size-3.5", status.isFetching && "animate-spin")} /> Check again
      </Button>
    </SettingsCard>
  );
}
