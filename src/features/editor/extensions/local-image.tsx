"use client";

import Image from "@tiptap/extension-image";
import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from "@tiptap/react";
import { useEffect, useState } from "react";
import { ImageOff } from "lucide-react";
import { FILE_SCHEME } from "../doc";

/** Image node that can display attachments stored locally (`skele-file:` references). */
export const LocalImage = Image.extend({
  addNodeView() {
    return ReactNodeViewRenderer(LocalImageView);
  },
});

function LocalImageView({ node, editor, selected }: ReactNodeViewProps) {
  const src = String(node.attrs.src ?? "");
  const isLocal = src.startsWith(FILE_SCHEME);
  const [resolved, setResolved] = useState<{ src: string; url: string | null } | null>(null);

  useEffect(() => {
    if (!isLocal) return;
    let cancelled = false;
    const resolve = editor.storage.skele.resolveFile;
    (resolve ? resolve(src) : Promise.resolve(null)).then((url) => !cancelled && setResolved({ src, url }));
    return () => {
      cancelled = true;
    };
  }, [src, isLocal, editor]);

  const url = isLocal ? (resolved?.src === src ? resolved.url : undefined) : src;
  return (
    <NodeViewWrapper className="my-1.5" data-drag-handle>
      {url === null ? (
        <div className="flex h-24 items-center justify-center gap-2 rounded-lg border border-dashed text-sm text-muted-foreground">
          <ImageOff className="size-4" /> Image file is missing
        </div>
      ) : url === undefined ? (
        <div className="h-40 animate-pulse rounded-lg bg-muted" />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt={String(node.attrs.alt ?? "")}
          title={node.attrs.title ? String(node.attrs.title) : undefined}
          draggable={false}
          className={selected ? "outline-2 outline-offset-2 outline-[var(--brand)]" : undefined}
        />
      )}
    </NodeViewWrapper>
  );
}
