import { ranksAfter } from "@/lib/rank";
import { now } from "./common";
import { deleteWorkspace as removeFromRegistry, registerWorkspace, workspaceStore } from "./registry";
import { createStarterContent, createPage } from "./repo/pages";
import { createProperty, createRecord, createView, getDatabaseByPage, updateView } from "./repo/databases";
import { createLabel, createProject, createTask } from "./repo/projects";
import { deleteSnapshots } from "./snapshots";
import type { WorkspaceStore } from "./store";

export async function createWorkspace(input: { name: string; icon?: string | null; color?: string; starter?: boolean }) {
  const ws = await registerWorkspace(input);
  if (input.starter !== false) await createStarterContent(workspaceStore(ws.id));
  return ws;
}

export async function deleteWorkspace(id: string) {
  await removeFromRegistry(id);
  await deleteSnapshots(id);
}

export async function getQuickNote(s: WorkspaceStore) {
  return ((await s.t("settings").get("quickNote"))?.value as string | undefined) ?? "";
}

export async function setQuickNote(s: WorkspaceStore, text: string) {
  await s.t("settings").put({ key: "quickNote", value: text.slice(0, 20_000) });
}

const p = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
const h = (level: number, text: string) => ({ type: "heading", attrs: { level }, content: [{ type: "text", text }] });
const link = (pageId: string, label: string) => ({ type: "wikiLink", attrs: { pageId, label } });

/** A populated workspace to explore features without creating anything first. */
export async function createSampleWorkspace() {
  const ws = await registerWorkspace({ name: "Sample workspace", icon: "🧭", color: "teal" });
  const s = workspaceStore(ws.id);
  await createStarterContent(s);

  const handbook = await createPage(s, {
    title: "Team handbook",
    icon: "📚",
    doc: { type: "doc", content: [h(2, "How we work"), p("Small teams, clear owners, written decisions. #process"), h(2, "Rituals"), p("Monday planning, Friday demo.")] },
  });
  await createPage(s, {
    parentId: handbook.id,
    title: "Onboarding checklist",
    icon: "✅",
    doc: {
      type: "doc",
      content: [
        {
          type: "taskList",
          content: ["Set up your laptop", "Read the handbook", "Meet your buddy"].map((t, i) => ({
            type: "taskItem",
            attrs: { checked: i === 0 },
            content: [p(t)],
          })),
        },
      ],
    },
  });
  await createPage(s, {
    title: "Meeting notes",
    icon: "🗓️",
    doc: {
      type: "doc",
      content: [
        h(2, "Kickoff"),
        { type: "paragraph", content: [{ type: "text", text: "Agreed on the launch scope. See " }, link(handbook.id, "Team handbook"), { type: "text", text: " for rituals. #launch" }] },
      ],
    },
  });

  // A database
  const dbPage = await createPage(s, { title: "Content calendar", icon: "🗂️", kind: "DATABASE" });
  const data = await getDatabaseByPage(s, dbPage.id);
  const status = data.properties.find((x) => x.type === "STATUS")!;
  const date = data.properties.find((x) => x.type === "DATE")!;
  const channel = await createProperty(s, data.id, {
    name: "Channel",
    type: "SELECT",
    config: { options: [{ id: "blog", name: "Blog", color: "violet" }, { id: "news", name: "Newsletter", color: "amber" }] },
  });
  for (const r of data.records) await s.t("records").delete(r.id);
  const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
  for (const [title, st, ch, d] of [
    ["Why we built Skele", "done", "blog", -6],
    ["Five rituals for calm teams", "doing", "blog", 3],
    ["November product update", "doing", "news", 8],
    ["Designing for focus", "todo", "blog", 15],
  ] as const) {
    await createRecord(s, data.id, { title, values: { [status.id]: st, [channel.id]: ch, [date.id]: day(d) } });
  }
  const cal = await createView(s, data.id, { name: "Calendar", type: "CALENDAR" });
  await updateView(s, data.id, cal.id, { config: { dateProperty: date.id } });

  // A project with tasks
  const project = await createProject(s, {
    name: "Website relaunch",
    description: "Ship the new marketing site with the refreshed brand.",
    icon: "🚀",
    color: "violet",
    targetDate: new Date(Date.now() + 21 * 86_400_000).toISOString(),
  });
  const design = await createLabel(s, { name: "Design", color: "violet" });
  const eng = await createLabel(s, { name: "Engineering", color: "teal" });
  const tasks = [
    ["Write launch copy", "IN_PROGRESS", "HIGH", 2, [design.id]],
    ["Design hero section", "COMPLETED", "MEDIUM", -1, [design.id]],
    ["Set up analytics", "NOT_STARTED", "MEDIUM", 5, [eng.id]],
    ["QA on mobile", "NOT_STARTED", "URGENT", 1, [eng.id]],
    ["Plan launch event", "ON_HOLD", "LOW", 12, []],
  ] as const;
  ranksAfter(null, tasks.length);
  for (const [title, st, priority, due, labels] of tasks) {
    await createTask(s, {
      title,
      status: st,
      priority,
      projectId: project.id,
      dueDate: new Date(Date.now() + due * 86_400_000).toISOString(),
      labelIds: [...labels],
    });
  }
  await s.t("settings").put({ key: "createdFrom", value: { sample: true, at: now() } });
  return ws;
}
