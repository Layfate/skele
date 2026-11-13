import type { ProjectStatus, TaskPriority, TaskStatus } from "@/features/projects/schemas";
import { rankAfter, rankBetween } from "@/lib/rank";
import { badRequest, byRank, newId, notFound, now } from "../common";
import type { WorkspaceStore } from "../store";
import type { Label, Project, Task } from "../types";

const toDate = (v: string | null | undefined) => (v === undefined ? undefined : v === null ? null : new Date(v).toISOString());
const clean = (v: string | null | undefined, max = 120) => (v == null ? v : v.trim().slice(0, max) || null);

// ───────────── Projects ─────────────

export type Counts = { total: number; completed: number; cancelled: number };

function countTasks(tasks: Task[]) {
  const map = new Map<string, Counts>();
  for (const t of tasks) {
    if (!t.projectId || t.parentId) continue;
    const c = map.get(t.projectId) ?? { total: 0, completed: 0, cancelled: 0 };
    c.total += 1;
    if (t.status === "COMPLETED") c.completed += 1;
    if (t.status === "CANCELLED") c.cancelled += 1;
    map.set(t.projectId, c);
  }
  return map;
}

export async function listProjects(s: WorkspaceStore, includeArchived = false) {
  const [projects, tasks] = await Promise.all([s.t("projects").all(), s.t("tasks").all()]);
  const counts = countTasks(tasks);
  return projects
    .filter((p) => includeArchived || !p.archivedAt)
    .sort(byRank)
    .map((p) => ({ ...p, counts: counts.get(p.id) ?? { total: 0, completed: 0, cancelled: 0 } }));
}

export async function getProject(s: WorkspaceStore, id: string) {
  const project = await s.t("projects").get(id);
  if (!project) throw notFound("Project not found");
  const counts = countTasks(await s.t("tasks").where("projectId", id)).get(id) ?? { total: 0, completed: 0, cancelled: 0 };
  return { ...project, counts, canEdit: true };
}

export type ProjectInput = {
  name?: string;
  description?: string;
  icon?: string | null;
  color?: string;
  status?: ProjectStatus;
  startDate?: string | null;
  targetDate?: string | null;
  lead?: string | null;
  archived?: boolean;
};

export async function createProject(s: WorkspaceStore, input: ProjectInput & { name: string }) {
  return s.transaction(async () => {
    const name = input.name.trim().slice(0, 120);
    if (!name) throw badRequest("Name is required");
    const projects = (await s.t("projects").all()).sort(byRank);
    const project: Project = {
      id: newId(),
      name,
      description: (input.description ?? "").slice(0, 5000),
      icon: input.icon ?? null,
      color: input.color ?? "indigo",
      status: input.status ?? "ACTIVE",
      startDate: toDate(input.startDate) ?? null,
      targetDate: toDate(input.targetDate) ?? null,
      lead: clean(input.lead) ?? null,
      rank: rankAfter(projects.at(-1)?.rank),
      archivedAt: null,
      createdAt: now(),
      updatedAt: now(),
    };
    await s.t("projects").put(project);
    return project;
  });
}

export async function updateProject(s: WorkspaceStore, id: string, input: ProjectInput) {
  return s.transaction(async () => {
    const project = await s.t("projects").get(id);
    if (!project) throw notFound("Project not found");
    const { archived, startDate, targetDate, lead, name, ...rest } = input;
    if (name !== undefined && !name.trim()) throw badRequest("Name is required");
    const updated: Project = {
      ...project,
      ...rest,
      name: name !== undefined ? name.trim().slice(0, 120) : project.name,
      startDate: startDate !== undefined ? (toDate(startDate) ?? null) : project.startDate,
      targetDate: targetDate !== undefined ? (toDate(targetDate) ?? null) : project.targetDate,
      lead: lead !== undefined ? (clean(lead) ?? null) : project.lead,
      archivedAt: archived === undefined ? project.archivedAt : archived ? now() : null,
      updatedAt: now(),
    };
    await s.t("projects").put(updated);
    return updated;
  });
}

export async function deleteProject(s: WorkspaceStore, id: string) {
  await s.transaction(async () => {
    if (!(await s.t("projects").get(id))) throw notFound("Project not found");
    const tasks = await s.t("tasks").where("projectId", id);
    await deleteTaskRows(s, tasks.map((t) => t.id));
    await s.t("projects").delete(id);
  });
}

// ───────────── Tasks ─────────────

export type TaskQuery = {
  projectId?: string;
  status?: TaskStatus[];
  priority?: TaskPriority[];
  labelId?: string;
  assignee?: string;
  q?: string;
  includeSubtasks?: boolean;
  pageId?: string;
  /** Only tasks without a project. */
  inbox?: boolean;
};

/** Adds the related objects the UI shows next to a task. */
async function enrich(s: WorkspaceStore, tasks: Task[]) {
  const [projects, labels, all, comments] = await Promise.all([
    s.t("projects").all(),
    s.t("labels").all(),
    s.t("tasks").all(),
    s.t("comments").all(),
  ]);
  const projectById = new Map(projects.map((p) => [p.id, p]));
  const labelById = new Map(labels.map((l) => [l.id, l]));
  const subCount = new Map<string, number>();
  for (const t of all) if (t.parentId) subCount.set(t.parentId, (subCount.get(t.parentId) ?? 0) + 1);
  const commentCount = new Map<string, number>();
  for (const c of comments) commentCount.set(c.taskId, (commentCount.get(c.taskId) ?? 0) + 1);
  return tasks.map((t) => {
    const p = t.projectId ? projectById.get(t.projectId) : undefined;
    return {
      ...t,
      project: p ? { id: p.id, name: p.name, icon: p.icon, color: p.color } : null,
      labels: t.labelIds.map((id) => labelById.get(id)).filter((l): l is Label => !!l),
      _count: { subtasks: subCount.get(t.id) ?? 0, comments: commentCount.get(t.id) ?? 0 },
    };
  });
}

export type TaskWithRelations = Awaited<ReturnType<typeof enrich>>[number];

export async function listTasks(s: WorkspaceStore, query: TaskQuery = {}) {
  const [tasks, projects] = await Promise.all([s.t("tasks").all(), s.t("projects").all()]);
  const archived = new Set(projects.filter((p) => p.archivedAt).map((p) => p.id));
  const q = query.q?.trim().toLowerCase();
  const filtered = tasks.filter(
    (t) =>
      (!t.projectId || !archived.has(t.projectId) || t.projectId === query.projectId) &&
      (!query.projectId || t.projectId === query.projectId) &&
      (!query.status?.length || query.status.includes(t.status)) &&
      (!query.priority?.length || query.priority.includes(t.priority)) &&
      (!query.labelId || t.labelIds.includes(query.labelId)) &&
      (!query.assignee || t.assignee === query.assignee) &&
      (!query.pageId || t.pageId === query.pageId) &&
      (!query.inbox || !t.projectId) &&
      (!q || t.title.toLowerCase().includes(q)) &&
      (query.includeSubtasks || !t.parentId),
  );
  return enrich(s, filtered.sort(byRank));
}

export async function getTask(s: WorkspaceStore, id: string) {
  const task = await s.t("tasks").get(id);
  if (!task) throw notFound("Task not found");
  const [subtasks, comments, parent, linkedPage] = await Promise.all([
    s.t("tasks").where("parentId", id),
    s.t("comments").where("taskId", id),
    task.parentId ? s.t("tasks").get(task.parentId) : Promise.resolve(undefined),
    task.pageId ? s.t("pages").get(task.pageId) : Promise.resolve(undefined),
  ]);
  const [enriched] = await enrich(s, [task]);
  return {
    ...enriched,
    parent: parent ? { id: parent.id, title: parent.title } : null,
    page: linkedPage && !linkedPage.archivedAt ? { id: linkedPage.id, title: linkedPage.title, icon: linkedPage.icon } : null,
    subtasks: await enrich(s, subtasks.sort(byRank)),
    comments: comments
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((c) => ({ id: c.id, body: c.body, createdAt: c.createdAt, author: { id: c.author, name: c.author } })),
    canEdit: true,
  };
}

async function assertRefs(s: WorkspaceStore, input: { projectId?: string | null; labelIds?: string[]; pageId?: string | null }) {
  if (input.projectId && !(await s.t("projects").get(input.projectId))) throw notFound("Project not found");
  if (input.pageId && !(await s.t("pages").get(input.pageId))) throw notFound("Page not found");
  if (input.labelIds?.length) {
    const found = await s.t("labels").bulkGet(input.labelIds);
    if (found.some((l) => !l)) throw badRequest("Unknown label");
  }
}

export type TaskInput = {
  title?: string;
  description?: string;
  projectId?: string | null;
  parentId?: string | null;
  pageId?: string | null;
  status?: TaskStatus;
  priority?: TaskPriority;
  dueDate?: string | null;
  assignee?: string | null;
  labelIds?: string[];
};

export async function createTask(s: WorkspaceStore, input: TaskInput & { title: string }) {
  return s.transaction(async () => {
    const title = input.title.trim().slice(0, 500);
    if (!title) throw badRequest("Title is required");
    let projectId = input.projectId ?? null;
    if (input.parentId) {
      const parent = await s.t("tasks").get(input.parentId);
      if (!parent) throw notFound("Parent task not found");
      if (parent.parentId) throw badRequest("Subtasks can't have their own subtasks");
      projectId = parent.projectId;
    }
    await assertRefs(s, { projectId, labelIds: input.labelIds, pageId: input.pageId });
    const siblings = (await s.t("tasks").all()).filter((t) => t.projectId === projectId && t.parentId === (input.parentId ?? null)).sort(byRank);
    const status = input.status ?? "NOT_STARTED";
    const task: Task = {
      id: newId(),
      projectId,
      parentId: input.parentId ?? null,
      pageId: input.pageId ?? null,
      title,
      description: (input.description ?? "").slice(0, 20_000),
      status,
      priority: input.priority ?? "MEDIUM",
      dueDate: toDate(input.dueDate) ?? null,
      assignee: clean(input.assignee, 80) ?? null,
      labelIds: [...new Set(input.labelIds ?? [])],
      rank: rankAfter(siblings.at(-1)?.rank),
      completedAt: status === "COMPLETED" ? now() : null,
      createdAt: now(),
      updatedAt: now(),
    };
    await s.t("tasks").put(task);
    const [enriched] = await enrich(s, [task]);
    return enriched;
  });
}

export async function updateTask(s: WorkspaceStore, id: string, input: TaskInput) {
  return s.transaction(async () => {
    const task = await s.t("tasks").get(id);
    if (!task) throw notFound("Task not found");
    if (input.projectId !== undefined && task.parentId) throw badRequest("Move the parent task instead");
    if (input.title !== undefined && !input.title.trim()) throw badRequest("Title is required");
    await assertRefs(s, input);
    const statusChanged = input.status && input.status !== task.status;
    const updated: Task = {
      ...task,
      title: input.title !== undefined ? input.title.trim().slice(0, 500) : task.title,
      description: input.description !== undefined ? input.description.slice(0, 20_000) : task.description,
      projectId: input.projectId !== undefined ? input.projectId : task.projectId,
      pageId: input.pageId !== undefined ? input.pageId : task.pageId,
      status: input.status ?? task.status,
      priority: input.priority ?? task.priority,
      dueDate: input.dueDate !== undefined ? (toDate(input.dueDate) ?? null) : task.dueDate,
      assignee: input.assignee !== undefined ? (clean(input.assignee, 80) ?? null) : task.assignee,
      labelIds: input.labelIds ? [...new Set(input.labelIds)] : task.labelIds,
      completedAt: statusChanged ? (input.status === "COMPLETED" ? now() : null) : task.completedAt,
      updatedAt: now(),
    };
    await s.t("tasks").put(updated);
    if (input.projectId !== undefined) {
      // Subtasks follow their parent.
      const subs = await s.t("tasks").where("parentId", id);
      await s.t("tasks").bulkPut(subs.map((t) => ({ ...t, projectId: updated.projectId })));
    }
    const [enriched] = await enrich(s, [updated]);
    return enriched;
  });
}

/** Applies the same change to many tasks (bulk actions). */
export async function updateTasks(s: WorkspaceStore, ids: string[], input: Pick<TaskInput, "status" | "priority" | "dueDate" | "assignee">) {
  return s.transaction(async () => {
    for (const id of ids) await updateTask(s, id, input);
    return { count: ids.length };
  });
}

export async function moveTask(
  s: WorkspaceStore,
  id: string,
  input: { status?: TaskStatus; beforeId?: string | null; afterId?: string | null },
) {
  return s.transaction(async () => {
    const task = await s.t("tasks").get(id);
    if (!task) throw notFound("Task not found");
    const near = async (nid?: string | null) => (nid && nid !== id ? ((await s.t("tasks").get(nid))?.rank ?? null) : null);
    const [before, after] = await Promise.all([near(input.beforeId), near(input.afterId)]);
    const statusChanged = input.status && input.status !== task.status;
    const updated: Task = {
      ...task,
      rank: before || after ? rankBetween(before, after) : task.rank,
      status: input.status ?? task.status,
      completedAt: statusChanged ? (input.status === "COMPLETED" ? now() : null) : task.completedAt,
      updatedAt: now(),
    };
    await s.t("tasks").put(updated);
    return updated;
  });
}

async function deleteTaskRows(s: WorkspaceStore, ids: string[]) {
  const all = await s.t("tasks").all();
  const doomed = new Set(ids);
  for (const t of all) if (t.parentId && doomed.has(t.parentId)) doomed.add(t.id);
  const comments = (await s.t("comments").all()).filter((c) => doomed.has(c.taskId));
  await s.t("comments").bulkDelete(comments.map((c) => c.id));
  await s.t("tasks").bulkDelete([...doomed]);
}

export async function deleteTasks(s: WorkspaceStore, ids: string[]) {
  await s.transaction(() => deleteTaskRows(s, ids));
}

// ───────────── Labels, comments, people ─────────────

export async function listLabels(s: WorkspaceStore) {
  return (await s.t("labels").all()).sort((a, b) => a.name.localeCompare(b.name));
}

export async function createLabel(s: WorkspaceStore, input: { name: string; color?: string }) {
  return s.transaction(async () => {
    const name = input.name.trim().slice(0, 40);
    if (!name) throw badRequest("Name is required");
    const labels = await s.t("labels").all();
    if (labels.some((l) => l.name.toLowerCase() === name.toLowerCase())) throw badRequest("That label already exists");
    const label: Label = { id: newId(), name, color: input.color ?? "gray" };
    await s.t("labels").put(label);
    return label;
  });
}

export async function deleteLabel(s: WorkspaceStore, id: string) {
  await s.transaction(async () => {
    await s.t("labels").delete(id);
    const tasks = (await s.t("tasks").all()).filter((t) => t.labelIds.includes(id));
    await s.t("tasks").bulkPut(tasks.map((t) => ({ ...t, labelIds: t.labelIds.filter((l) => l !== id) })));
  });
}

export async function addComment(s: WorkspaceStore, taskId: string, body: string, author = "Me") {
  const text = body.trim().slice(0, 5000);
  if (!text) throw badRequest("Comment is empty");
  if (!(await s.t("tasks").get(taskId))) throw notFound("Task not found");
  const comment = { id: newId(), taskId, author, body: text, createdAt: now() };
  await s.t("comments").put(comment);
  return comment;
}

export async function deleteComment(s: WorkspaceStore, id: string) {
  await s.t("comments").delete(id);
}

/** Names used as assignees / project leads / person values (for pickers). */
export async function listPeople(s: WorkspaceStore) {
  const [tasks, projects, records, props] = await Promise.all([
    s.t("tasks").all(),
    s.t("projects").all(),
    s.t("records").all(),
    s.t("properties").all(),
  ]);
  const personProps = new Set(props.filter((p) => p.type === "PERSON").map((p) => p.id));
  const names = new Set<string>();
  tasks.forEach((t) => t.assignee && names.add(t.assignee));
  projects.forEach((p) => p.lead && names.add(p.lead));
  for (const r of records) for (const id of personProps) if (typeof r.values[id] === "string") names.add(r.values[id] as string);
  return [...names].sort((a, b) => a.localeCompare(b));
}

// ───────────── Dashboard ─────────────

export async function dashboard(s: WorkspaceStore) {
  const all = await listTasks(s, {});
  const open = all.filter((t) => t.status !== "COMPLETED" && t.status !== "CANCELLED");
  const soon = new Date(Date.now() + 14 * 86_400_000).toISOString();
  const byDue = (a: { dueDate: string | null }, b: { dueDate: string | null }) =>
    (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999");
  const prio = { URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3 } as const;
  const projects = (await listProjects(s)).filter((p) => p.status === "ACTIVE" || p.status === "PLANNED").slice(0, 6);
  const overview: Record<string, number> = {};
  for (const t of all) overview[t.status] = (overview[t.status] ?? 0) + 1;
  return {
    myTasks: [...open].sort((a, b) => byDue(a, b) || prio[a.priority] - prio[b.priority]).slice(0, 12),
    deadlines: open.filter((t) => t.dueDate && t.dueDate <= soon).sort(byDue).slice(0, 12),
    projects,
    overview,
  };
}
