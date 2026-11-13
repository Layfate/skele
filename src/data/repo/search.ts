import type { WorkspaceStore } from "../store";

function snippet(text: string, q: string) {
  const i = text.toLowerCase().indexOf(q);
  if (i < 0) return null;
  const start = Math.max(0, i - 50);
  return (start > 0 ? "…" : "") + text.slice(start, i + q.length + 110).replace(/\s+/g, " ");
}

/** In-memory search over the whole workspace (fast enough for tens of thousands of items). */
export async function search(s: WorkspaceStore, rawQuery: string) {
  const query = rawQuery.trim().slice(0, 200);
  const empty = { pages: [], tasks: [], projects: [], records: [], tags: [] };
  if (!query) return empty;
  const tagOnly = query.startsWith("#");
  const q = (tagOnly ? query.slice(1) : query).toLowerCase();
  if (!q) return empty;

  const [pages, contents, tasks, projects, records, databases] = await Promise.all([
    s.t("pages").all(),
    s.t("contents").all(),
    s.t("tasks").all(),
    s.t("projects").all(),
    s.t("records").all(),
    s.t("databases").all(),
  ]);
  const live = new Map(pages.filter((p) => !p.archivedAt).map((p) => [p.id, p]));
  const contentById = new Map(contents.map((c) => [c.pageId, c]));
  const projectById = new Map(projects.map((p) => [p.id, p]));

  const allTags = new Map<string, number>();
  for (const c of contents) if (live.has(c.pageId)) for (const t of c.tags ?? []) allTags.set(t, (allTags.get(t) ?? 0) + 1);
  for (const p of live.values()) for (const t of p.tags) allTags.set(t, (allTags.get(t) ?? 0) + 1);

  const pageHits = [...live.values()]
    .map((p) => {
      const c = contentById.get(p.id);
      const tags = [...new Set([...(c?.tags ?? []), ...p.tags])];
      if (tagOnly) return tags.some((t) => t === q || t.startsWith(`${q}/`)) ? { p, score: 2, snip: null } : null;
      const title = p.title.toLowerCase();
      const titleHit = title.includes(q);
      const snip = !titleHit && c ? snippet(c.text, q) : null;
      if (!titleHit && !snip) return null;
      return { p, score: titleHit ? (title.startsWith(q) ? 3 : 2) : 1, snip };
    })
    .filter((h): h is NonNullable<typeof h> => !!h)
    .sort((a, b) => b.score - a.score || b.p.updatedAt.localeCompare(a.p.updatedAt))
    .slice(0, 12)
    .map(({ p, snip }) => ({ id: p.id, title: p.title, icon: p.icon, kind: p.kind, snippet: snip }));

  if (tagOnly) {
    return { ...empty, pages: pageHits, tags: [...allTags.keys()].filter((t) => t.startsWith(q)).slice(0, 8) };
  }

  const taskHits = tasks
    .filter((t) => t.title.toLowerCase().includes(q) && !(t.projectId && projectById.get(t.projectId)?.archivedAt))
    .slice(0, 8)
    .map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      projectId: t.projectId,
      projectName: t.projectId ? (projectById.get(t.projectId)?.name ?? null) : null,
    }));

  const projectHits = projects
    .filter((p) => !p.archivedAt && p.name.toLowerCase().includes(q))
    .slice(0, 6)
    .map((p) => ({ id: p.id, name: p.name, icon: p.icon, color: p.color }));

  const dbById = new Map(databases.map((d) => [d.id, d]));
  const recordHits = records
    .filter((r) => {
      const page = live.get(dbById.get(r.databaseId)?.pageId ?? "");
      return page && (r.title.toLowerCase().includes(q) || r.text.toLowerCase().includes(q));
    })
    .slice(0, 8)
    .map((r) => {
      const page = live.get(dbById.get(r.databaseId)!.pageId)!;
      return { id: r.id, title: r.title, icon: r.icon, pageId: page.id, databaseTitle: page.title };
    });

  const tagHits = [...allTags.keys()].filter((t) => t.includes(q)).slice(0, 5);
  return { pages: pageHits, tasks: taskHits, projects: projectHits, records: recordHits, tags: tagHits };
}

/** Every tag with its usage count. */
export async function listTags(s: WorkspaceStore) {
  const [pages, contents] = await Promise.all([s.t("pages").all(), s.t("contents").all()]);
  const live = new Set(pages.filter((p) => !p.archivedAt).map((p) => p.id));
  const counts = new Map<string, number>();
  for (const c of contents) if (live.has(c.pageId)) for (const t of c.tags ?? []) counts.set(t, (counts.get(t) ?? 0) + 1);
  for (const p of pages) if (live.has(p.id)) for (const t of p.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}
