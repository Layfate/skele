"use client";

import type { Editor } from "@tiptap/react";
import { useEditorState } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import { useState } from "react";
import {
  Bold,
  Check,
  ChevronDown,
  Code,
  Italic,
  Link2,
  Strikethrough,
  Underline,
  Unlink,
  type LucideIcon,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { isSafeUrl } from "./doc";
import { TEXT_COLORS, HIGHLIGHT_COLORS } from "./colors";

const TURN_INTO: { label: string; isActive: (e: Editor) => boolean; run: (e: Editor) => void }[] = [
  { label: "Text", isActive: (e) => e.isActive("paragraph"), run: (e) => e.chain().focus().setParagraph().run() },
  { label: "Heading 1", isActive: (e) => e.isActive("heading", { level: 1 }), run: (e) => e.chain().focus().setHeading({ level: 1 }).run() },
  { label: "Heading 2", isActive: (e) => e.isActive("heading", { level: 2 }), run: (e) => e.chain().focus().setHeading({ level: 2 }).run() },
  { label: "Heading 3", isActive: (e) => e.isActive("heading", { level: 3 }), run: (e) => e.chain().focus().setHeading({ level: 3 }).run() },
  { label: "Bulleted list", isActive: (e) => e.isActive("bulletList"), run: (e) => e.chain().focus().toggleBulletList().run() },
  { label: "Numbered list", isActive: (e) => e.isActive("orderedList"), run: (e) => e.chain().focus().toggleOrderedList().run() },
  { label: "To-do list", isActive: (e) => e.isActive("taskList"), run: (e) => e.chain().focus().toggleTaskList().run() },
  { label: "Quote", isActive: (e) => e.isActive("blockquote"), run: (e) => e.chain().focus().toggleBlockquote().run() },
  { label: "Code", isActive: (e) => e.isActive("codeBlock"), run: (e) => e.chain().focus().toggleCodeBlock().run() },
];

export function BubbleToolbar({ editor }: { editor: Editor }) {
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      underline: e.isActive("underline"),
      strike: e.isActive("strike"),
      code: e.isActive("code"),
      link: e.isActive("link"),
      href: (e.getAttributes("link").href as string | undefined) ?? "",
      color: (e.getAttributes("textStyle").color as string | undefined) ?? null,
      highlight: (e.getAttributes("highlight").color as string | undefined) ?? null,
      block: TURN_INTO.find((t) => t.isActive(e))?.label ?? "Text",
    }),
  });

  return (
    <BubbleMenu
      editor={editor}
      shouldShow={({ editor: e, state: s, from, to }) => {
        if (!e.isEditable || from === to) return false;
        if (e.isActive("codeBlock") || e.isActive("image") || e.isActive("fileBlock") || e.isActive("bookmark")) return false;
        return !s.selection.empty && s.doc.textBetween(from, to).length > 0;
      }}
      className="flex items-center gap-0.5 rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg"
    >
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className="flex h-7 items-center gap-1 rounded-md px-2 text-[13px] hover:bg-accent">
            {state.block}
            <ChevronDown className="size-3 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-44" onCloseAutoFocus={(e) => e.preventDefault()}>
          {TURN_INTO.map((t) => (
            <DropdownMenuItem key={t.label} onSelect={() => t.run(editor)}>
              {t.label}
              {state.block === t.label && <Check className="ml-auto" />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <Sep />
      <ToolButton icon={Bold} label="Bold (Ctrl+B)" active={state.bold} onClick={() => editor.chain().focus().toggleBold().run()} />
      <ToolButton icon={Italic} label="Italic (Ctrl+I)" active={state.italic} onClick={() => editor.chain().focus().toggleItalic().run()} />
      <ToolButton icon={Underline} label="Underline (Ctrl+U)" active={state.underline} onClick={() => editor.chain().focus().toggleUnderline().run()} />
      <ToolButton icon={Strikethrough} label="Strikethrough" active={state.strike} onClick={() => editor.chain().focus().toggleStrike().run()} />
      <ToolButton icon={Code} label="Inline code (Ctrl+E)" active={state.code} onClick={() => editor.chain().focus().toggleCode().run()} />
      <Sep />
      <LinkButton editor={editor} active={state.link} href={state.href} />
      <ColorButton editor={editor} color={state.color} highlight={state.highlight} />
    </BubbleMenu>
  );
}

function Sep() {
  return <span className="mx-0.5 h-5 w-px bg-border" aria-hidden />;
}

function ToolButton({ icon: Icon, label, active, onClick }: { icon: LucideIcon; label: string; active?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={cn("flex size-7 items-center justify-center rounded-md hover:bg-accent", active && "bg-accent text-brand")}
    >
      <Icon className="size-3.5" strokeWidth={2.25} />
    </button>
  );
}

function LinkButton({ editor, active, href }: { editor: Editor; active: boolean; href: string }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(href);
  const [invalid, setInvalid] = useState(false);

  const apply = () => {
    const raw = value.trim();
    if (!raw) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return setOpen(false);
    }
    const url = /^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith("/") ? raw : `https://${raw}`;
    if (!isSafeUrl(url)) return setInvalid(true);
    editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
    setOpen(false);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          setValue(href);
          setInvalid(false);
        }
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          title="Link (Ctrl+K)"
          aria-label="Link"
          className={cn("flex h-7 items-center gap-1 rounded-md px-1.5 hover:bg-accent", active && "text-brand")}
        >
          <Link2 className="size-3.5" strokeWidth={2.25} />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-2" align="start" onOpenAutoFocus={(e) => e.preventDefault()}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            apply();
          }}
          className="flex items-center gap-1.5"
        >
          <input
            autoFocus
            value={value}
            onChange={(e) => (setValue(e.target.value), setInvalid(false))}
            placeholder="Paste or type a link…"
            aria-invalid={invalid}
            className="h-8 flex-1 rounded-md border bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring aria-[invalid=true]:border-destructive"
          />
          {active && (
            <button
              type="button"
              title="Remove link"
              onClick={() => {
                editor.chain().focus().extendMarkRange("link").unsetLink().run();
                setOpen(false);
              }}
              className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent"
            >
              <Unlink className="size-4" />
            </button>
          )}
        </form>
        {invalid && <p className="mt-1.5 text-xs text-destructive">Only http(s) and mailto links are allowed.</p>}
      </PopoverContent>
    </Popover>
  );
}

function ColorButton({ editor, color, highlight }: { editor: Editor; color: string | null; highlight: string | null }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" title="Colour" aria-label="Text colour" className="flex h-7 items-center gap-0.5 rounded-md px-1.5 hover:bg-accent">
          <span
            className="flex size-5 items-center justify-center rounded border text-[12px] font-semibold"
            style={{ color: color ?? undefined, background: highlight ?? undefined }}
          >
            A
          </span>
          <ChevronDown className="size-3 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-2" align="start" onOpenAutoFocus={(e) => e.preventDefault()}>
        <p className="mb-1.5 px-0.5 text-[11px] font-medium text-muted-foreground">Text colour</p>
        <div className="grid grid-cols-8 gap-1">
          {TEXT_COLORS.map((c) => (
            <button
              key={c.name}
              type="button"
              title={c.label}
              aria-label={`${c.label} text`}
              onClick={() =>
                c.value ? editor.chain().focus().setColor(c.value).run() : editor.chain().focus().unsetColor().run()
              }
              className={cn(
                "flex size-6 items-center justify-center rounded border text-[12px] font-semibold hover:bg-accent",
                (color ?? null) === c.value && "ring-2 ring-ring",
              )}
              style={{ color: c.value ?? undefined }}
            >
              A
            </button>
          ))}
        </div>
        <p className="mt-2.5 mb-1.5 px-0.5 text-[11px] font-medium text-muted-foreground">Highlight</p>
        <div className="grid grid-cols-8 gap-1">
          {HIGHLIGHT_COLORS.map((c) => (
            <button
              key={c.name}
              type="button"
              title={c.label}
              aria-label={`${c.label} highlight`}
              onClick={() =>
                c.value
                  ? editor.chain().focus().setHighlight({ color: c.value }).run()
                  : editor.chain().focus().unsetHighlight().run()
              }
              className={cn("size-6 rounded border", (highlight ?? null) === c.value && "ring-2 ring-ring")}
              style={{ background: c.value ?? undefined }}
            />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
