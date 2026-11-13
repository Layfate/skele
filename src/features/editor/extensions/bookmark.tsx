"use client";

import { mergeAttributes, Node } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from "@tiptap/react";
import { useState } from "react";
import { Globe, Link2 } from "lucide-react";
import { isSafeUrl } from "../doc";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    bookmark: { insertBookmark: (attrs?: { url?: string; title?: string }) => ReturnType };
  }
}

/**
 * A link bookmark card. We deliberately don't fetch remote metadata server-side (SSRF risk);
 * the card shows the host and an optional editable title.
 */
export const Bookmark = Node.create({
  name: "bookmark",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return { url: { default: "" }, title: { default: "" } };
  },
  parseHTML() {
    return [{ tag: "div[data-bookmark]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-bookmark": "" })];
  },
  addCommands() {
    return {
      insertBookmark:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: { url: "", title: "", ...attrs } }),
    };
  },
  addNodeView() {
    return ReactNodeViewRenderer(BookmarkView);
  },
});

function normalise(raw: string) {
  const v = raw.trim();
  if (!v) return "";
  return /^[a-z][a-z0-9+.-]*:/i.test(v) ? v : `https://${v}`;
}

function BookmarkView({ node, updateAttributes, editor, selected }: ReactNodeViewProps) {
  const url = node.attrs.url as string;
  const title = node.attrs.title as string;
  const [draft, setDraft] = useState("");
  const [error, setError] = useState(false);

  if (!url) {
    if (!editor.isEditable) return <NodeViewWrapper />;
    return (
      <NodeViewWrapper className="my-1.5">
        <form
          contentEditable={false}
          onSubmit={(e) => {
            e.preventDefault();
            const next = normalise(draft);
            if (!isSafeUrl(next)) return setError(true);
            updateAttributes({ url: next, title: "" });
          }}
          className="flex items-center gap-2 rounded-lg border bg-muted/50 p-2"
        >
          <Link2 className="ml-1 size-4 text-muted-foreground" />
          <input
            autoFocus
            value={draft}
            onChange={(e) => (setDraft(e.target.value), setError(false))}
            placeholder="Paste a link to bookmark…"
            aria-invalid={error}
            className="h-7 flex-1 bg-transparent outline-none placeholder:text-muted-foreground aria-[invalid=true]:text-destructive"
          />
          <button type="submit" className="h-7 rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground">
            Add bookmark
          </button>
        </form>
      </NodeViewWrapper>
    );
  }

  let host = url;
  try {
    host = new URL(url).hostname.replace(/^www\./, "");
  } catch {}

  return (
    <NodeViewWrapper className="my-1.5" data-drag-handle>
      <div className={`flex items-stretch overflow-hidden rounded-lg border bg-card transition-colors hover:bg-accent/50 ${selected ? "ring-2 ring-ring" : ""}`}>
        <div className="min-w-0 flex-1 px-3.5 py-3">
          {editor.isEditable ? (
            <input
              value={title}
              onChange={(e) => updateAttributes({ title: e.target.value })}
              placeholder={host}
              className="w-full bg-transparent font-medium outline-none placeholder:text-foreground"
              contentEditable={false}
            />
          ) : (
            <p className="truncate font-medium">{title || host}</p>
          )}
          {isSafeUrl(url) ? (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              contentEditable={false}
              className="mt-1 flex items-center gap-1.5 truncate text-xs text-muted-foreground hover:text-foreground hover:underline"
            >
              <Globe className="size-3.5 shrink-0" />
              <span className="truncate">{url}</span>
            </a>
          ) : (
            <p className="mt-1 text-xs text-destructive">Unsupported link</p>
          )}
        </div>
      </div>
    </NodeViewWrapper>
  );
}
