import type { WorkspaceStore } from "../store";

export type CalendarEntry = {
  id: string;
  kind: "task" | "record" | "note";
  date: string;
  title: string;
  icon: string | null;
  done: boolean;
  /** For records: the database page and the date property. */
  pageId?: string;
  propertyId?: string;
  recordId?: string;
  context?: string;
};

/** Everything with a date in the workspace: task due dates, record date properties, daily notes. */
export async function calendarEntries(s: WorkspaceStore): Promise<CalendarEntry[]> {
  const [tasks, projects, records, properties, databases, pages] = await Promise.all([
    s.t("tasks").all(),
    s.t("projects").all(),
    s.t("records").all(),
    s.t("properties").all(),
    s.t("databases").all(),
    s.t("pages").all(),
  ]);
  const archivedProjects = new Set(projects.filter((p) => p.archivedAt).map((p) => p.id));
  const projectName = new Map(projects.map((p) => [p.id, p.name]));
  const livePages = new Map(pages.filter((p) => !p.archivedAt).map((p) => [p.id, p]));
  const dbPage = new Map(databases.map((d) => [d.id, d.pageId]));
  const dateProps = properties.filter((p) => p.type === "DATE");
  const out: CalendarEntry[] = [];

  for (const t of tasks) {
    if (!t.dueDate || t.status === "CANCELLED" || (t.projectId && archivedProjects.has(t.projectId))) continue;
    out.push({
      id: `t:${t.id}`,
      kind: "task",
      date: t.dueDate.slice(0, 10),
      title: t.title,
      icon: null,
      done: t.status === "COMPLETED",
      context: t.projectId ? projectName.get(t.projectId) : undefined,
    });
  }
  for (const prop of dateProps) {
    const pageId = dbPage.get(prop.databaseId);
    const page = pageId ? livePages.get(pageId) : undefined;
    if (!page) continue;
    for (const r of records) {
      const v = r.databaseId === prop.databaseId ? r.values[prop.id] : undefined;
      if (typeof v !== "string") continue;
      out.push({
        id: `r:${r.id}:${prop.id}`,
        kind: "record",
        date: v.slice(0, 10),
        title: r.title || "Untitled",
        icon: r.icon,
        done: false,
        pageId: page.id,
        propertyId: prop.id,
        recordId: r.id,
        context: `${page.title || "Untitled"} · ${prop.name}`,
      });
    }
  }
  for (const p of livePages.values()) {
    const date = p.properties.date;
    if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
      out.push({ id: `n:${p.id}`, kind: "note", date, title: p.title || date, icon: p.icon, done: false, pageId: p.id });
    }
  }
  return out;
}
