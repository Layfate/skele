"use client";

import { useState, type ReactNode } from "react";
import { AlertCircle, Brain, Check, ChevronRight, Copy, Cpu, FilePlus2, ListTree, Loader2, Pencil, RotateCcw, ShieldAlert } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { PageIcon } from "@/components/common";
import { cn } from "@/lib/utils";
import type { LiveRun } from "../hooks";
import { LogoMark } from "@/components/logo";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { imageSrc } from "../images";
import { effortFor, maxEffort, prettyModel, PROVIDERS, type ChatImage, type ChatMessage, type TurnUsage, type UsageBlock } from "../types";
import { copyText, Markdown } from "./markdown";
import { openRouterName } from "../providers/openrouter";
import { modelLabel, ProviderIcon, useOpenRouterModels } from "./provider-menu";

function Action({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          onClick={onClick}
          className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

function CopyAction({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <Action
      label={done ? "Copied" : "Copy"}
      onClick={async () => {
        if (await copyText(text)) {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        }
      }}
    >
      {done ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
    </Action>
  );
}

function Disclosure({ icon: Icon, label, children, defaultOpen = false }: { icon: typeof Brain; label: string; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="mb-2">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 rounded-md py-0.5 pr-1.5 text-[13px] text-muted-foreground hover:text-foreground"
      >
        <Icon className="size-3.5" />
        {label}
        <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />
      </button>
      {open && <div className="mt-1.5 border-l-2 pl-3 text-[13.5px] leading-6 text-muted-foreground">{children}</div>}
    </div>
  );
}

/** Images sent with a message; click one to see it full size. */
function MessageImages({ images }: { images: ChatImage[] }) {
  const [open, setOpen] = useState<ChatImage | null>(null);
  return (
    <>
      <div className="flex max-w-[85%] flex-wrap justify-end gap-1.5">
        {images.map((img, i) => (
          <button
            key={img.id}
            type="button"
            onClick={() => setOpen(img)}
            aria-label={`View image ${i + 1}`}
            className="overflow-hidden rounded-xl border bg-muted transition hover:opacity-90"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={imageSrc(img)}
              alt={img.name ?? `Image ${i + 1}`}
              className={cn("object-cover", images.length === 1 ? "max-h-64 max-w-80" : "size-24")}
            />
          </button>
        ))}
      </div>
      <Dialog open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent className="max-w-[min(92vw,1100px)] p-2 sm:max-w-[min(92vw,1100px)]">
          <DialogTitle className="sr-only">{open?.name ?? "Image"}</DialogTitle>
          {open && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={imageSrc(open)} alt={open.name ?? "Image"} className="max-h-[85vh] w-full rounded-md object-contain" />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

export function UserMessage({ message, onEdit, editable }: { message: ChatMessage; onEdit: (text: string) => void; editable: boolean }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);
  return (
    <div className="group/msg flex flex-col items-end gap-1.5">
      {message.images && message.images.length > 0 && <MessageImages images={message.images} />}
      {message.pages && (
        <div className="flex max-w-[85%] flex-wrap justify-end gap-1.5">
          {message.pages.map((p) => (
            <span key={p.id} className="flex h-6 max-w-56 items-center gap-1.5 rounded-md border bg-card px-2 text-xs text-muted-foreground">
              <PageIcon icon={p.icon} className="size-3.5 text-[12px]" />
              <span className="truncate">{p.title}</span>
            </span>
          ))}
        </div>
      )}
      {editing ? (
        <div className="w-full max-w-[85%] rounded-2xl border bg-card p-2 shadow-sm">
          <textarea
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (draft.trim()) {
                  setEditing(false);
                  onEdit(draft.trim());
                }
              } else if (e.key === "Escape") setEditing(false);
            }}
            rows={Math.min(10, draft.split("\n").length + 1)}
            className="w-full resize-none bg-transparent px-2 py-1 text-[15px] leading-6 outline-none"
          />
          <div className="flex justify-end gap-1.5">
            <button type="button" onClick={() => setEditing(false)} className="h-7 rounded-md px-3 text-sm hover:bg-accent">
              Cancel
            </button>
            <button
              type="button"
              disabled={!draft.trim()}
              onClick={() => {
                setEditing(false);
                onEdit(draft.trim());
              }}
              className="h-7 rounded-md bg-brand px-3 text-sm text-brand-foreground hover:opacity-90 disabled:opacity-50"
            >
              Send
            </button>
          </div>
        </div>
      ) : (
        message.content && (
          <div className="max-w-[85%] rounded-2xl rounded-br-md bg-muted px-4 py-2.5 text-[15px] leading-6 whitespace-pre-wrap break-words">
            {message.content}
          </div>
        )
      )}
      {!editing && (
        <div className="flex gap-0.5 opacity-0 transition-opacity group-hover/msg:opacity-100 focus-within:opacity-100">
          <CopyAction text={message.content} />
          {editable && (
            <Action
              label="Edit"
              onClick={() => {
                setDraft(message.content);
                setEditing(true);
              }}
            >
              <Pencil className="size-3.5" />
            </Action>
          )}
        </div>
      )}
    </div>
  );
}

export function AssistantMessage({
  message,
  live,
  showThinking,
  isLast,
  onRegenerate,
  onSaveAsPage,
  claudeDefault,
}: {
  message?: ChatMessage;
  live?: LiveRun;
  /** Claude Code's default model, for replies that used it without saying which it was. */
  claudeDefault?: string | null;
  showThinking: boolean;
  isLast?: boolean;
  onRegenerate?: () => void;
  onSaveAsPage?: (text: string) => void;
}) {
  const provider = message?.provider ?? live?.provider ?? "claude-cli";
  const model = message?.model ?? live?.model ?? "";
  const text = message?.content ?? live?.text ?? "";
  const thinking = message?.thinking ?? live?.thinking ?? "";
  const activity = message?.activity ?? live?.activity ?? [];
  const agentName = message?.agentName ?? live?.agentName;
  const streaming = !!live;
  const local = !!(message?.local ?? live?.local);
  // Re-renders with OpenRouter's readable names once its model list has loaded.
  useOpenRouterModels(provider === "openrouter");
  const modelName =
    provider === "openrouter" && (message?.modelId || model)
      ? openRouterName(message?.modelId || model, true)
      : message?.modelId
    ? prettyModel(message.modelId)
    : model
      ? modelLabel(provider, model).replace(/^Claude /, "")
      : provider === "claude-cli" && claudeDefault && !message
        ? prettyModel(claudeDefault)
        : "";
  const effort = message?.effort && maxEffort(provider) ? effortFor(provider, message.effort) : undefined;

  return (
    <div className="group/msg flex gap-3">
      {local ? (
        <span aria-hidden className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-foreground/8">
          <LogoMark className="size-5" />
        </span>
      ) : (
        <ProviderIcon provider={provider} className="mt-0.5 size-7 rounded-lg [&_svg]:size-4" />
      )}
      <div className="min-w-0 flex-1">
        <p className="mb-1 flex items-center gap-1.5 text-[13px] text-muted-foreground">
          <span className="font-medium text-foreground/90">{local ? "Skele" : agentName ? `@${agentName}` : PROVIDERS[provider].short}</span>
          {!local && agentName && <span>· {PROVIDERS[provider].short}</span>}
          {!local && modelName && <span className="truncate">· {modelName}</span>}
          {!local && effort && <span className="shrink-0" title="Effort">· {effort}</span>}
        </p>
        {message?.fallback && (
          <p className="mb-2 flex items-center gap-1.5 text-[13px] text-muted-foreground">
            <Cpu className="size-3.5 shrink-0" />
            {message.fallback.reason} Answered by the local model instead.
          </p>
        )}
        {live?.status && !text && (
          <p className="mb-2 flex items-center gap-1.5 text-[13px] text-muted-foreground">
            <Loader2 className="size-3.5 shrink-0 animate-spin" />
            {live.status}
          </p>
        )}
        {showThinking && thinking.trim() && (
          <Disclosure icon={Brain} label={streaming && !text ? "Thinking…" : "Reasoning"} defaultOpen={streaming && !text}>
            <Markdown text={thinking} className="text-[13.5px] [&_p]:leading-6" />
          </Disclosure>
        )}
        {activity.length > 0 && (
          <Disclosure icon={ListTree} label={`${activity.length} step${activity.length === 1 ? "" : "s"}`}>
            <ul className="space-y-1">
              {activity.map((a, i) => (
                <li key={i}>
                  <Markdown text={a} className="text-[13px]" />
                </li>
              ))}
            </ul>
          </Disclosure>
        )}
        {message?.card?.kind === "usage" ? (
          <>
            <UsageCard blocks={message.card.blocks} />
            {message.card.notes?.map((n) => (
              <p key={n} className="mt-2 text-sm text-muted-foreground">
                {n}
              </p>
            ))}
          </>
        ) : text ? (
          <Markdown text={text} />
        ) : streaming ? (
          <TypingDots />
        ) : null}
        {streaming && text && <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse rounded-sm bg-foreground/50 align-text-bottom" />}
        {message?.stopped && <p className="mt-2 text-[13px] text-muted-foreground italic">Stopped.</p>}
        {message?.denied && message.denied.length > 0 && (
          <div className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm">
            <p className="flex items-center gap-1.5 font-medium text-amber-800 dark:text-amber-300">
              <ShieldAlert className="size-4 shrink-0" />
              Not allowed in this chat
            </p>
            <ul className="mt-1 space-y-0.5 text-muted-foreground">
              {message.denied.slice(0, 6).map((d, i) => (
                <li key={i}>
                  <Markdown text={d} className="text-[13px]" />
                </li>
              ))}
            </ul>
            <p className="mt-1 text-xs text-muted-foreground">Allow more with the shield button below the message box.</p>
          </div>
        )}
        {message?.error && (
          <div className="mt-2 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            <p className="min-w-0 whitespace-pre-wrap">{message.error}</p>
          </div>
        )}
        {message && (
          <div className={cn("mt-1.5 -ml-1.5 flex gap-0.5 transition-opacity", !isLast && "opacity-0 group-hover/msg:opacity-100 focus-within:opacity-100")}>
            {text && <CopyAction text={text} />}
            {isLast && onRegenerate && !local && (
              <Action label={message.error ? "Try again" : "Regenerate"} onClick={onRegenerate}>
                <RotateCcw className="size-3.5" />
              </Action>
            )}
            {text && onSaveAsPage && !local && (
              <Action label="Save as page" onClick={() => onSaveAsPage(text)}>
                <FilePlus2 className="size-3.5" />
              </Action>
            )}
            {message.usage && <UsageNote usage={message.usage} />}
          </div>
        )}
      </div>
    </div>
  );
}

const compact = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

function UsageNote({ usage }: { usage: TurnUsage }) {
  const parts = [`${compact(usage.inputTokens)} in`, `${compact(usage.outputTokens)} out`];
  if (usage.cachedTokens) parts.push(`${compact(usage.cachedTokens)} cached`);
  const cost = usage.costUsd ? ` · $${usage.costUsd < 0.01 ? usage.costUsd.toFixed(4) : usage.costUsd.toFixed(2)}` : "";
  return (
    <span
      className="ml-1 self-center text-xs text-muted-foreground/80 tabular-nums"
      title={usage.costUsd ? "Tokens for this reply. The cost is what it would be at API prices; plans include it." : "Tokens for this reply"}
    >
      {parts.join(" · ")}
      {cost}
    </span>
  );
}

function resetLabel(seconds: number) {
  const d = new Date(seconds * 1000);
  const ms = d.getTime() - Date.now();
  if (ms <= 0) return "resets now";
  const mins = Math.round(ms / 60_000);
  if (mins < 60) return `resets in ${mins} min`;
  if (mins < 24 * 60) return `resets in ${Math.floor(mins / 60)} h ${mins % 60} min`;
  return `resets ${d.toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}`;
}

export function UsageCard({ blocks }: { blocks: UsageBlock[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {blocks.map((b) => (
        <div key={b.tool} className="rounded-xl border bg-card p-4">
          <p className="flex items-baseline justify-between gap-2">
            <span className="font-medium">{b.tool}</span>
            {b.plan && <span className="rounded-md bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">{b.plan} plan</span>}
          </p>
          <div className="mt-3 space-y-3">
            {b.windows.map((w) => {
              const used = Math.max(0, Math.min(100, w.usedPercent));
              return (
                <div key={w.label}>
                  <div className="flex items-baseline justify-between gap-2 text-sm">
                    <span>{w.label}</span>
                    <span className="font-medium tabular-nums">{Math.round(used)}% used</span>
                  </div>
                  <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted" role="meter" aria-valuenow={Math.round(used)} aria-valuemin={0} aria-valuemax={100} aria-label={`${b.tool} ${w.label}`}>
                    <div
                      className={cn("h-full rounded-full", used >= 90 ? "bg-destructive" : used >= 70 ? "bg-amber-500" : "bg-brand")}
                      style={{ width: `${used}%` }}
                    />
                  </div>
                  {w.resetsAt && <p className="mt-1 text-xs text-muted-foreground">{resetLabel(w.resetsAt)}</p>}
                </div>
              );
            })}
          </div>
          {(b.note || b.asOf) && (
            <p className="mt-3 text-xs text-muted-foreground">
              {b.note}
              {b.note && b.asOf ? " " : ""}
              {b.asOf && `As of ${new Date(b.asOf).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}.`}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

function TypingDots() {
  return (
    <span className="flex h-7 items-center gap-1" aria-label="Writing">
      {[0, 150, 300].map((d) => (
        <span key={d} className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60" style={{ animationDelay: `${d}ms` }} />
      ))}
    </span>
  );
}
