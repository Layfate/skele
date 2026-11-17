"use client";

import { useState } from "react";
import { ArrowRight, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { autocorrectOptions, type AutocorrectOptions } from "@/lib/autocorrect";
import { cn } from "@/lib/utils";
import { usePreferences, useUpdatePreferences } from "../hooks";
import { SettingsCard } from "./settings-page";

function Row({ label, hint, checked, disabled, onChange }: { label: string; hint: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className={cn("flex items-center justify-between gap-4 text-sm", disabled && "opacity-50")}>
      <span>
        <span className="block">{label}</span>
        <span className="block text-xs text-muted-foreground">{hint}</span>
      </span>
      <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} aria-label={label} />
    </label>
  );
}

export function WritingSection() {
  const prefs = usePreferences();
  const update = useUpdatePreferences();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  if (!prefs.data) return <Skeleton className="h-60" />;
  const o = autocorrectOptions(prefs.data.autocorrect);
  const set = (patch: Partial<AutocorrectOptions>) => update.mutate({ autocorrect: { ...o, ...patch } });
  const add = () => {
    const f = from.trim();
    if (!f || !to) return;
    set({ replacements: [...o.replacements.filter((r) => r.from !== f), { from: f, to }] });
    setFrom("");
    setTo("");
  };
  const off = !o.enabled;

  return (
    <>
      <SettingsCard
        title="Autocorrect"
        description="Fixes words as you type, when a word ends (space or punctuation). Press Backspace right after a correction to undo it. Spelling mistakes are still underlined; right-click one for suggestions."
      >
        <div className="space-y-4">
          <Row label="Autocorrect" hint="Turn all of it on or off." checked={o.enabled} onChange={(enabled) => set({ enabled })} />
          <Row
            label="Fix common typos"
            hint="teh → the, recieve → receive, dont → don't, i → I. Only words that are never right as typed."
            checked={o.typos}
            disabled={off}
            onChange={(typos) => set({ typos })}
          />
          <Row
            label="Typographic symbols"
            hint="-> → →, => → ⇒, -- → —, ... → …, != → ≠, (c) → ©. Not at the start of a line, where - and --- are list and divider shortcuts."
            checked={o.symbols}
            disabled={off}
            onChange={(symbols) => set({ symbols })}
          />
          <Row label="Smart quotes" hint={'"Straight" → “curly” quotes and apostrophes.'} checked={o.smartQuotes} disabled={off} onChange={(smartQuotes) => set({ smartQuotes })} />
          <Row
            label="In AI chat messages too"
            hint="Typos and your own shortcuts only, never inside `code`. Symbols and curly quotes stay off there, since messages often hold code."
            checked={o.inChat}
            disabled={off}
            onChange={(inChat) => set({ inChat })}
          />
        </div>
        <p className="mt-4 text-xs text-muted-foreground">Never inside code blocks or inline code.</p>
      </SettingsCard>

      <SettingsCard title="Text shortcuts" description="Type the shortcut, then a space or punctuation, and it's replaced. Works in pages and in AI chat messages.">
        {o.replacements.length > 0 && (
          <ul className="mb-3 divide-y rounded-lg border">
            {o.replacements.map((r) => (
              <li key={r.from} className="flex items-center gap-3 px-3 py-2 text-sm">
                <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{r.from}</code>
                <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{r.to}</span>
                <button
                  type="button"
                  aria-label={`Remove ${r.from}`}
                  onClick={() => set({ replacements: o.replacements.filter((x) => x.from !== r.from) })}
                  className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-destructive"
                >
                  <X className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex gap-2">
          <Input
            value={from}
            onChange={(e) => setFrom(e.target.value.replace(/\s/g, ""))}
            placeholder="omw"
            aria-label="Shortcut"
            spellCheck={false}
            className="h-8 w-32 font-mono text-xs"
            onKeyDown={(e) => e.key === "Enter" && add()}
          />
          <Input
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="on my way"
            aria-label="Replace with"
            className="h-8 flex-1 text-sm"
            onKeyDown={(e) => e.key === "Enter" && add()}
          />
          <Button size="sm" disabled={!from.trim() || !to} onClick={add}>
            <Plus className="size-3.5" /> Add
          </Button>
        </div>
      </SettingsCard>
    </>
  );
}
