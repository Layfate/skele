"use client";

import { useMemo, useState } from "react";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { docToMarkdown, markdownToDoc, resolveRefs } from "@/features/import-export/markdown";
import type { JSONNode } from "@/features/editor/doc";
import type { PageListItem } from "../hooks";

/**
 * Optional source-Markdown mode. Shows the page as Markdown; "Apply" converts the edited text
 * back into the rich document. Formatting Markdown can't express is called out before applying.
 */
export function MarkdownSource({
  doc,
  pages,
  editable,
  onApply,
  onCancel,
}: {
  doc: unknown;
  pages: PageListItem[];
  editable: boolean;
  onApply: (doc: JSONNode) => void;
  onCancel: () => void;
}) {
  const titleById = useMemo(() => new Map(pages.map((p) => [p.id, p.title || "Untitled"])), [pages]);
  const initial = useMemo(
    () =>
      docToMarkdown(doc, { pageTitle: (id) => titleById.get(id), filePath: (id) => `skele-file:${id}` }, { embedOriginal: false }),
    [doc, titleById],
  );
  const [text, setText] = useState(initial.markdown);
  const dirty = text !== initial.markdown;

  const apply = () => {
    const parsed = markdownToDoc(text);
    const idByTitle = new Map(pages.map((p) => [(p.title || "Untitled").toLowerCase(), p.id]));
    const resolved = resolveRefs(
      parsed.doc,
      (title) => idByTitle.get(title.toLowerCase()),
      (path) => (path.startsWith("skele-file:") ? path : undefined),
    );
    onApply(resolved);
  };

  return (
    <div className="pb-24">
      {initial.lossy.length > 0 && (
        <p className="mb-3 flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-600" />
          Markdown can&apos;t show {initial.lossy.join(" and ")} on this page. Applying edits here removes that formatting.
        </p>
      )}
      <textarea
        value={text}
        readOnly={!editable}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
        aria-label="Markdown source"
        className="field-sizing-content min-h-[60vh] w-full resize-none rounded-lg border bg-muted/30 p-4 font-mono text-[13px] leading-relaxed outline-none focus:ring-2 focus:ring-ring"
      />
      <div className="mt-3 flex gap-2">
        {editable && (
          <Button onClick={apply} disabled={!dirty}>
            Apply changes
          </Button>
        )}
        <Button variant="ghost" onClick={onCancel}>
          {dirty ? "Discard" : "Back to editor"}
        </Button>
      </div>
    </div>
  );
}
