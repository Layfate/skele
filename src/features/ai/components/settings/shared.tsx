"use client";

import { useState, type ReactNode } from "react";
import { CheckCircle2, CircleDashed, Loader2, Monitor, Plus, X, XCircle } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { SettingsCard } from "@/features/settings/components/settings-page";

export function Confirm({
  open,
  title,
  description,
  action,
  destructive = true,
  onConfirm,
  onOpenChange,
}: {
  open: boolean;
  title: string;
  description: ReactNode;
  action: string;
  destructive?: boolean;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div>{description}</div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant={destructive ? "destructive" : "default"} onClick={onConfirm}>
            {action}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export type Tone = "ok" | "bad" | "idle" | "busy";

export function StatusLine({ tone, children, className }: { tone: Tone; children: ReactNode; className?: string }) {
  const Icon = tone === "ok" ? CheckCircle2 : tone === "bad" ? XCircle : tone === "busy" ? Loader2 : CircleDashed;
  return (
    <p className={cn("flex items-start gap-1.5 text-sm", tone === "bad" ? "text-destructive" : "text-muted-foreground", className)}>
      <Icon className={cn("mt-0.5 size-3.5 shrink-0", tone === "ok" && "text-green-600", tone === "busy" && "animate-spin")} />
      <span className="min-w-0 break-words">{children}</span>
    </p>
  );
}

/** Rows of key = value (environment variables, HTTP headers). Values can be masked. */
export function KeyValueEditor({
  value,
  onChange,
  keyPlaceholder,
  valuePlaceholder,
  secret,
  addLabel,
}: {
  value: Record<string, string>;
  onChange: (v: Record<string, string>) => void;
  keyPlaceholder: string;
  valuePlaceholder: string;
  secret?: boolean;
  addLabel: string;
}) {
  // Rows are kept as a list so a half-typed key doesn't merge with another.
  const [rows, setRows] = useState<[string, string][]>(() => Object.entries(value));
  const commit = (next: [string, string][]) => {
    setRows(next);
    onChange(Object.fromEntries(next.filter(([k]) => k.trim()).map(([k, v]) => [k.trim(), v])));
  };
  return (
    <div className="space-y-1.5">
      {rows.map(([k, v], i) => (
        <div key={i} className="flex gap-1.5">
          <Input
            value={k}
            placeholder={keyPlaceholder}
            spellCheck={false}
            aria-label="Name"
            onChange={(e) => commit(rows.map((r, j) => (j === i ? [e.target.value, r[1]] : r)))}
            className="h-8 w-2/5 font-mono text-xs"
          />
          <Input
            value={v}
            type={secret ? "password" : "text"}
            autoComplete="off"
            placeholder={valuePlaceholder}
            spellCheck={false}
            aria-label="Value"
            onChange={(e) => commit(rows.map((r, j) => (j === i ? [r[0], e.target.value] : r)))}
            className="h-8 flex-1 font-mono text-xs"
          />
          <button
            type="button"
            aria-label="Remove"
            onClick={() => commit(rows.filter((_, j) => j !== i))}
            className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => setRows([...rows, ["", ""]])}
        className="flex h-7 items-center gap-1 rounded-md px-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <Plus className="size-3.5" /> {addLabel}
      </button>
    </div>
  );
}

/** Shown in the browser for features that need the desktop app. */
export function DesktopOnly({ what }: { what: string }) {
  return (
    <SettingsCard title="Desktop app only">
      <p className="flex items-start gap-2 text-sm text-muted-foreground">
        <Monitor className="mt-0.5 size-4 shrink-0" />
        {what} work through the Claude Code and Codex apps on your computer, so they&apos;re available in the Skele desktop app.
      </p>
    </SettingsCard>
  );
}

/** Splits a command line into arguments, honouring "double" and 'single' quotes. */
export function splitArgs(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quote: string | null = null;
  let any = false;
  for (const ch of line.trim()) {
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      any = true;
    } else if (/\s/.test(ch)) {
      if (cur || any) out.push(cur);
      cur = "";
      any = false;
    } else cur += ch;
  }
  if (cur || any) out.push(cur);
  return out;
}

export const joinArgs = (args: string[]) => args.map((a) => (a === "" || /[\s"']/.test(a) ? JSON.stringify(a) : a)).join(" ");
