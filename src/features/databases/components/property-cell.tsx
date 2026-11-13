"use client";

import { format, parseISO } from "date-fns";
import { useState, type ReactNode } from "react";
import { Check, Plus, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Checkbox } from "@/components/ui/checkbox";
import { colorHex, COLOR_NAMES } from "@/lib/colors";
import { cn } from "@/lib/utils";
import { isSafeUrl } from "@/features/editor/doc";
import type { Property, SelectOption } from "../properties";

export type MemberOption = { id: string; name: string };

export function OptionPill({ option, className }: { option: SelectOption; className?: string }) {
  const hex = colorHex(option.color);
  return (
    <span
      className={cn("inline-flex h-5 max-w-full items-center truncate rounded px-1.5 text-[12.5px] leading-none", className)}
      style={{ background: `${hex}24`, color: `color-mix(in oklch, ${hex} 75%, var(--foreground))` }}
    >
      <span className="truncate">{option.name}</span>
    </span>
  );
}

export function StatusPill({ option }: { option: SelectOption }) {
  const hex = colorHex(option.color);
  return (
    <span
      className="inline-flex h-5 items-center gap-1.5 rounded-full px-2 text-[12.5px] leading-none"
      style={{ background: `${hex}22`, color: `color-mix(in oklch, ${hex} 75%, var(--foreground))` }}
    >
      <span className="size-1.5 rounded-full" style={{ background: hex }} />
      {option.name}
    </span>
  );
}

export function formatNumber(n: number, fmt?: string) {
  if (fmt === "percent") return `${(n * 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}%`;
  if (fmt === "currency") return n.toLocaleString(undefined, { style: "currency", currency: "USD" });
  return n.toLocaleString(undefined, { maximumFractionDigits: 6 });
}

export function formatDate(v: unknown) {
  if (typeof v !== "string" || !v) return "";
  try {
    return format(parseISO(v.slice(0, 10)), "MMM d, yyyy");
  } catch {
    return v;
  }
}

/** Read-only rendering of a property value. */
export function PropertyValue({ prop, value, members }: { prop: Property; value: unknown; members?: MemberOption[] }) {
  if (value === null || value === undefined || value === "" || (Array.isArray(value) && !value.length)) return null;
  const options = prop.config.options ?? [];
  switch (prop.type) {
    case "TEXT":
      return <span className="truncate">{String(value)}</span>;
    case "NUMBER":
      return <span className="tabular-nums">{formatNumber(value as number, prop.config.format)}</span>;
    case "SELECT": {
      const o = options.find((x) => x.id === value);
      return o ? <OptionPill option={o} /> : null;
    }
    case "STATUS": {
      const o = options.find((x) => x.id === value);
      return o ? <StatusPill option={o} /> : null;
    }
    case "MULTI_SELECT":
      return (
        <span className="flex flex-wrap gap-1">
          {(value as string[]).map((id) => {
            const o = options.find((x) => x.id === id);
            return o ? <OptionPill key={id} option={o} /> : null;
          })}
        </span>
      );
    case "CHECKBOX":
      return null;
    case "DATE":
      return <span>{formatDate(value)}</span>;
    case "URL":
      return isSafeUrl(value) ? (
        <a
          href={value}
          target="_blank"
          rel="noopener noreferrer nofollow"
          onClick={(e) => e.stopPropagation()}
          className="truncate underline decoration-foreground/30 underline-offset-2 hover:decoration-brand"
        >
          {value.replace(/^https?:\/\/(www\.)?/, "")}
        </a>
      ) : null;
    case "EMAIL":
      return (
        <a href={`mailto:${String(value)}`} onClick={(e) => e.stopPropagation()} className="truncate underline decoration-foreground/30 underline-offset-2">
          {String(value)}
        </a>
      );
    case "PERSON": {
      const m = members?.find((x) => x.id === value);
      return m ? <PersonChip name={m.name} /> : <span className="text-muted-foreground">Former member</span>;
    }
  }
}

export function PersonChip({ name }: { name: string }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-brand-soft text-[10px] font-semibold text-brand">
        {name.charAt(0).toUpperCase()}
      </span>
      <span className="truncate">{name}</span>
    </span>
  );
}

/**
 * An editable cell: shows the value, opens the right editor on click.
 * `onCreateOption` adds a new select option to the property (returns its id).
 */
export function PropertyCell({
  prop,
  value,
  editable,
  onChange,
  onCreateOption,
  members,
  className,
  placeholder = "",
}: {
  prop: Property;
  value: unknown;
  editable: boolean;
  onChange: (value: unknown) => void;
  onCreateOption?: (name: string) => string;
  members?: MemberOption[];
  className?: string;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const base = cn("flex min-h-8 w-full min-w-0 items-center px-2 text-left text-sm", className);

  if (prop.type === "CHECKBOX") {
    return (
      <div className={base}>
        <Checkbox
          checked={value === true}
          disabled={!editable}
          onCheckedChange={(v) => onChange(v === true)}
          aria-label={prop.name}
        />
      </div>
    );
  }

  const isEmpty = value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0);
  const display = isEmpty ? null : <PropertyValue prop={prop} value={value} members={members} />;
  if (!editable) return <div className={base}>{display}</div>;

  let editor: ReactNode;
  switch (prop.type) {
    case "TEXT":
    case "URL":
    case "EMAIL":
    case "NUMBER":
      editor = <TextEditor prop={prop} value={value} onCommit={(v) => (onChange(v), setOpen(false))} />;
      break;
    case "SELECT":
    case "STATUS":
    case "MULTI_SELECT":
      editor = (
        <OptionEditor
          prop={prop}
          value={value}
          onChange={(v) => {
            onChange(v);
            if (prop.type !== "MULTI_SELECT") setOpen(false);
          }}
          onCreateOption={prop.type === "STATUS" ? undefined : onCreateOption}
        />
      );
      break;
    case "DATE":
      editor = (
        <div>
          <Calendar
            mode="single"
            selected={typeof value === "string" ? parseISO(value.slice(0, 10)) : undefined}
            onSelect={(d) => {
              onChange(d ? format(d, "yyyy-MM-dd") : null);
              setOpen(false);
            }}
          />
          {value != null && (
            <button
              type="button"
              onClick={() => (onChange(null), setOpen(false))}
              className="w-full border-t px-3 py-2 text-left text-sm text-muted-foreground hover:bg-accent"
            >
              Clear date
            </button>
          )}
        </div>
      );
      break;
    case "PERSON":
      editor = <PersonEditor value={value as string | null} members={members ?? []} onPick={(v) => (onChange(v), setOpen(false))} />;
      break;
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className={cn(base, "rounded-sm hover:bg-accent/60 focus-visible:bg-accent/60 focus-visible:outline-none")}>
          {display ?? <span className="text-muted-foreground/70">{placeholder}</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className={cn("p-0", prop.type === "DATE" ? "w-auto" : "w-64")}>
        {editor}
      </PopoverContent>
    </Popover>
  );
}

function TextEditor({ prop, value, onCommit }: { prop: Property; value: unknown; onCommit: (v: unknown) => void }) {
  const [draft, setDraft] = useState(value == null ? "" : String(value));
  const [error, setError] = useState<string | null>(null);
  const commit = () => {
    const v = draft.trim();
    if (!v) return onCommit(null);
    if (prop.type === "NUMBER") {
      const n = Number(v.replace(/,/g, ""));
      if (!Number.isFinite(n)) return setError("Enter a number");
      return onCommit(n);
    }
    if (prop.type === "URL") {
      const url = /^[a-z][a-z0-9+.-]*:/i.test(v) ? v : `https://${v}`;
      if (!isSafeUrl(url)) return setError("Enter a valid http(s) link");
      return onCommit(url);
    }
    if (prop.type === "EMAIL" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return setError("Enter a valid email");
    onCommit(v);
  };
  const multiline = prop.type === "TEXT";
  return (
    <div className="p-1.5">
      {multiline ? (
        <textarea
          autoFocus
          value={draft}
          rows={3}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              commit();
            }
          }}
          onBlur={commit}
          className="w-full resize-none rounded-md bg-transparent p-1.5 text-sm outline-none"
        />
      ) : (
        <input
          autoFocus
          value={draft}
          inputMode={prop.type === "NUMBER" ? "decimal" : undefined}
          type={prop.type === "EMAIL" ? "email" : "text"}
          onChange={(e) => (setDraft(e.target.value), setError(null))}
          onKeyDown={(e) => e.key === "Enter" && commit()}
          onBlur={commit}
          className="h-8 w-full rounded-md bg-transparent px-1.5 text-sm outline-none"
        />
      )}
      {error && <p className="px-1.5 pt-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}

function OptionEditor({
  prop,
  value,
  onChange,
  onCreateOption,
}: {
  prop: Property;
  value: unknown;
  onChange: (v: unknown) => void;
  onCreateOption?: (name: string) => string;
}) {
  const [query, setQuery] = useState("");
  const options = prop.config.options ?? [];
  const multi = prop.type === "MULTI_SELECT";
  const selected = new Set(multi ? ((value as string[] | undefined) ?? []) : value ? [value as string] : []);
  const exact = options.some((o) => o.name.toLowerCase() === query.trim().toLowerCase());

  const toggle = (id: string) => {
    if (multi) {
      const next = new Set(selected);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      onChange([...next]);
    } else {
      onChange(selected.has(id) ? null : id);
    }
  };

  return (
    <Command>
      <CommandInput placeholder={onCreateOption ? "Search or create…" : "Search…"} value={query} onValueChange={setQuery} />
      <CommandList>
        <CommandEmpty>{onCreateOption ? "Type to create an option" : "No options"}</CommandEmpty>
        <CommandGroup>
          {options.map((o) => (
            <CommandItem key={o.id} value={`${o.name} ${o.id}`} onSelect={() => toggle(o.id)}>
              {prop.type === "STATUS" ? <StatusPill option={o} /> : <OptionPill option={o} />}
              {selected.has(o.id) && <Check className="ml-auto" />}
            </CommandItem>
          ))}
          {onCreateOption && query.trim() && !exact && (
            <CommandItem
              value={`__create ${query}`}
              onSelect={() => {
                const id = onCreateOption(query.trim());
                toggle(id);
                setQuery("");
              }}
            >
              <Plus /> Create “{query.trim()}”
            </CommandItem>
          )}
        </CommandGroup>
      </CommandList>
    </Command>
  );
}

function PersonEditor({ value, members, onPick }: { value: string | null; members: MemberOption[]; onPick: (v: string | null) => void }) {
  const [query, setQuery] = useState("");
  const typed = query.trim();
  const exists = members.some((m) => m.name.toLowerCase() === typed.toLowerCase());
  return (
    <Command>
      <CommandInput placeholder="Type a name…" value={query} onValueChange={setQuery} />
      <CommandList>
        <CommandEmpty>Type a name</CommandEmpty>
        <CommandGroup>
          {value != null && (
            <CommandItem value="__clear" onSelect={() => onPick(null)}>
              <X /> Clear
            </CommandItem>
          )}
          {members.map((m) => (
            <CommandItem key={m.id} value={m.name} onSelect={() => onPick(m.id)}>
              <PersonChip name={m.name} />
              {m.id === value && <Check className="ml-auto" />}
            </CommandItem>
          ))}
          {typed && !exists && (
            <CommandItem value={`__new ${typed}`} onSelect={() => onPick(typed.slice(0, 80))}>
              <Plus /> Add “{typed}”
            </CommandItem>
          )}
        </CommandGroup>
      </CommandList>
    </Command>
  );
}

let optionCounter = 0;
/** Builds a new option with a rotating colour. */
export function newOption(name: string, existing: SelectOption[]): SelectOption {
  const palette = COLOR_NAMES.filter((c) => c !== "graphite");
  optionCounter += 1;
  return {
    id: `${Date.now().toString(36)}${optionCounter.toString(36)}`,
    name: name.slice(0, 100),
    color: palette[existing.length % palette.length],
  };
}
