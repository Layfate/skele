// Markdown ⇄ Skele document conversion (Obsidian-flavoured).
//
// Export: standard Markdown + Obsidian syntax ([[links]], > [!note] callouts, ==highlight==,
// YAML frontmatter). Formatting Markdown can't express (text colours, callout colours…) is kept
// losslessly in a trailing HTML comment; on re-import, if the Markdown body is unchanged, the exact
// original document is restored. If the file was edited elsewhere, the Markdown wins.

import { MarkdownManager } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { TableKit } from "@tiptap/extension-table";
import Image from "@tiptap/extension-image";
import { gunzipSync, gzipSync, strFromU8, strToU8 } from "fflate";
import { FILE_SCHEME, sanitizeDoc, type JSONNode } from "@/features/editor/doc";

let manager: MarkdownManager | null = null;
function md() {
  manager ??= new MarkdownManager({
    extensions: [StarterKit.configure({ link: { openOnClick: false } }), TaskList, TaskItem.configure({ nested: true }), TableKit, Image],
  });
  return manager;
}

// Placeholders survive Markdown escaping (they use characters Markdown doesn't treat specially).
const P = (s: string) => `⟦${s}⟧`;
const WIKI_SCHEME = "skele-wiki:";
const EMBED_SCHEME = "skele-embed:";
const PATH_SCHEME = "skele-path:";

const CALLOUT_TYPES: Record<string, { emoji: string; color: string }> = {
  note: { emoji: "📝", color: "gray" },
  info: { emoji: "ℹ️", color: "blue" },
  tip: { emoji: "💡", color: "green" },
  success: { emoji: "✅", color: "green" },
  question: { emoji: "❓", color: "amber" },
  warning: { emoji: "⚠️", color: "amber" },
  danger: { emoji: "🔥", color: "rose" },
  bug: { emoji: "🐛", color: "rose" },
  example: { emoji: "📋", color: "indigo" },
  quote: { emoji: "💬", color: "gray" },
  abstract: { emoji: "📄", color: "indigo" },
  todo: { emoji: "☑️", color: "blue" },
};
const CALLOUT_BY_COLOR: Record<string, string> = { gray: "note", blue: "info", green: "tip", amber: "warning", rose: "danger", indigo: "abstract" };

/** Small, fast, non-cryptographic hash (FNV-1a) used to detect external edits. */
export function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

const b64 = (bytes: Uint8Array) => {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

// ───────────────────────────── Export ─────────────────────────────

export type ExportContext = {
  /** Title for a page id (for [[links]]). */
  pageTitle: (id: string) => string | undefined;
  /** Relative path for an attachment id, e.g. "attachments/photo.png". */
  filePath: (id: string) => string | undefined;
};

export type MarkdownExport = { markdown: string; lossy: string[] };

function walk(node: JSONNode, fn: (n: JSONNode) => JSONNode | JSONNode[] | null): JSONNode[] {
  const out = fn(node);
  const list = out === null ? [] : Array.isArray(out) ? out : [out];
  return list.map((n) => (n.content ? { ...n, content: n.content.flatMap((c) => walk(c, fn)) } : n));
}

/** Converts a document to Markdown. `frontmatter` becomes a YAML header. */
export function docToMarkdown(
  input: unknown,
  ctx: ExportContext,
  options: { frontmatter?: Record<string, string | string[]>; embedOriginal?: boolean } = {},
): MarkdownExport {
  const doc = sanitizeDoc(input);
  const lossy = new Set<string>();
  const wiki = new Map<string, string>();

  const transformed = walk(clone(doc), (n) => {
    switch (n.type) {
      case "wikiLink": {
        const title = ctx.pageTitle(String(n.attrs?.pageId)) ?? String(n.attrs?.label ?? "Missing page");
        const key = `w${wiki.size}`;
        wiki.set(key, title);
        return { type: "text", text: P(key) };
      }
      case "callout": {
        const type = CALLOUT_BY_COLOR[String(n.attrs?.color ?? "gray")] ?? "note";
        const first = n.content?.[0];
        const marker = { type: "text", text: `${P(`c:${type}`)} ` };
        const content = first?.type === "paragraph" ? [{ ...first, content: [marker, ...(first.content ?? [])] }, ...(n.content ?? []).slice(1)] : [{ type: "paragraph", content: [marker] }, ...(n.content ?? [])];
        if (n.attrs?.emoji && n.attrs.emoji !== CALLOUT_TYPES[type].emoji) lossy.add("callout icons");
        return { type: "blockquote", content };
      }
      case "details": {
        const summary = n.content?.find((c) => c.type === "detailsSummary");
        const body = n.content?.find((c) => c.type === "detailsContent")?.content ?? [];
        const head = { type: "paragraph", content: [{ type: "text", text: `${P("c:note-")} ` }, ...(summary?.content ?? [])] };
        return { type: "blockquote", content: [head, ...body] };
      }
      case "detailsSummary":
      case "detailsContent":
        return n;
      case "bookmark": {
        const url = String(n.attrs?.url ?? "");
        if (!url) return null;
        return { type: "paragraph", content: [{ type: "text", text: String(n.attrs?.title || url), marks: [{ type: "link", attrs: { href: url } }] }] };
      }
      case "fileBlock": {
        const ref = String(n.attrs?.url ?? "");
        const path = ref.startsWith(FILE_SCHEME) ? ctx.filePath(ref.slice(FILE_SCHEME.length)) : ref;
        return { type: "paragraph", content: [{ type: "text", text: String(n.attrs?.name ?? "file"), marks: [{ type: "link", attrs: { href: path ?? ref } }] }] };
      }
      case "image": {
        const src = String(n.attrs?.src ?? "");
        if (src.startsWith(FILE_SCHEME)) return { ...n, attrs: { ...n.attrs, src: ctx.filePath(src.slice(FILE_SCHEME.length)) ?? src } };
        return n;
      }
      case "text": {
        const marks = n.marks ?? [];
        let text = n.text ?? "";
        if (marks.some((m) => m.type === "textStyle" && m.attrs?.color)) lossy.add("text colours");
        const kept = marks.filter((m) => m.type !== "textStyle" && m.type !== "highlight" && m.type !== "underline");
        if (marks.some((m) => m.type === "underline")) lossy.add("underline");
        if (marks.some((m) => m.type === "highlight")) text = `${P("hl")}${text}${P("hl")}`;
        return { ...n, text, marks: kept.length ? kept : undefined };
      }
      default:
        return n;
    }
  })[0];

  let body = md().serialize(transformed as never);
  body = body
    .replace(new RegExp(`${P("hl")}`, "g"), "==")
    .replace(/⟦c:([a-z]+)(-?)⟧ ?/g, (_m, type: string, fold: string) => `[!${type}]${fold} `)
    .replace(/⟦(w\d+)⟧/g, (_m, key: string) => `[[${wiki.get(key) ?? key}]]`)
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd();

  let markdown = "";
  if (options.frontmatter && Object.keys(options.frontmatter).length) {
    markdown += "---\n";
    for (const [k, v] of Object.entries(options.frontmatter)) {
      if (Array.isArray(v)) markdown += v.length ? `${k}:\n${v.map((x) => `  - ${yamlScalar(x)}`).join("\n")}\n` : "";
      else markdown += `${k}: ${yamlScalar(v)}\n`;
    }
    markdown += "---\n\n";
  }
  markdown += body + "\n";

  if (options.embedOriginal !== false) {
    // Lossless copy: attachment references become relative paths so another workspace can resolve them.
    const portable = walk(clone(doc), (n) => {
      for (const key of ["src", "url"]) {
        const v = n.attrs?.[key];
        if (typeof v === "string" && v.startsWith(FILE_SCHEME)) {
          const path = ctx.filePath(v.slice(FILE_SCHEME.length));
          if (path) n.attrs = { ...n.attrs, [key]: `${PATH_SCHEME}${path}` };
        }
      }
      if (n.type === "wikiLink") n.attrs = { ...n.attrs, label: ctx.pageTitle(String(n.attrs?.pageId)) ?? n.attrs?.label };
      return n;
    })[0];
    const payload = b64(gzipSync(strToU8(JSON.stringify(portable))));
    markdown += `\n<!-- skele:doc v1 ${fnv1a(markdown.trimEnd())} ${payload} -->\n`;
  }
  return { markdown, lossy: [...lossy] };
}

function yamlScalar(v: string) {
  return /^[\w .,/@-]*$/.test(v) && v.trim() === v && v !== "" ? v : JSON.stringify(v);
}

// ───────────────────────────── Import ─────────────────────────────

export type ParsedMarkdown = {
  doc: JSONNode;
  /** Titles referenced with [[links]] (resolved to page ids by the importer). */
  wikiTargets: string[];
  /** Relative paths of images/files referenced by the note. */
  attachments: string[];
  tags: string[];
  properties: Record<string, string>;
  /** True when the exact original Skele document was restored from the embedded copy. */
  lossless: boolean;
};

function parseFrontmatter(src: string) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(src);
  if (!m) return { body: src, tags: [] as string[], properties: {} as Record<string, string> };
  const tags: string[] = [];
  const properties: Record<string, string> = {};
  let listKey: string | null = null;
  for (const line of m[1].split(/\r?\n/)) {
    const item = /^\s+-\s+(.*)$/.exec(line);
    if (item && listKey) {
      const value = item[1].trim().replace(/^["']|["']$/g, "");
      if (listKey === "tags" || listKey === "tag") tags.push(value.replace(/^#/, ""));
      else properties[listKey] = properties[listKey] ? `${properties[listKey]}, ${value}` : value;
      continue;
    }
    const kv = /^([A-Za-z0-9_ -]+):\s*(.*)$/.exec(line);
    if (!kv) continue;
    const key = kv[1].trim();
    const raw = kv[2].trim();
    listKey = raw === "" ? key : null;
    if (raw === "") continue;
    if (key === "tags" || key === "tag") {
      raw
        .replace(/^\[|\]$/g, "")
        .split(/[,\s]+/)
        .map((t) => t.trim().replace(/^["'#]|["']$/g, ""))
        .filter(Boolean)
        .forEach((t) => tags.push(t));
    } else {
      properties[key] = raw.replace(/^["']|["']$/g, "").slice(0, 500);
    }
  }
  return { body: src.slice(m[0].length), tags: tags.map((t) => t.toLowerCase()), properties };
}

const EMBED_RE = /\n?<!-- skele:doc v1 ([0-9a-f]{8}) ([A-Za-z0-9+/=]+) -->\s*$/;

export function markdownToDoc(source: string): ParsedMarkdown {
  const text = source.replace(/\r\n/g, "\n");
  // 1. Lossless restore if the file still matches what Skele exported.
  const embedded = EMBED_RE.exec(text);
  if (embedded) {
    const visible = text.slice(0, embedded.index).trimEnd();
    if (fnv1a(visible) === embedded[1]) {
      try {
        // Untrusted input: it is sanitised when the importer saves it (after refs are resolved).
        const doc = JSON.parse(strFromU8(gunzipSync(unb64(embedded[2])))) as JSONNode;
        if (doc?.type !== "doc") throw new Error("not a document");
        const fm = parseFrontmatter(visible);
        return { doc, ...collectRefs(doc), tags: fm.tags, properties: fm.properties, lossless: true };
      } catch {
        // fall through to Markdown parsing
      }
    }
  }
  const withoutEmbed = embedded ? text.slice(0, embedded.index) : text;
  const fm = parseFrontmatter(withoutEmbed);

  // 2. Rewrite Obsidian syntax into forms the Markdown parser understands.
  const prepared = fm.body
    // ![[image.png]] / ![[image.png|300]]
    .replace(/!\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g, (_m, target: string) => `![${target.split("/").pop()}](${EMBED_SCHEME}${encodeURIComponent(target.trim())})`)
    // [[Page]] / [[Page|Alias]] / [[Page#Heading]]
    .replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g, (_m, target: string, alias?: string) => `[${(alias ?? target).trim()}](${WIKI_SCHEME}${encodeURIComponent(target.trim())})`);

  const parsed = md().parse(prepared) as JSONNode;
  const doc = postProcess(parsed);
  return { doc, ...collectRefs(doc), tags: fm.tags, properties: fm.properties, lossless: false };
}

function postProcess(doc: JSONNode): JSONNode {
  return walk(doc, (n) => {
    // Callouts: blockquote starting with "[!type]" (optionally foldable with - or +).
    if (n.type === "blockquote") {
      const first = n.content?.[0];
      const lead = first?.type === "paragraph" ? first.content?.[0] : undefined;
      const m = lead?.type === "text" ? /^\[!([A-Za-z]+)\]([+-]?)[ \t]*([^\n]*)\n?/.exec(lead.text ?? "") : null;
      if (m) {
        const type = m[1].toLowerCase();
        const style = CALLOUT_TYPES[type] ?? CALLOUT_TYPES.note;
        const rest = (lead!.text ?? "").slice(m[0].length);
        const firstContent = [...(m[3] ? [{ type: "text", text: m[3], marks: [{ type: "bold" }] }] : []), ...(rest ? [{ type: "text", text: (m[3] ? "\n" : "") + rest }] : []), ...(first!.content ?? []).slice(1)];
        const body = [...(firstContent.length ? [{ type: "paragraph", content: firstContent }] : []), ...(n.content ?? []).slice(1)];
        return { type: "callout", attrs: { emoji: style.emoji, color: style.color }, content: body.length ? body : [{ type: "paragraph" }] };
      }
    }
    if (n.type === "image" && typeof n.attrs?.src === "string" && n.attrs.src.startsWith(EMBED_SCHEME)) {
      return { ...n, attrs: { ...n.attrs, src: `${PATH_SCHEME}${decodeURIComponent(n.attrs.src.slice(EMBED_SCHEME.length))}` } };
    }
    if (n.type === "paragraph" && n.content) {
      // [[links]] become wikiLink nodes; ==highlights== become highlight marks.
      const content: JSONNode[] = [];
      for (const c of n.content) {
        const link = c.marks?.find((m) => m.type === "link" && String(m.attrs?.href ?? "").startsWith(WIKI_SCHEME));
        if (c.type === "text" && link) {
          content.push({ type: "wikiLink", attrs: { pageId: null, label: decodeURIComponent(String(link.attrs!.href).slice(WIKI_SCHEME.length)), alias: c.text } });
          continue;
        }
        if (c.type === "text" && c.text?.includes("==")) {
          const parts = c.text.split(/==/);
          parts.forEach((part, i) => {
            if (!part) return;
            const marks = [...(c.marks ?? []), ...(i % 2 === 1 && i < parts.length - 1 ? [{ type: "highlight", attrs: { color: "var(--hl-yellow)" } }] : [])];
            content.push({ type: "text", text: i % 2 === 1 && i === parts.length - 1 ? `==${part}` : part, marks: marks.length ? marks : undefined });
          });
          continue;
        }
        content.push(c);
      }
      return { ...n, content };
    }
    return n;
  })[0];
}

function collectRefs(doc: JSONNode) {
  const wikiTargets = new Set<string>();
  const attachments = new Set<string>();
  walk(doc, (n) => {
    if (n.type === "wikiLink" && typeof n.attrs?.label === "string") wikiTargets.add(n.attrs.label);
    for (const key of ["src", "url"]) {
      const v = n.attrs?.[key];
      if (typeof v === "string" && v.startsWith(PATH_SCHEME)) attachments.add(v.slice(PATH_SCHEME.length));
      else if (typeof v === "string" && key === "src" && n.type === "image" && !/^[a-z]+:/i.test(v) && !v.startsWith("/")) attachments.add(decodeURIComponent(v));
    }
    for (const m of n.marks ?? []) {
      const href = m.attrs?.href;
      if (m.type === "link" && typeof href === "string" && !/^[a-z][a-z0-9+.-]*:/i.test(href) && !href.startsWith("/") && !href.startsWith("#")) {
        attachments.add(decodeURIComponent(href));
      }
    }
    return n;
  });
  return { wikiTargets: [...wikiTargets], attachments: [...attachments] };
}

/**
 * Final pass after the importer has created pages and stored attachments: points [[links]] at
 * page ids and attachment paths at `skele-file:` references.
 */
export function resolveRefs(doc: JSONNode, pageIdByTitle: (title: string) => string | undefined, fileRefByPath: (path: string) => string | undefined): JSONNode {
  return walk(clone(doc), (n) => {
    if (n.type === "wikiLink") {
      const id = pageIdByTitle(String(n.attrs?.label ?? ""));
      if (!id) return { type: "text", text: `[[${n.attrs?.label}]]` };
      return { type: "wikiLink", attrs: { pageId: id, label: n.attrs?.alias ?? n.attrs?.label } };
    }
    if (n.type === "image") {
      const src = String(n.attrs?.src ?? "");
      const path = src.startsWith(PATH_SCHEME) ? src.slice(PATH_SCHEME.length) : !/^[a-z]+:/i.test(src) ? decodeURIComponent(src) : null;
      if (path !== null) {
        const ref = fileRefByPath(path);
        return ref ? { ...n, attrs: { ...n.attrs, src: ref } } : { type: "paragraph", content: [{ type: "text", text: `![${n.attrs?.alt ?? path}](${path})` }] };
      }
    }
    if (n.type === "fileBlock" && typeof n.attrs?.url === "string" && n.attrs.url.startsWith(PATH_SCHEME)) {
      const ref = fileRefByPath(n.attrs.url.slice(PATH_SCHEME.length));
      return ref ? { ...n, attrs: { ...n.attrs, url: ref } } : n;
    }
    if (n.marks?.length) {
      n.marks = n.marks.map((m) => {
        const href = m.attrs?.href;
        if (m.type !== "link" || typeof href !== "string" || /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("/") || href.startsWith("#")) return m;
        const ref = fileRefByPath(decodeURIComponent(href));
        return ref ? { ...m, attrs: { ...m.attrs, href: ref } } : m;
      });
    }
    return n;
  })[0];
}
