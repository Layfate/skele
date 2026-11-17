// What the AI can see of the workspace (Settings → AI → Providers → "Let the AI see this
// workspace", on by default):
//
// - An index: the titles of pages and databases, in the system prompt, so the model knows
//   what exists when the user refers to something.
// - Pages and databases the user names in a message ("in my Reading list…", or [[Reading
//   list]]) are attached to it automatically, like the Pages button does.
// - API models (Claude API, OpenAI API, OpenRouter) also get tools to search the workspace
//   and read any page or database themselves.
//
// Pages are sent as Markdown; databases as a table of their rows. Everything is read from this
// device's own storage; nothing is sent until the user sends a message.

import { workspaceStore } from "@/data/registry";
import { getDatabaseByPage, listDatabases } from "@/data/repo/databases";
import { getPage, listPages } from "@/data/repo/pages";
import { search } from "@/data/repo/search";
import type { Page } from "@/data/types";
import type { Property } from "@/features/databases/properties";
import { docToMarkdown } from "@/features/import-export/markdown";
import type { ApiTool } from "./tools";
import type { ContextPage } from "./types";

/** Most rows of one database sent to a model. */
const MAX_ROWS = 300;
/** Most characters of one page or database sent to a model. */
const MAX_PAGE_CHARS = 120_000;

const rowsLabel = (n: number) => `${n} row${n === 1 ? "" : "s"}`;
const titleOf = (p: Pick<Page, "title">) => p.title.trim() || "Untitled";

/** A database cell as plain text (option ids become their names). */
export function cellText(prop: Pick<Property, "type" | "config">, value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  const option = (id: unknown) => prop.config.options?.find((o) => o.id === id)?.name ?? String(id);
  switch (prop.type) {
    case "SELECT":
    case "STATUS":
      return option(value);
    case "MULTI_SELECT":
      return Array.isArray(value) ? value.map(option).join(", ") : "";
    case "CHECKBOX":
      return value ? "yes" : "no";
    default:
      return String(value);
  }
}

const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ").slice(0, 300);

/** A page as Markdown; a database page also gets its rows as a table. */
export async function pageText(workspaceId: string, pageId: string): Promise<{ title: string; text: string }> {
  const s = workspaceStore(workspaceId);
  const [page, all] = await Promise.all([getPage(s, pageId), listPages(s)]);
  const titles = new Map(all.pages.map((p) => [p.id, titleOf(p)]));
  // No embedded copy of the document (that is for re-importing exports, not for a model).
  const { markdown } = docToMarkdown(page.content.doc, { pageTitle: (id) => titles.get(id), filePath: () => undefined }, { embedOriginal: false });
  let text = markdown.trim();
  if (page.kind === "DATABASE" || page.database) {
    const db = await getDatabaseByPage(s, pageId).catch(() => null);
    if (db) {
      const props = db.properties;
      const rows = db.records.slice(0, MAX_ROWS);
      const table = [
        `| Name | ${props.map((p) => cell(p.name)).join(" | ")} |`,
        `|${" --- |".repeat(props.length + 1)}`,
        ...rows.map((r) => `| ${cell(r.title || "Untitled")} | ${props.map((p) => cell(cellText(p, r.values[p.id]))).join(" | ")} |`),
      ].join("\n");
      const more = db.records.length > rows.length ? `\n\n(${db.records.length - rows.length} more rows not shown.)` : "";
      text = `${text ? `${text}\n\n` : ""}Database with ${db.records.length} row${db.records.length === 1 ? "" : "s"}:\n\n${table}${more}`;
    }
  }
  if (text.length > MAX_PAGE_CHARS) text = `${text.slice(0, MAX_PAGE_CHARS)}\n\n(The rest of this page was cut off: it's very long.)`;
  return { title: titleOf(page), text: text || "(empty page)" };
}

/** Wraps a page for the model. */
export const pageBlock = (title: string, text: string) => `<page title="${title.replace(/"/g, "'")}">\n${text}\n</page>`;

/** Live pages and databases: id, title, kind, and the parent's title. */
async function catalog(workspaceId: string) {
  const s = workspaceStore(workspaceId);
  const [{ pages }, databases] = await Promise.all([listPages(s), listDatabases(s).catch(() => [])]);
  const rows = new Map(databases.map((d) => [d.pageId, d.recordCount]));
  const byId = new Map(pages.map((p) => [p.id, p]));
  return pages
    .filter((p) => !p.isTemplate)
    .map((p) => ({
      id: p.id,
      title: titleOf(p),
      icon: p.icon,
      database: rows.has(p.id) || p.kind === "DATABASE",
      rows: rows.get(p.id),
      parent: p.parentId ? titleOf(byId.get(p.parentId) ?? { title: "" }) : null,
      updatedAt: p.updatedAt,
    }));
}

/** The workspace's page and database titles, for the system prompt (most recently edited first). */
export async function workspaceIndex(workspaceId: string, max = 250): Promise<string> {
  const all = (await catalog(workspaceId).catch(() => [])).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  if (!all.length) return "";
  const lines = all.slice(0, max).map((p) => `- ${p.title}${p.database ? ` (database, ${rowsLabel(p.rows ?? 0)})` : ""}${p.parent ? ` (in ${p.parent})` : ""}`);
  const more = all.length > max ? `\n- … and ${all.length - max} more` : "";
  return `${lines.join("\n")}${more}`;
}

// Titles too generic to attach just because the word appears in a message.
const GENERIC = new Set(["untitled", "home", "notes", "note", "page", "pages", "todo", "tasks", "task", "ideas", "inbox", "draft", "test", "new page"]);

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Pages and databases a message refers to: [[Title]] links, and titles named in the text
 * (whole words, any case; at least 4 characters and not a generic word like "Notes").
 * Longer titles win where one contains another. At most `max`.
 */
export function mentionedTitles<T extends { id: string; title: string }>(text: string, pages: T[], max = 5): T[] {
  const found: T[] = [];
  const lower = text.toLowerCase();
  const links = [...text.matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => m[1].trim().toLowerCase());
  const sorted = [...pages].sort((a, b) => b.title.length - a.title.length);
  const taken: [number, number][] = [];
  for (const p of sorted) {
    if (found.length >= max) break;
    const t = p.title.trim().toLowerCase();
    if (!t) continue;
    if (links.includes(t)) {
      found.push(p);
      continue;
    }
    if (t.length < 4 || GENERIC.has(t)) continue;
    const m = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(t)}(?=$|[^\\p{L}\\p{N}])`, "u").exec(lower);
    if (!m) continue;
    const start = m.index + m[1].length;
    const end = start + t.length;
    if (taken.some(([a, b]) => start < b && end > a)) continue; // part of a longer title already found
    taken.push([start, end]);
    found.push(p);
  }
  return found;
}

/** Pages and databases named in a message that weren't attached by hand. */
export async function referencedPages(workspaceId: string, text: string, attached: ContextPage[]): Promise<ContextPage[]> {
  if (!text.trim()) return [];
  const all = await catalog(workspaceId).catch(() => []);
  const skip = new Set(attached.map((p) => p.id));
  return mentionedTitles(text, all.filter((p) => !skip.has(p.id))).map((p) => ({ id: p.id, title: p.title, icon: p.icon, auto: true }));
}

/** Tools to search and read the workspace, for API models. */
export function workspaceTools(workspaceId: string): ApiTool[] {
  const find = async (ref: string) => {
    const all = await catalog(workspaceId);
    const r = ref.trim().replace(/^\[\[|\]\]$/g, "").toLowerCase();
    return all.find((p) => p.id === ref.trim()) ?? all.find((p) => p.title.toLowerCase() === r) ?? all.find((p) => p.title.toLowerCase().includes(r));
  };
  return [
    {
      name: "search_workspace",
      description:
        "Search the user's Skele workspace (their notes, pages, databases and database rows, tasks and projects) for a word or phrase. Use it whenever the user refers to something of theirs you haven't seen.",
      parameters: { type: "object", properties: { query: { type: "string", description: "Word or phrase to find (or #tag)." } }, required: ["query"], additionalProperties: false },
      label: (a) => `Searched your notes for “${String(a.query ?? "")}”`,
      run: async (a) => {
        const r = await search(workspaceStore(workspaceId), String(a.query ?? ""));
        const lines = [
          ...r.pages.map((p) => `Page: ${titleOf(p)} [id ${p.id}]${p.snippet ? ` — ${p.snippet}` : ""}`),
          ...r.records.map((x) => `Row "${x.title || "Untitled"}" in database ${x.databaseTitle || "Untitled"} [page id ${x.pageId}]`),
          ...r.tasks.map((t) => `Task: ${t.title} (${t.status}${t.projectName ? `, project ${t.projectName}` : ""})`),
          ...r.projects.map((p) => `Project: ${p.name}`),
          ...r.tags.map((t) => `Tag: #${t}`),
        ];
        return { text: lines.length ? `${lines.join("\n")}\n\nUse read_page with a page id to read one.` : "Nothing found. Try another word, or list_pages." };
      },
    },
    {
      name: "list_pages",
      description: "List every page and database in the user's Skele workspace, with ids, newest first.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      label: () => "Listed your pages",
      run: async () => {
        const all = (await catalog(workspaceId)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        const lines = all.slice(0, 500).map((p) => `${p.title} [id ${p.id}]${p.database ? ` (database, ${rowsLabel(p.rows ?? 0)})` : ""}${p.parent ? ` (in ${p.parent})` : ""}`);
        return { text: lines.length ? lines.join("\n") + (all.length > 500 ? `\n… ${all.length - 500} more` : "") : "The workspace has no pages yet." };
      },
    },
    {
      name: "read_page",
      description: "Read one page of the user's Skele workspace as Markdown, by id or title. For a database, returns its rows as a table.",
      parameters: { type: "object", properties: { page: { type: "string", description: "The page's id (from search_workspace or list_pages) or its title." } }, required: ["page"], additionalProperties: false },
      label: (a) => `Read “${String(a.page ?? "")}”`,
      run: async (a) => {
        const p = await find(String(a.page ?? ""));
        if (!p) return { text: `No page called “${String(a.page ?? "")}”. Use search_workspace or list_pages to find it.`, isError: true };
        const { title, text } = await pageText(workspaceId, p.id);
        return { text: pageBlock(title, text) };
      },
    },
  ];
}
