"use client";

import { mergeAttributes, Node } from "@tiptap/core";
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from "@tiptap/react";
import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { EmojiPicker } from "@/components/emoji-picker";
import { cn } from "@/lib/utils";

export const CALLOUT_COLORS = ["gray", "indigo", "blue", "green", "amber", "rose"] as const;

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    callout: { setCallout: (attrs?: { emoji?: string; color?: string }) => ReturnType };
  }
}

export const Callout = Node.create({
  name: "callout",
  group: "block",
  content: "block+",
  defining: true,
  addAttributes() {
    return {
      emoji: { default: "💡", parseHTML: (el) => el.getAttribute("data-emoji") ?? "💡" },
      color: { default: "gray", parseHTML: (el) => el.getAttribute("data-color") ?? "gray" },
    };
  },
  parseHTML() {
    return [{ tag: "div[data-callout]" }];
  },
  renderHTML({ node, HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, { "data-callout": "", "data-emoji": node.attrs.emoji, "data-color": node.attrs.color }),
      0,
    ];
  },
  addCommands() {
    return {
      setCallout:
        (attrs) =>
        ({ commands }) =>
          commands.wrapIn(this.name, attrs),
    };
  },
  addNodeView() {
    return ReactNodeViewRenderer(CalloutView);
  },
});

function CalloutView({ node, updateAttributes, editor }: ReactNodeViewProps) {
  const [open, setOpen] = useState(false);
  const color = node.attrs.color as string;
  return (
    <NodeViewWrapper className={cn("callout my-2 flex gap-2.5 rounded-lg px-3.5 py-3")} data-color={color}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            contentEditable={false}
            disabled={!editor.isEditable}
            className="flex size-7 shrink-0 items-center justify-center rounded-md text-lg leading-none hover:bg-black/5 dark:hover:bg-white/10"
            aria-label="Change callout icon"
          >
            {node.attrs.emoji as string}
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start" contentEditable={false}>
          <div className="flex gap-1.5 border-b p-2">
            {CALLOUT_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`${c} background`}
                onClick={() => updateAttributes({ color: c })}
                className={cn("callout size-6 rounded-md border", c === color && "ring-2 ring-ring")}
                data-color={c}
              />
            ))}
          </div>
          <EmojiPicker
            onSelect={(emoji) => {
              updateAttributes({ emoji });
              setOpen(false);
            }}
          />
        </PopoverContent>
      </Popover>
      <NodeViewContent className="min-w-0 flex-1 pt-0.5" />
    </NodeViewWrapper>
  );
}
