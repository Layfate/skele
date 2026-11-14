"use client";

import { useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactNode, type Ref } from "react";
import { ArrowUp, AtSign, FileText, Paperclip, Sparkles, Square, TerminalSquare, X } from "lucide-react";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { PageIcon } from "@/components/common";
import { cn } from "@/lib/utils";
import { usePages } from "@/features/pages/hooks";
import { SLASH_COMMANDS } from "../commands";
import type { Skill } from "../extensions";
import type { Agent, ContextPage } from "../types";

export type ComposerHandle = { focus: () => void; setText: (text: string) => void; openPages: () => void };

type MenuItem = {
  key: string;
  kind: "command" | "skill" | "agent";
  label: string;
  description?: string | null;
  /** Text that replaces the typed token. */
  insert: string;
  /** Send right away (commands without arguments). */
  submit?: boolean;
};

/** The "/word" being typed at the start, or the "@word" just before the caret. */
function menuQuery(text: string, caret: number): { kind: "slash" | "mention"; query: string; start: number } | null {
  const slash = /^\/([a-z0-9:-]*)$/i.exec(text);
  if (slash) return { kind: "slash", query: slash[1].toLowerCase(), start: 0 };
  const before = text.slice(0, caret);
  const at = /(^|\s)@([A-Za-z0-9_-]*)$/.exec(before);
  if (at) return { kind: "mention", query: at[2].toLowerCase(), start: before.length - at[2].length - 1 };
  return null;
}

export function Composer({
  workspaceId,
  running,
  disabled,
  onSend,
  onStop,
  toolbar,
  status,
  skills = [],
  agents = [],
  placeholder = "Message…",
  ref,
}: {
  workspaceId: string;
  running: boolean;
  disabled?: boolean;
  onSend: (text: string, pages: ContextPage[]) => void;
  onStop: () => void;
  toolbar?: ReactNode;
  /** Shown next to the send button (context size, limit warnings). */
  status?: ReactNode;
  /** Skills that "/name" can invoke. */
  skills?: Skill[];
  /** Agents that "@name" can mention. */
  agents?: Agent[];
  placeholder?: string;
  ref?: Ref<ComposerHandle>;
}) {
  const [text, setText] = useState("");
  const [caret, setCaret] = useState(0);
  const [pages, setPages] = useState<ContextPage[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);

  useImperativeHandle(ref, () => ({
    focus: () => area.current?.focus(),
    setText: (t) => {
      setText(t);
      requestAnimationFrame(() => {
        area.current?.focus();
        area.current?.setSelectionRange(t.length, t.length);
      });
    },
    openPages: () => setPickerOpen(true),
  }));

  // Grow with the text, up to a limit.
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 280)}px`;
  }, [text]);

  const canSend = !running && !disabled && (text.trim().length > 0 || pages.length > 0);
  const submit = (override?: string) => {
    if (!canSend && !override) return;
    if (running || disabled) return;
    onSend(override ?? (text.trim() || "Summarize the attached pages."), override ? [] : pages);
    setText("");
    if (!override) setPages([]);
  };

  // Typing "/" lists Skele's commands and skills; "@" lists agents.
  const query = menuQuery(text, caret);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const items = useMemo<MenuItem[]>(() => {
    if (!query) return [];
    const q = query.query;
    if (query.kind === "mention") {
      return agents
        .filter((a) => a.name.toLowerCase().startsWith(q))
        .slice(0, 8)
        .map((a) => ({ key: a.id, kind: "agent", label: `@${a.name}`, description: a.description, insert: `@${a.name} ` }));
    }
    const commands: MenuItem[] = SLASH_COMMANDS.filter((c) => c.name.startsWith(q)).map((c) => ({
      key: `c:${c.name}`,
      kind: "command",
      label: `/${c.name}`,
      description: c.args ? `${c.description} · ${c.args}` : c.description,
      insert: c.args ? `/${c.name} ` : `/${c.name}`,
      submit: !c.args,
    }));
    const seen = new Set<string>();
    const skillItems: MenuItem[] = [];
    for (const sk of skills) {
      if (!sk.name.startsWith(q) || seen.has(sk.name) || skillItems.length >= 12) continue;
      seen.add(sk.name);
      skillItems.push({ key: `s:${sk.name}`, kind: "skill", label: `/${sk.name}`, description: sk.description, insert: `/${sk.name} ` });
    }
    return [...commands, ...skillItems];
  }, [query?.kind, query?.query, agents, skills]); // eslint-disable-line react-hooks/exhaustive-deps
  const menuKey = query ? `${query.kind}:${query.start}` : null;
  const menuOpen = items.length > 0 && menuKey !== dismissed;
  const [highlight, setHighlight] = useState(0);
  const active = Math.min(highlight, Math.max(0, items.length - 1));

  const pick = (item: MenuItem) => {
    if (item.submit) return submit(item.insert);
    const start = query?.start ?? 0;
    const end = query?.kind === "slash" ? text.length : caret;
    const next = text.slice(0, start) + item.insert + text.slice(end);
    const pos = start + item.insert.length;
    setText(next);
    setCaret(pos);
    requestAnimationFrame(() => {
      area.current?.focus();
      area.current?.setSelectionRange(pos, pos);
    });
  };

  return (
    <div
      className={cn(
        "@container relative rounded-2xl border bg-card shadow-sm transition-shadow focus-within:border-brand/50 focus-within:shadow-md focus-within:ring-2 focus-within:ring-brand/15",
        disabled && "opacity-60",
      )}
    >
      {menuOpen && (
        <div
          role="listbox"
          aria-label={query?.kind === "mention" ? "Agents" : "Commands and skills"}
          className="absolute inset-x-0 bottom-full mb-2 max-h-80 overflow-y-auto rounded-xl border bg-popover p-1 shadow-lg scrollbar-thin"
        >
          {items.map((c, i) => {
            const Icon = c.kind === "agent" ? AtSign : c.kind === "skill" ? Sparkles : TerminalSquare;
            return (
              <button
                key={c.key}
                type="button"
                role="option"
                aria-selected={i === active}
                onMouseEnter={() => setHighlight(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(c)}
                className={cn("flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm", i === active && "bg-accent")}
              >
                <Icon className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.75} />
                <span className="shrink-0 font-mono font-medium">{c.label}</span>
                {c.description && <span className="truncate text-muted-foreground">{c.description}</span>}
                {c.kind === "skill" && <span className="ml-auto shrink-0 text-xs text-muted-foreground">skill</span>}
              </button>
            );
          })}
        </div>
      )}
      {pages.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-3 pt-3">
          {pages.map((p) => (
            <span key={p.id} className="flex h-7 max-w-56 items-center gap-1.5 rounded-lg border bg-muted/60 pr-1 pl-2 text-xs">
              <PageIcon icon={p.icon} className="size-3.5 text-[13px]" />
              <span className="truncate">{p.title || "Untitled"}</span>
              <button
                type="button"
                aria-label={`Remove ${p.title || "Untitled"}`}
                onClick={() => setPages(pages.filter((x) => x.id !== p.id))}
                className="flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <textarea
        ref={area}
        value={text}
        rows={1}
        disabled={disabled}
        aria-label="Message"
        placeholder={placeholder}
        onChange={(e) => {
          setText(e.target.value);
          setCaret(e.target.selectionStart ?? e.target.value.length);
          setHighlight(0);
        }}
        onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
        onKeyDown={(e) => {
          if (menuOpen && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
            e.preventDefault();
            setHighlight((active + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length);
          } else if (menuOpen && (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing))) {
            e.preventDefault();
            pick(items[active]);
          } else if (menuOpen && e.key === "Escape") {
            e.preventDefault();
            setDismissed(menuKey);
          } else if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          } else if (e.key === "Escape" && running) {
            e.preventDefault();
            onStop();
          }
        }}
        className="block max-h-[280px] w-full resize-none bg-transparent px-4 pt-3.5 pb-2 text-[15px] leading-6 outline-none placeholder:text-muted-foreground/80 scrollbar-thin"
      />
      <div className="flex items-center gap-0.5 px-2 pb-2">
        <PagePicker
          workspaceId={workspaceId}
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          selected={pages}
          onPick={(p) => {
            setPages((list) => (list.some((x) => x.id === p.id) ? list.filter((x) => x.id !== p.id) : [...list, p]));
          }}
        />
        {toolbar}
        <div className="ml-auto flex items-center gap-2">
          {status}
          <span className="hidden text-xs whitespace-nowrap text-muted-foreground/80 @3xl:inline">
            {running ? "Esc to stop" : "Shift + Enter for a new line"}
          </span>
          {running ? (
            <button
              type="button"
              onClick={onStop}
              aria-label="Stop"
              className="flex size-8 items-center justify-center rounded-full bg-foreground text-background transition hover:opacity-85"
            >
              <Square className="size-3 fill-current" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => submit()}
              disabled={!canSend}
              aria-label="Send"
              className="flex size-8 items-center justify-center rounded-full bg-brand text-brand-foreground transition hover:opacity-90 disabled:bg-muted disabled:text-muted-foreground"
            >
              <ArrowUp className="size-4" strokeWidth={2.25} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function PagePicker({
  workspaceId,
  open,
  onOpenChange,
  selected,
  onPick,
}: {
  workspaceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selected: ContextPage[];
  onPick: (page: ContextPage) => void;
}) {
  const pages = usePages(workspaceId);
  const docs = (pages.data?.pages ?? []).filter((p) => p.kind === "DOCUMENT");
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title="Attach pages"
          aria-label="Attach pages"
          className="flex h-8 items-center gap-1.5 rounded-lg px-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground data-[state=open]:bg-accent"
        >
          <Paperclip className="size-4" strokeWidth={1.75} />
          <span className="hidden @lg:inline">Pages</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-0">
        <Command>
          <CommandInput placeholder="Attach a page…" />
          <CommandList className="max-h-72">
            <CommandEmpty>No pages found.</CommandEmpty>
            {docs.map((p) => {
              const on = selected.some((s) => s.id === p.id);
              return (
                <CommandItem
                  key={p.id}
                  value={`${p.title || "Untitled"} ${p.id}`}
                  onSelect={() => onPick({ id: p.id, title: p.title || "Untitled", icon: p.icon })}
                  className="gap-2"
                >
                  <PageIcon icon={p.icon} kind={p.kind} className="size-4 text-[15px]" />
                  <span className="truncate">{p.title || "Untitled"}</span>
                  {on && <span className="ml-auto text-xs text-brand">Attached</span>}
                </CommandItem>
              );
            })}
          </CommandList>
        </Command>
        <p className="flex items-center gap-1.5 border-t px-3 py-2 text-xs text-muted-foreground">
          <FileText className="size-3.5" />
          The page text is sent with your next message.
        </p>
      </PopoverContent>
    </Popover>
  );
}
