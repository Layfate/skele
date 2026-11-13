// Framework-agnostic helpers for Tiptap JSON documents (used by client and server).

export type JSONNode = {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  content?: JSONNode[];
};

export const EMPTY_DOC: JSONNode = { type: "doc", content: [] };

const BLOCK_SEPARATOR = "\n";
const MAX_DEPTH = 64;

/** Plain-text projection of a document (used for search and previews). */
export function extractText(doc: unknown, limit = 200_000): string {
  const out: string[] = [];
  let size = 0;
  const walk = (node: JSONNode, depth: number) => {
    if (size > limit || depth > MAX_DEPTH || !node || typeof node !== "object") return;
    if (typeof node.text === "string") {
      out.push(node.text);
      size += node.text.length;
    }
    if (node.type === "image" && typeof node.attrs?.alt === "string") out.push(node.attrs.alt);
    if (node.type === "bookmark" && typeof node.attrs?.title === "string") out.push(node.attrs.title);
    if (Array.isArray(node.content)) {
      for (const child of node.content) walk(child, depth + 1);
      if (node.type !== "doc" && node.type !== "text") out.push(BLOCK_SEPARATOR);
    }
  };
  walk(doc as JSONNode, 0);
  return out
    .join("")
    .replace(/\n{2,}/g, "\n")
    .trim()
    .slice(0, limit);
}

const SAFE_PROTOCOLS = ["http:", "https:", "mailto:"];

/** Reference to an attachment stored in the local workspace (resolved to a blob URL at render). */
export const FILE_SCHEME = "skele-file:";

/** Allow http(s)/mailto URLs, local attachments and same-origin paths; reject everything else. */
export function isSafeUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048) return false;
  const trimmed = value.trim();
  if (trimmed.startsWith(FILE_SCHEME)) return /^skele-file:[A-Za-z0-9_-]+$/.test(trimmed);
  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) return true;
  try {
    return SAFE_PROTOCOLS.includes(new URL(trimmed).protocol);
  } catch {
    return false;
  }
}

const SAFE_COLOR = /^(var\(--(tc|hl)-[a-z]+\)|#[0-9a-fA-F]{3,8})$/;

/** Marks whose `color` attribute ends up in an inline style — only allow-listed values. */
function cleanMark(m: { type: string; attrs?: Record<string, unknown> }) {
  if ((m.type === "textStyle" || m.type === "highlight") && m.attrs && "color" in m.attrs) {
    const color = m.attrs.color;
    if (color != null && (typeof color !== "string" || !SAFE_COLOR.test(color))) {
      return { ...m, attrs: { ...m.attrs, color: null } };
    }
  }
  return m;
}

const URL_ATTRS: Record<string, string[]> = {
  image: ["src"],
  fileBlock: ["url"],
  bookmark: ["url", "image"],
};

/**
 * Defensive normalisation for stored documents: enforces depth limits, removes unsafe
 * URLs from links/images/files and drops non-object nodes. Returns a new document.
 */
export function sanitizeDoc(input: unknown): JSONNode {
  const clean = (node: unknown, depth: number): JSONNode | null => {
    if (!node || typeof node !== "object" || Array.isArray(node) || depth > MAX_DEPTH) return null;
    const n = node as JSONNode;
    if (typeof n.type !== "string") return null;
    const result: JSONNode = { type: n.type };
    if (typeof n.text === "string") result.text = n.text;
    if (n.attrs && typeof n.attrs === "object" && !Array.isArray(n.attrs)) {
      const attrs: Record<string, unknown> = { ...n.attrs };
      for (const key of URL_ATTRS[n.type] ?? []) {
        if (attrs[key] != null && !isSafeUrl(attrs[key])) attrs[key] = null;
      }
      result.attrs = attrs;
    }
    if (Array.isArray(n.marks)) {
      result.marks = n.marks
        .filter(
          (m) =>
            m && typeof m === "object" && typeof m.type === "string" && (m.type !== "link" || isSafeUrl(m.attrs?.href)),
        )
        .map(cleanMark);
      if (!result.marks.length) delete result.marks;
    }
    if (Array.isArray(n.content)) {
      result.content = n.content.map((c) => clean(c, depth + 1)).filter((c): c is JSONNode => c !== null);
    }
    return result;
  };
  const doc = clean(input, 0);
  if (!doc || doc.type !== "doc") return { ...EMPTY_DOC };
  return doc;
}

/** Page ids referenced by `[[wiki links]]` in a document. */
export function extractLinks(doc: unknown): string[] {
  const out: string[] = [];
  const walk = (node: JSONNode, depth: number) => {
    if (!node || typeof node !== "object" || depth > MAX_DEPTH) return;
    if (node.type === "wikiLink" && typeof node.attrs?.pageId === "string") out.push(node.attrs.pageId);
    node.content?.forEach((c) => walk(c, depth + 1));
  };
  walk(doc as JSONNode, 0);
  return out;
}

/** `#tags` in plain text (letters, digits, -, _, / for nesting). Pure numbers aren't tags. */
export function extractTags(text: string): string[] {
  const tags = new Set<string>();
  for (const m of text.matchAll(/(?:^|[\s(])#([\p{L}\p{N}_][\p{L}\p{N}_/-]*)/gu)) {
    if (!/^\d+$/.test(m[1])) tags.add(m[1].toLowerCase());
  }
  return [...tags].slice(0, 100);
}

/** Starter content for a brand new workspace. */
export function gettingStartedDoc(): JSONNode {
  const p = (text: string): JSONNode => ({ type: "paragraph", content: [{ type: "text", text }] });
  const h = (level: number, text: string): JSONNode => ({
    type: "heading",
    attrs: { level },
    content: [{ type: "text", text }],
  });
  const todo = (text: string, checked = false): JSONNode => ({
    type: "taskItem",
    attrs: { checked },
    content: [p(text)],
  });
  return {
    type: "doc",
    content: [
      p("Skele is your calm place for notes, projects and structured data. A few things to try:"),
      h(2, "The basics"),
      {
        type: "taskList",
        content: [
          todo("Create your first page with the + next to Pages", true),
          todo("Type / anywhere to insert headings, lists, tables, callouts and more"),
          todo("Select text to format it, add links or colour"),
          todo("Drag the ⋮⋮ handle beside a block to move it"),
          todo("Press Ctrl/⌘ + K to search and run commands"),
        ],
      },
      {
        type: "callout",
        attrs: { emoji: "💡", color: "indigo" },
        content: [p("Pages can be nested as deep as you like — drag them in the sidebar to reorganise.")],
      },
      h(2, "Shortcuts worth learning"),
      {
        type: "bulletList",
        content: [
          { type: "listItem", content: [p("Ctrl/⌘ + K — search & commands")] },
          { type: "listItem", content: [p("Ctrl/⌘ + \\ — toggle the sidebar")] },
          { type: "listItem", content: [p("# , ## , - , 1. , [] , > — Markdown shortcuts")] },
        ],
      },
    ],
  };
}
