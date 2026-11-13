import { extractLinks, extractTags, extractText, gettingStartedDoc, sanitizeDoc } from "@/features/editor/doc";
import { rankAfter, rankBetween } from "@/lib/rank";
import { badRequest, byRank, conflict, newId, notFound, now } from "../common";
import type { WorkspaceStore } from "../store";
import type { Page, PageContent, PageKind } from "../types";
import { createDatabaseForPage, copyDatabase } from "./databases";

const MAX_DOC_BYTES = 5_000_000;
const EMPTY_DOC = { type: "doc", content: [] };

async function findPage(s: WorkspaceStore, id: string) {
  const page = await s.t("pages").get(id);
  if (!page) throw notFound("Page not found");
  return page;
}

/** `id` and every descendant id (any archive state). */
export function subtree(pages: Page[], id: string): Set<string> {
  const out = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const p of pages) {
      if (p.parentId && out.has(p.parentId) && !out.has(p.id)) {
        out.add(p.id);
        grew = true;
      }
    }
  }
  return out;
}

function ancestors(pages: Map<string, Page>, id: string) {
  const chain: Page[] = [];
  let cur = pages.get(id);
  const seen = new Set<string>();
  while (cur && !seen.has(cur.id) && chain.length < 200) {
    seen.add(cur.id);
    chain.unshift(cur);
    cur = cur.parentId ? pages.get(cur.parentId) : undefined;
  }
  return chain;
}

const live = (p: Page) => !p.archivedAt;

function lastRank(pages: Page[], parentId: string | null) {
  return pages.filter((p) => live(p) && p.parentId === parentId).sort(byRank).at(-1)?.rank ?? null;
}

// ───────────── Queries ─────────────

export async function listPages(s: WorkspaceStore) {
  const [pages, favorites] = await Promise.all([s.t("pages").all(), s.t("favorites").all()]);
  const livePages = pages.filter(live).sort(byRank);
  const liveIds = new Set(livePages.map((p) => p.id));
  return {
    pages: livePages,
    favoriteIds: favorites
      .filter((f) => liveIds.has(f.pageId))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((f) => f.pageId),
  };
}

export async function getPage(s: WorkspaceStore, id: string) {
  const page = await findPage(s, id);
  const [all, content, favorite, databases] = await Promise.all([
    s.t("pages").all(),
    s.t("contents").get(id),
    s.t("favorites").get(id),
    s.t("databases").where("pageId", id),
  ]);
  const byId = new Map(all.map((p) => [p.id, p]));
  return {
    ...page,
    content: {
      doc: content?.doc ?? EMPTY_DOC,
      version: content?.version ?? 0,
      updatedAt: content?.updatedAt ?? page.updatedAt,
    },
    breadcrumbs: ancestors(byId, id).map((p) => ({ id: p.id, title: p.title, icon: p.icon })),
    isFavorite: !!favorite,
    database: databases[0] ? { id: databases[0].id } : null,
    canEdit: !page.archivedAt,
  };
}

export async function listRecent(s: WorkspaceStore, take = 12) {
  const [visits, pages] = await Promise.all([s.t("visits").all(), s.t("pages").all()]);
  const byId = new Map(pages.filter(live).map((p) => [p.id, p]));
  return visits
    .filter((v) => byId.has(v.pageId))
    .sort((a, b) => b.visitedAt.localeCompare(a.visitedAt))
    .slice(0, take)
    .map((v) => ({ ...byId.get(v.pageId)!, visitedAt: v.visitedAt }));
}

export async function listRecentlyEdited(s: WorkspaceStore, take = 12) {
  const pages = (await s.t("pages").all()).filter(live);
  return pages.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, take);
}

export async function listTrash(s: WorkspaceStore) {
  const pages = await s.t("pages").all();
  // Only the roots of archive actions — their descendants come back with them.
  return pages
    .filter((p) => p.archivedAt && p.archivedRootId === p.id)
    .sort((a, b) => b.archivedAt!.localeCompare(a.archivedAt!));
}

// ───────────── Mutations ─────────────

export type CreatePageInput = {
  parentId?: string | null;
  title?: string;
  icon?: string | null;
  kind?: PageKind;
  afterId?: string | null;
  doc?: unknown;
  isTemplate?: boolean;
  tags?: string[];
  properties?: Record<string, string>;
};

export async function createPage(s: WorkspaceStore, input: CreatePageInput = {}) {
  return s.transaction(async () => {
    const pages = await s.t("pages").all();
    const parentId = input.parentId ?? null;
    if (parentId) {
      const parent = pages.find((p) => p.id === parentId);
      if (!parent) throw notFound("Parent page not found");
      if (parent.archivedAt) throw badRequest("Can't add a page inside a trashed page");
    }
    let rank: string;
    if (input.afterId) {
      const after = pages.find((p) => p.id === input.afterId);
      if (!after) throw notFound("Page not found");
      const next = pages.filter((p) => live(p) && p.parentId === parentId && p.rank > after.rank).sort(byRank)[0];
      rank = rankBetween(after.rank, next?.rank);
    } else {
      rank = rankAfter(lastRank(pages, parentId));
    }
    const title = (input.title ?? "").slice(0, 255);
    const page: Page = {
      id: newId(),
      parentId,
      kind: input.kind ?? "DOCUMENT",
      title,
      icon: input.icon ?? null,
      cover: null,
      coverPosition: 50,
      rank,
      pinned: false,
      fullWidth: false,
      isTemplate: input.isTemplate ?? false,
      tags: input.tags ?? [],
      properties: input.properties ?? {},
      archivedAt: null,
      archivedRootId: null,
      createdAt: now(),
      updatedAt: now(),
    };
    await s.t("pages").put(page);
    const doc = sanitizeDoc(input.doc ?? EMPTY_DOC);
    const text = extractText(doc);
    await s.t("contents").put({ pageId: page.id, doc, text, tags: extractTags(text), version: 0, updatedAt: now() });
    if (input.doc) await indexLinks(s, page.id, doc);
    if (page.kind === "DATABASE") await createDatabaseForPage(s, page.id);
    return page;
  });
}

export type UpdatePageInput = Partial<
  Pick<Page, "title" | "icon" | "cover" | "coverPosition" | "pinned" | "fullWidth" | "isTemplate" | "tags" | "properties">
>;

export async function updatePage(s: WorkspaceStore, id: string, input: UpdatePageInput) {
  return s.transaction(async () => {
    const page = await findPage(s, id);
    if (page.archivedAt) throw badRequest("Restore the page before editing it");
    const patch: Partial<Page> = { ...input, updatedAt: now() };
    if (patch.title !== undefined) patch.title = patch.title.slice(0, 255);
    if (patch.tags) patch.tags = [...new Set(patch.tags.map((t) => t.trim().replace(/^#/, "")).filter(Boolean))];
    await s.t("pages").update(id, patch);
    return { ...page, ...patch } as Page;
  });
}

export async function movePage(
  s: WorkspaceStore,
  id: string,
  input: { parentId: string | null; beforeId?: string | null; afterId?: string | null },
) {
  return s.transaction(async () => {
    const pages = await s.t("pages").all();
    const byId = new Map(pages.map((p) => [p.id, p]));
    const page = byId.get(id);
    if (!page) throw notFound("Page not found");
    if (page.archivedAt) throw badRequest("Restore the page before moving it");
    const parentId = input.parentId;
    if (parentId) {
      if (parentId === id) throw badRequest("A page can't be moved inside itself");
      const parent = byId.get(parentId);
      if (!parent) throw notFound("Page not found");
      if (parent.archivedAt) throw badRequest("Can't move a page into a trashed page");
      if (ancestors(byId, parentId).some((a) => a.id === id)) {
        throw badRequest("A page can't be moved inside one of its own subpages");
      }
    }
    const neighbour = (nid?: string | null) => {
      if (!nid || nid === id) return null;
      const n = byId.get(nid);
      return n && live(n) && n.parentId === parentId ? n.rank : null;
    };
    const before = neighbour(input.beforeId);
    const after = neighbour(input.afterId);
    const rank = before || after ? rankBetween(before, after) : rankAfter(lastRank(pages.filter((p) => p.id !== id), parentId));
    const moved = { ...page, parentId, rank, updatedAt: now() };
    await s.t("pages").put(moved);
    return moved;
  });
}

export async function archivePage(s: WorkspaceStore, id: string) {
  await s.transaction(async () => {
    const pages = await s.t("pages").all();
    const page = pages.find((p) => p.id === id);
    if (!page) throw notFound("Page not found");
    if (page.archivedAt) return;
    const ids = subtree(pages, id);
    const ts = now();
    // Pages already in the trash keep their own archive root so they restore independently.
    await s.t("pages").bulkPut(
      pages.filter((p) => ids.has(p.id) && !p.archivedAt).map((p) => ({ ...p, archivedAt: ts, archivedRootId: id, pinned: false })),
    );
  });
}

export async function restorePage(s: WorkspaceStore, id: string) {
  return s.transaction(async () => {
    const pages = await s.t("pages").all();
    const page = pages.find((p) => p.id === id);
    if (!page) throw notFound("Page not found");
    if (!page.archivedAt) return { id, parentId: page.parentId };
    let parentId = page.parentId;
    if (parentId) {
      const parent = pages.find((p) => p.id === parentId);
      // Parent still in the trash (or gone) → bring this page back at the top level.
      if (!parent || parent.archivedAt) parentId = null;
    }
    const rank = rankAfter(lastRank(pages, parentId));
    const ids = subtree(pages, id);
    const root = page.archivedRootId ?? id;
    const restored = pages
      .filter((p) => ids.has(p.id) && p.archivedAt && p.archivedRootId === root)
      .map((p) => ({ ...p, archivedAt: null, archivedRootId: null }));
    await s.t("pages").bulkPut(restored);
    await s.t("pages").update(id, { parentId, rank, archivedAt: null, archivedRootId: null });
    return { id, parentId };
  });
}

/** Deletes pages and everything that belongs to them. */
async function deletePages(s: WorkspaceStore, ids: Set<string>) {
  const idList = [...ids];
  const databases = (await s.t("databases").all()).filter((d) => ids.has(d.pageId));
  for (const d of databases) {
    const [props, records, views] = await Promise.all([
      s.t("properties").where("databaseId", d.id),
      s.t("records").where("databaseId", d.id),
      s.t("views").where("databaseId", d.id),
    ]);
    await s.t("properties").bulkDelete(props.map((p) => p.id));
    await s.t("records").bulkDelete(records.map((r) => r.id));
    await s.t("views").bulkDelete(views.map((v) => v.id));
    await s.t("databases").delete(d.id);
  }
  const files = (await s.t("files").all({ skipBlobs: true })).filter((f) => f.pageId && ids.has(f.pageId));
  await s.t("files").bulkDelete(files.map((f) => f.id));
  const links = (await s.t("links").all()).filter((l) => ids.has(l.fromId) || ids.has(l.toId));
  await s.t("links").bulkDelete(links.map((l) => l.id));
  // Tasks linked to a deleted note keep existing, just without the link.
  const tasks = (await s.t("tasks").all()).filter((t) => t.pageId && ids.has(t.pageId));
  await s.t("tasks").bulkPut(tasks.map((t) => ({ ...t, pageId: null })));
  await s.t("contents").bulkDelete(idList);
  await s.t("favorites").bulkDelete(idList);
  await s.t("visits").bulkDelete(idList);
  await s.t("pages").bulkDelete(idList);
}

export async function purgePage(s: WorkspaceStore, id: string) {
  await s.transaction(async () => {
    const pages = await s.t("pages").all();
    const page = pages.find((p) => p.id === id);
    if (!page) throw notFound("Page not found");
    if (!page.archivedAt) throw badRequest("Move the page to the trash first");
    await deletePages(s, subtree(pages, id));
  });
}

export async function emptyTrash(s: WorkspaceStore) {
  return s.transaction(async () => {
    const pages = await s.t("pages").all();
    const ids = new Set(pages.filter((p) => p.archivedAt).map((p) => p.id));
    await deletePages(s, ids);
    return { count: ids.size };
  });
}

/** Deep-copies a page subtree (content, databases, records). */
export async function duplicatePage(s: WorkspaceStore, id: string) {
  return s.transaction(async () => {
    const pages = await s.t("pages").all();
    const root = pages.find((p) => p.id === id);
    if (!root) throw notFound("Page not found");
    if (root.archivedAt) throw badRequest("Restore the page before duplicating it");
    const ids = subtree(pages, id);
    if (ids.size > 500) throw badRequest("That page tree is too large to duplicate at once");
    const next = pages.filter((p) => live(p) && p.parentId === root.parentId && p.rank > root.rank).sort(byRank)[0];
    const idMap = new Map<string, string>();

    const copy = async (oldId: string, newParentId: string | null, rank: string, isRoot: boolean) => {
      const src = pages.find((p) => p.id === oldId)!;
      const content = await s.t("contents").get(oldId);
      const created: Page = {
        ...src,
        id: newId(),
        parentId: newParentId,
        title: isRoot ? `${src.title || "Untitled"} (copy)` : src.title,
        rank,
        pinned: false,
        archivedAt: null,
        archivedRootId: null,
        createdAt: now(),
        updatedAt: now(),
      };
      await s.t("pages").put(created);
      await s.t("contents").put({
        pageId: created.id,
        doc: content?.doc ?? EMPTY_DOC,
        text: content?.text ?? "",
        tags: content?.tags ?? [],
        version: 0,
        updatedAt: now(),
      });
      idMap.set(oldId, created.id);
      const [db] = await s.t("databases").where("pageId", oldId);
      if (db) await copyDatabase(s, db.id, created.id);
      const children = pages.filter((p) => p.parentId === oldId && live(p)).sort(byRank);
      for (const child of children) await copy(child.id, created.id, child.rank, false);
    };

    await copy(id, root.parentId, rankBetween(root.rank, next?.rank), true);
    return { id: idMap.get(id)! };
  });
}

/** Rebuilds the `[[link]]` index for one page and syncs its inline #tags. */
async function indexLinks(s: WorkspaceStore, pageId: string, doc: unknown) {
  const old = await s.t("links").where("fromId", pageId);
  await s.t("links").bulkDelete(old.map((l) => l.id));
  const targets = [...new Set(extractLinks(doc))].filter((t) => t !== pageId);
  await s.t("links").bulkPut(targets.map((toId) => ({ id: `${pageId}>${toId}`, fromId: pageId, toId })));
}

export async function saveContent(s: WorkspaceStore, pageId: string, input: { doc: unknown; version: number }) {
  const doc = sanitizeDoc(input.doc);
  if (JSON.stringify(doc).length > MAX_DOC_BYTES) throw badRequest("This page is too large to save");
  const text = extractText(doc);
  return s.transaction(async () => {
    const page = await findPage(s, pageId);
    if (page.archivedAt) throw badRequest("Restore the page before editing it");
    const current = await s.t("contents").get(pageId);
    const version = current?.version ?? 0;
    // Optimistic concurrency: another tab may have saved a newer version.
    if (current && version !== input.version) throw conflict("This page was changed somewhere else", { version });
    const row: PageContent = { pageId, doc, text, tags: extractTags(text), version: version + 1, updatedAt: now() };
    await s.t("contents").put(row);
    await indexLinks(s, pageId, doc);
    await s.t("pages").update(pageId, { updatedAt: now() });
    return { version: row.version };
  });
}

export async function setFavorite(s: WorkspaceStore, pageId: string, favorite: boolean) {
  await findPage(s, pageId);
  if (favorite) await s.t("favorites").put({ pageId, createdAt: now() });
  else await s.t("favorites").delete(pageId);
}

export async function recordVisit(s: WorkspaceStore, pageId: string) {
  if (!(await s.t("pages").get(pageId))) return;
  await s.t("visits").put({ pageId, visitedAt: now() });
}

/** Starter page for a new workspace. */
export async function createStarterContent(s: WorkspaceStore) {
  await createPage(s, { title: "Getting started", icon: "👋", doc: gettingStartedDoc() });
}

// ───────────── Daily notes & templates ─────────────

const DAILY_FOLDER = "Daily notes";

/** Opens (creating if needed) the note for a day, inside a "Daily notes" folder page. */
export async function openDailyNote(s: WorkspaceStore, date = new Date()) {
  const title = date.toLocaleDateString("en-CA"); // YYYY-MM-DD, sortable
  return s.transaction(async () => {
    const pages = (await s.t("pages").all()).filter(live);
    let folder = pages.find((p) => p.parentId === null && p.title === DAILY_FOLDER && p.properties.skele === "daily-folder");
    folder ??= await createPage(s, { title: DAILY_FOLDER, icon: "🗓️", properties: { skele: "daily-folder" } });
    const existing = pages.find((p) => p.parentId === folder!.id && p.title === title);
    if (existing) return existing;
    const template = pages.find((p) => p.isTemplate && p.properties.skele === "daily-template");
    const doc = template ? (await s.t("contents").get(template.id))?.doc : undefined;
    return createPage(s, {
      parentId: folder.id,
      title,
      icon: "📝",
      doc: doc ?? { type: "doc", content: [{ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Today" }] }, { type: "paragraph" }] },
      properties: { date: title },
    });
  });
}

export async function listTemplates(s: WorkspaceStore) {
  return (await s.t("pages").all()).filter((p) => live(p) && p.isTemplate).sort((a, b) => a.title.localeCompare(b.title));
}

/** New page whose content (and icon/tags) is copied from a template page. */
export async function createFromTemplate(s: WorkspaceStore, templateId: string, parentId: string | null = null) {
  const template = await findPage(s, templateId);
  const content = await s.t("contents").get(templateId);
  return createPage(s, {
    parentId,
    title: template.title.replace(/\s*template$/i, ""),
    icon: template.icon,
    tags: template.tags,
    doc: content?.doc,
  });
}

// ───────────── Backlinks & mentions ─────────────

function context(text: string, needle: string) {
  const i = text.toLowerCase().indexOf(needle.toLowerCase());
  if (i < 0) return text.slice(0, 140);
  const start = Math.max(0, i - 60);
  return (start ? "…" : "") + text.slice(start, i + needle.length + 80).replace(/\s+/g, " ");
}

/** Pages that `[[link]]` to this page. */
export async function listBacklinks(s: WorkspaceStore, pageId: string) {
  const page = await findPage(s, pageId);
  const links = await s.t("links").where("toId", pageId);
  const sources = (await s.t("pages").bulkGet(links.map((l) => l.fromId))).filter((p): p is Page => !!p && !p.archivedAt);
  const contents = await s.t("contents").bulkGet(sources.map((p) => p.id));
  return sources.map((p, i) => ({ id: p.id, title: p.title, icon: p.icon, kind: p.kind, snippet: context(contents[i]?.text ?? "", page.title) }));
}

/** Pages that mention this page's title in plain text without linking to it. */
export async function listUnlinkedMentions(s: WorkspaceStore, pageId: string) {
  const page = await findPage(s, pageId);
  const title = page.title.trim();
  if (title.length < 3) return [];
  const [pages, contents, links] = await Promise.all([s.t("pages").all(), s.t("contents").all(), s.t("links").where("toId", pageId)]);
  const linked = new Set(links.map((l) => l.fromId));
  const byId = new Map(pages.filter(live).map((p) => [p.id, p]));
  const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(String.raw`(^|[^\p{L}\p{N}])` + escaped + String.raw`($|[^\p{L}\p{N}])`, "iu");
  return contents
    .filter((c) => c.pageId !== pageId && !linked.has(c.pageId) && byId.has(c.pageId) && re.test(c.text))
    .slice(0, 50)
    .map((c) => {
      const p = byId.get(c.pageId)!;
      return { id: p.id, title: p.title, icon: p.icon, kind: p.kind, snippet: context(c.text, title) };
    });
}

/** All link edges between live pages, plus every live page (for the graph view). */
export async function linkGraph(s: WorkspaceStore) {
  const [pages, links, contents] = await Promise.all([s.t("pages").all(), s.t("links").all(), s.t("contents").all()]);
  const livePages = pages.filter(live);
  const ids = new Set(livePages.map((p) => p.id));
  const tagsById = new Map(contents.map((c) => [c.pageId, c.tags ?? []]));
  return {
    nodes: livePages.map((p) => ({
      id: p.id,
      title: p.title || "Untitled",
      icon: p.icon,
      kind: p.kind,
      parentId: p.parentId,
      tags: [...new Set([...p.tags, ...(tagsById.get(p.id) ?? [])])],
    })),
    links: links.filter((l) => ids.has(l.fromId) && ids.has(l.toId)).map((l) => ({ source: l.fromId, target: l.toId })),
  };
}
