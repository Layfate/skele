"use client";

import { Extension, type Editor, type Range } from "@tiptap/core";
import { ReactRenderer } from "@tiptap/react";
import Suggestion, { type SuggestionKeyDownProps, type SuggestionProps } from "@tiptap/suggestion";
import { PluginKey } from "@tiptap/pm/state";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { filterBlocks, type BlockItem } from "../block-items";

type MenuHandle = { onKeyDown: (props: SuggestionKeyDownProps) => boolean };
type MenuProps = { items: BlockItem[]; command: (item: BlockItem) => void };

const SlashMenu = forwardRef<MenuHandle, MenuProps>(function SlashMenu({ items, command }, ref) {
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => setIndex(0), [items]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${index}"]`)?.scrollIntoView({ block: "nearest" });
  }, [index]);

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (!items.length) return false;
      if (event.key === "ArrowDown") {
        setIndex((i) => (i + 1) % items.length);
        return true;
      }
      if (event.key === "ArrowUp") {
        setIndex((i) => (i - 1 + items.length) % items.length);
        return true;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        command(items[index]);
        return true;
      }
      return false;
    },
  }));

  if (!items.length) {
    return (
      <div className="w-64 rounded-lg border bg-popover p-3 text-sm text-muted-foreground shadow-lg">No matching blocks</div>
    );
  }

  let lastGroup = "";
  return (
    <div
      ref={listRef}
      role="listbox"
      aria-label="Insert block"
      className="max-h-80 w-72 overflow-y-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg scrollbar-thin"
    >
      {items.map((item, i) => {
        const header = item.group !== lastGroup ? item.group : null;
        lastGroup = item.group;
        return (
          <div key={item.id}>
            {header && <p className="px-2 pt-2 pb-1 text-[11px] font-medium text-muted-foreground">{header}</p>}
            <button
              type="button"
              role="option"
              aria-selected={i === index}
              data-index={i}
              onMouseEnter={() => setIndex(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => command(item)}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left",
                i === index && "bg-accent",
              )}
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-md border bg-background">
                <item.icon className="size-4" strokeWidth={1.75} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm leading-tight">{item.title}</span>
                <span className="block truncate text-xs text-muted-foreground">{item.description}</span>
              </span>
              {item.hint && <span className="font-mono text-[11px] text-muted-foreground">{item.hint}</span>}
            </button>
          </div>
        );
      })}
    </div>
  );
});

const slashKey = new PluginKey("slashCommand");

export const SlashCommand = Extension.create({
  name: "slashCommand",
  addProseMirrorPlugins() {
    return [
      Suggestion<BlockItem, BlockItem>({
        editor: this.editor,
        pluginKey: slashKey,
        char: "/",
        allow: ({ state }) => !state.selection.$from.parent.type.spec.code,
        items: ({ query }) => filterBlocks(query),
        command: ({ editor, range, props }: { editor: Editor; range: Range; props: BlockItem }) => props.run(editor, range),
        render: () => {
          let renderer: ReactRenderer<MenuHandle, MenuProps> | null = null;
          let container: HTMLDivElement | null = null;

          const place = (props: SuggestionProps<BlockItem, BlockItem>) => {
            const rect = props.clientRect?.();
            if (!rect || !container) return;
            const menuHeight = 330;
            const below = rect.bottom + menuHeight < window.innerHeight;
            container.style.left = `${Math.min(rect.left, window.innerWidth - 300)}px`;
            container.style.top = below ? `${rect.bottom + 6}px` : `${Math.max(8, rect.top - menuHeight - 6)}px`;
          };

          return {
            onStart: (props) => {
              renderer = new ReactRenderer(SlashMenu, {
                editor: props.editor,
                props: { items: props.items, command: (item: BlockItem) => props.command(item) },
              });
              container = document.createElement("div");
              container.style.position = "fixed";
              container.style.zIndex = "60";
              container.appendChild(renderer.element);
              document.body.appendChild(container);
              place(props);
            },
            onUpdate: (props) => {
              renderer?.updateProps({ items: props.items, command: (item: BlockItem) => props.command(item) });
              place(props);
            },
            onKeyDown: (props) => {
              if (props.event.key === "Escape") {
                container?.remove();
                return true;
              }
              return renderer?.ref?.onKeyDown(props) ?? false;
            },
            onExit: () => {
              container?.remove();
              renderer?.destroy();
              renderer = null;
              container = null;
            },
          };
        },
      }),
    ];
  },
});
