"use client";

import { mergeAttributes, Node } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from "@tiptap/react";
import { Download, FileText } from "lucide-react";
import { isSafeUrl } from "../doc";
import { formatBytes } from "./skele-storage";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    fileBlock: {
      insertFileBlock: (attrs: { url: string; name: string; size: number; mimeType: string }) => ReturnType;
    };
  }
}

/** An uploaded attachment rendered as a download card. */
export const FileBlock = Node.create({
  name: "fileBlock",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      url: { default: null },
      name: { default: "File" },
      size: { default: 0 },
      mimeType: { default: "" },
    };
  },
  parseHTML() {
    return [{ tag: "div[data-file-block]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-file-block": "" })];
  },
  addCommands() {
    return {
      insertFileBlock:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    };
  },
  addNodeView() {
    return ReactNodeViewRenderer(FileBlockView);
  },
});

function FileBlockView({ node, selected, editor }: ReactNodeViewProps) {
  const { url, name, size, mimeType } = node.attrs as { url: string | null; name: string; size: number; mimeType: string };
  const safe = isSafeUrl(url);
  const open = async (e: React.MouseEvent) => {
    if (!url?.startsWith("skele-file:")) return;
    e.preventDefault();
    const blobUrl = await editor.storage.skele.resolveFile?.(url);
    if (!blobUrl) return;
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = name;
    a.click();
  };
  return (
    <NodeViewWrapper className="my-1.5" data-drag-handle>
      <div
        className={`flex items-center gap-3 rounded-lg border bg-card px-3 py-2.5 transition-colors hover:bg-accent/60 ${selected ? "ring-2 ring-ring" : ""}`}
      >
        <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted">
          <FileText className="size-4.5 text-muted-foreground" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{name}</p>
          <p className="text-xs text-muted-foreground">
            {formatBytes(size)} {mimeType && `· ${mimeType.split("/").pop()?.toUpperCase().slice(0, 12)}`}
          </p>
        </div>
        {safe && (
          <a
            href={url!.startsWith("skele-file:") ? "#" : url!}
            onClick={open}
            target="_blank"
            rel="noopener noreferrer"
            className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground"
            aria-label={`Open ${name}`}
            contentEditable={false}
          >
            <Download className="size-4" />
          </a>
        )}
      </div>
    </NodeViewWrapper>
  );
}
