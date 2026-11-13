"use client";

import { mergeAttributes, Node, type Editor, type Range } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, ReactRenderer, type ReactNodeViewProps } from "@tiptap/react";
import Suggestion, { type SuggestionKeyDownProps, type SuggestionProps } from "@tiptap/suggestion";
import { PluginKey } from "@tiptap/pm/state";
import { forwardRef, useImperativeHandle, useState } from "react";
import { FilePlus2 } from "lucide-react";
import { PageIcon } from "@/components/common";
import { cn } from "@/lib/utils";
import type { PageRef } from "./skele-storage";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    wikiLink: { insertWikiLink: (attrs: { pageId: string; label: string }) => ReturnType };
  }
}

/** Inline `[[link]]` to another page. Stores the page id, so renames never break it. */
export const WikiLink = Node.create({
  name: "wikiLink",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      pageId: { default: null, parseHTML: (el) => el.getAttribute("data-page-id") },
      label: { default: "", parseHTML: (el) => el.textContent ?? "" },
    };
  },
  parseHTML() {
    return [{ tag: "a[data-wiki-link]" }];
  },
  renderHTML({ node, HTMLAttributes }) {
    return ["a", mergeAttributes(HTMLAttributes, { "data-wiki-link": "", "data-page-id": node.attrs.pageId }), `[[${node.attrs.label}]]`];
  },
  renderText({ node }) {
    return `[[${node.attrs.label}]]`;
  },
  addCommands() {
    return {
      insertWikiLink:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent([{ type: this.name, attrs }, { type: "text", text: " " }]),
    };
  },
  addNodeView() {
    return ReactNodeViewRenderer(WikiLinkView, { as: "span" });
  },
  addProseMirrorPlugins() {
    return [
      Suggestion<PageRef | { create: string }, PageRef | { create: string }>({
        editor: this.editor,
        pluginKey: new PluginKey("wikiLinkSuggest"),
        char: "[[",
        allowSpaces: true,
        allow: ({ state }) => !state.selection.$from.parent.type.spec.code,
        items: async ({ query, editor }) => {
          const search = editor.storage.skele.searchPages;
          const pages = search ? await search(query.replace(/\]+$/, "")) : [];
          const q = query.replace(/\]+$/, "").trim();
          const exact = pages.some((p) => p.title.toLowerCase() === q.toLowerCase());
          return [...pages.slice(0, 8), ...(q && !exact && editor.storage.skele.createPage ? [{ create: q }] : [])];
        },
        command: async ({ editor, range, props }: { editor: Editor; range: Range; props: PageRef | { create: string } }) => {
          let page: PageRef | null = "create" in props ? null : props;
          if ("create" in props) page = (await editor.storage.skele.createPage?.(props.create)) ?? null;
          if (!page) return;
          editor.chain().focus().deleteRange(range).insertWikiLink({ pageId: page.id, label: page.title || "Untitled" }).run();
        },
        render: () => {
          let renderer: ReactRenderer<MenuHandle, MenuProps> | null = null;
          let container: HTMLDivElement | null = null;
          const place = (props: SuggestionProps<PageRef | { create: string }, PageRef | { create: string }>) => {
            const rect = props.clientRect?.();
            if (!rect || !container) return;
            container.style.left = `${Math.min(rect.left, window.innerWidth - 300)}px`;
            container.style.top = rect.bottom + 280 < window.innerHeight ? `${rect.bottom + 6}px` : `${Math.max(8, rect.top - 286)}px`;
          };
          return {
            onStart: (props) => {
              renderer = new ReactRenderer(LinkMenu, { editor: props.editor, props: { items: props.items, command: props.command } });
              container = document.createElement("div");
              container.style.position = "fixed";
              container.style.zIndex = "60";
              container.appendChild(renderer.element);
              document.body.appendChild(container);
              place(props);
            },
            onUpdate: (props) => {
              renderer?.updateProps({ items: props.items, command: props.command });
              place(props);
            },
            onKeyDown: (props) => (props.event.key === "Escape" ? (container?.remove(), true) : (renderer?.ref?.onKeyDown(props) ?? false)),
            onExit: () => {
              container?.remove();
              renderer?.destroy();
            },
          };
        },
      }),
    ];
  },
});

type Item = PageRef | { create: string };
type MenuHandle = { onKeyDown: (p: SuggestionKeyDownProps) => boolean };
type MenuProps = { items: Item[]; command: (item: Item) => void };

const LinkMenu = forwardRef<MenuHandle, MenuProps>(function LinkMenu({ items, command }, ref) {
  const [index, setIndex] = useState(0);
  const [shown, setShown] = useState(items);
  if (shown !== items) {
    // New results: start from the top again (adjusting state during render, not in an effect).
    setShown(items);
    setIndex(0);
  }
  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (!items.length) return false;
      if (event.key === "ArrowDown") return setIndex((i) => (i + 1) % items.length), true;
      if (event.key === "ArrowUp") return setIndex((i) => (i - 1 + items.length) % items.length), true;
      if (event.key === "Enter" || event.key === "Tab") return command(items[index]), true;
      return false;
    },
  }));
  return (
    <div role="listbox" aria-label="Link to page" className="w-72 rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg">
      {items.length === 0 && <p className="px-2 py-1.5 text-sm text-muted-foreground">Type a page name…</p>}
      {items.map((item, i) => (
        <button
          key={"create" in item ? "__create" : item.id}
          type="button"
          role="option"
          aria-selected={i === index}
          onMouseEnter={() => setIndex(i)}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => command(item)}
          className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm", i === index && "bg-accent")}
        >
          {"create" in item ? (
            <>
              <FilePlus2 className="size-4 text-muted-foreground" /> Create “{item.create}”
            </>
          ) : (
            <>
              <PageIcon icon={item.icon} className="size-4 text-[15px]" />
              <span className="truncate">{item.title || "Untitled"}</span>
            </>
          )}
        </button>
      ))}
    </div>
  );
});

function WikiLinkView({ node, editor, selected }: ReactNodeViewProps) {
  const pageId = node.attrs.pageId as string | null;
  const lookup = editor.storage.skele.pageTitle;
  const title = pageId && lookup ? lookup(pageId) : undefined;
  const missing = !!pageId && !!lookup && title === undefined;
  const label = title ?? (node.attrs.label as string);
  return (
    <NodeViewWrapper as="span" className="inline">
      <a
        href={pageId ? `/page?id=${encodeURIComponent(pageId)}` : undefined}
        data-wiki-link=""
        onClick={(e) => {
          if (!pageId) return;
          e.preventDefault();
          editor.storage.skele.openPage?.(pageId);
        }}
        title={missing ? "This page was deleted" : `Open ${label}`}
        className={cn(
          "cursor-pointer rounded-sm px-0.5 font-medium text-brand no-underline decoration-brand/40 hover:underline",
          missing && "text-muted-foreground line-through",
          selected && "ring-2 ring-ring",
        )}
      >
        {label || "Untitled"}
      </a>
    </NodeViewWrapper>
  );
}
