"use client";

import { useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactNode, type Ref } from "react";
import { ArrowUp, AtSign, FileText, ImagePlus, Loader2, Paperclip, Puzzle, Sparkles, Square, TerminalSquare, X } from "lucide-react";
import { toast } from "sonner";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { PageIcon } from "@/components/common";
import { cn } from "@/lib/utils";
import { usePages } from "@/features/pages/hooks";
import { SLASH_COMMANDS } from "../commands";
import type { SkillEntry } from "../extensions";
import { imageSrc, readClipboardImage, toChatImage } from "../images";
import { MAX_CHAT_IMAGES, type Agent, type ChatImage, type ContextPage } from "../types";

/** Commands that open a picker when sent without arguments. */
const PICKER_COMMANDS = new Set(["model", "effort"]);

export type ComposerHandle = { focus: () => void; setText: (text: string) => void; openPages: () => void };

type MenuItem = {
  key: string;
  kind: "command" | "skill" | "plugin" | "agent";
  label: string;
  description?: string | null;
  /** Shown on the right: "skill", "command" or the plugin's name. */
  badge?: string;
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
  onSend: (text: string, pages: ContextPage[], images: ChatImage[]) => void;
  onStop: () => void;
  toolbar?: ReactNode;
  /** Shown next to the send button (context size, limit warnings). */
  status?: ReactNode;
  /** Skills and plugin commands that "/name" can invoke. */
  skills?: SkillEntry[];
  /** Agents that "@name" can mention. */
  agents?: Agent[];
  placeholder?: string;
  ref?: Ref<ComposerHandle>;
}) {
  const [text, setText] = useState("");
  const [caret, setCaret] = useState(0);
  const [pages, setPages] = useState<ContextPage[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [images, setImages] = useState<ChatImage[]>([]);
  const [reading, setReading] = useState(0);
  const area = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  /** Adds pasted or picked images (downscaled), up to the limit. */
  const addImages = async (blobs: Blob[], names: (string | undefined)[] = []) => {
    if (!blobs.length) return;
    const room = MAX_CHAT_IMAGES - images.length;
    if (room <= 0) {
      toast.error(`You can send up to ${MAX_CHAT_IMAGES} images with a message.`);
      return;
    }
    setReading((n) => n + 1);
    try {
      const added: ChatImage[] = [];
      for (const [i, blob] of blobs.slice(0, room).entries()) {
        try {
          added.push(await toChatImage(blob, names[i]));
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "Couldn't add that image.");
        }
      }
      setImages((list) => [...list, ...added].slice(0, MAX_CHAT_IMAGES));
    } finally {
      setReading((n) => n - 1);
    }
  };

  /** Alt+V, and pastes the webview didn't turn into a file: read the system clipboard. */
  const pasteFromClipboard = async (quiet = false) => {
    try {
      const blob = await readClipboardImage();
      if (blob) await addImages([blob]);
      else if (!quiet) toast("There's no image on the clipboard.");
    } catch (e) {
      if (!quiet) toast.error(e instanceof Error ? e.message : "Couldn't read the clipboard.");
    }
  };

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

  const canSend = !running && !disabled && !reading && (text.trim().length > 0 || pages.length > 0 || images.length > 0);
  const submit = (override?: string) => {
    if (!canSend && !override) return;
    if (running || disabled) return;
    if (override) {
      onSend(override, [], []);
    } else {
      onSend(text.trim() || (pages.length ? "Summarize the attached pages." : ""), pages, images);
      setPages([]);
      setImages([]);
    }
    setText("");
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
    const commands: MenuItem[] = SLASH_COMMANDS.filter((c) => c.name.startsWith(q)).map((c) => {
      const picker = PICKER_COMMANDS.has(c.name);
      return {
        key: `c:${c.name}`,
        kind: "command",
        label: `/${c.name}`,
        description: c.description,
        insert: c.args && !picker ? `/${c.name} ` : `/${c.name}`,
        submit: !c.args || picker,
      };
    });
    // Skills match on their whole name or the part after "plugin:", then anywhere in it.
    const rank = (name: string) => {
      const bare = name.slice(name.indexOf(":") + 1);
      if (name.toLowerCase().startsWith(q) || bare.toLowerCase().startsWith(q)) return 0;
      return name.toLowerCase().includes(q) ? 1 : -1;
    };
    const skillItems: MenuItem[] = skills
      .map((sk) => ({ sk, r: rank(sk.name) }))
      .filter((x) => x.r >= 0)
      .sort((a, b) => a.r - b.r)
      .slice(0, 40)
      .map(({ sk }) => ({
        key: `s:${sk.name}`,
        kind: sk.plugin ? "plugin" : "skill",
        label: `/${sk.name}`,
        description: sk.description,
        badge: sk.plugin ?? sk.kind,
        insert: `/${sk.name} `,
      }));
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
          aria-label={query?.kind === "mention" ? "Agents" : "Commands, skills and plugins"}
          className="absolute inset-x-0 bottom-full mb-2 max-h-80 overflow-y-auto rounded-xl border bg-popover p-1 shadow-lg scrollbar-thin"
        >
          {items.map((c, i) => {
            const Icon = c.kind === "agent" ? AtSign : c.kind === "plugin" ? Puzzle : c.kind === "skill" ? Sparkles : TerminalSquare;
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
                {c.description && <span className="min-w-0 truncate text-muted-foreground">{c.description}</span>}
                {c.badge && <span className="ml-auto max-w-40 shrink-0 truncate pl-2 text-xs text-muted-foreground">{c.badge}</span>}
              </button>
            );
          })}
        </div>
      )}
      {(images.length > 0 || reading > 0) && (
        <div className="flex flex-wrap gap-2 px-3 pt-3" aria-label="Images to send">
          {images.map((img, i) => (
            <span key={img.id} className="group/img relative size-16 overflow-hidden rounded-lg border bg-muted">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={imageSrc(img)} alt={img.name ?? `Image ${i + 1}`} className="size-full object-cover" />
              <button
                type="button"
                aria-label={`Remove image ${i + 1}`}
                onClick={() => setImages(images.filter((x) => x.id !== img.id))}
                className="absolute top-1 right-1 flex size-5 items-center justify-center rounded-full bg-background/90 text-foreground shadow-sm opacity-0 group-hover/img:opacity-100 focus-visible:opacity-100"
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
          {reading > 0 && (
            <span className="flex size-16 items-center justify-center rounded-lg border bg-muted text-muted-foreground" aria-label="Adding image">
              <Loader2 className="size-4 animate-spin" />
            </span>
          )}
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
        onPaste={(e) => {
          const data = e.clipboardData;
          const files = [...data.files].filter((f) => f.type.startsWith("image/"));
          if (files.length) {
            e.preventDefault();
            void addImages(files, files.map((f) => f.name));
            return;
          }
          // A bitmap or a copied image file the webview didn't hand over as a file.
          if (!data.types.includes("text/plain") && !data.types.includes("text/html")) {
            e.preventDefault();
            void pasteFromClipboard(true);
          }
        }}
        onKeyDown={(e) => {
          if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === "KeyV") {
            // Alt+V pastes an image, as in Claude Code.
            e.preventDefault();
            void pasteFromClipboard();
            return;
          }
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
        <button
          type="button"
          title="Add images (or paste with Ctrl+V / Alt+V)"
          aria-label="Add images"
          onClick={() => fileInput.current?.click()}
          className="flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <ImagePlus className="size-4" strokeWidth={1.75} />
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp,image/bmp"
          multiple
          hidden
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = "";
            void addImages(files, files.map((f) => f.name));
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
