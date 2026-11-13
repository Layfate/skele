import { describe, expect, it } from "vitest";
import { strToU8 } from "fflate";
import { exportWorkspaceArchive, importWorkspace, readWorkspaceFile, restoreIntoWorkspace } from "@/data/backup";
import { getWorkspace, workspaceStore } from "@/data/registry";
import { createPage, getPage, listPages, saveContent } from "@/data/repo/pages";
import {
  createProperty,
  createRecord,
  deleteProperty,
  getDatabaseByPage,
  moveRecord,
  saveRecordContent,
  updateProperty,
  updateRecord,
} from "@/data/repo/databases";
import { createProject, createTask, dashboard, deleteProject, getProject, listTasks, moveTask, updateTask } from "@/data/repo/projects";
import { listFiles, uploadFile } from "@/data/repo/files";
import { search } from "@/data/repo/search";
import { listSnapshots, restoreSnapshot, takeSnapshot } from "@/data/snapshots";
import { createSampleWorkspace } from "@/data/workspaces";
import { expectLocalError, newWorkspace } from "../setup/local";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const pngFile = (name = "pic.png") => new File([PNG], name, { type: "image/png" });

describe("databases", () => {
  async function setup() {
    const { s } = await newWorkspace();
    const page = await createPage(s, { kind: "DATABASE", title: "Bugs" });
    return { s, data: await getDatabaseByPage(s, page.id) };
  }

  it("validates record values", async () => {
    const { s, data } = await setup();
    const status = data.properties.find((p) => p.type === "STATUS")!;
    const r = await createRecord(s, data.id, { title: "Crash", values: { [status.id]: "doing" } });
    expect(r.values[status.id]).toBe("doing");
    await expectLocalError(updateRecord(s, data.id, r.id, { values: { [status.id]: "bogus" } }), "bad_request");
    await expectLocalError(updateRecord(s, data.id, r.id, { values: { nope: 1 } }), "bad_request");
    expect((await updateRecord(s, data.id, r.id, { values: { [status.id]: null } })).values[status.id]).toBeUndefined();
  });

  it("cleans values on type change, deletion and removed options", async () => {
    const { s, data } = await setup();
    const num = await createProperty(s, data.id, { name: "Points", type: "NUMBER" });
    const sel = await createProperty(s, data.id, {
      name: "Team",
      type: "MULTI_SELECT",
      config: { options: [{ id: "a", name: "A", color: "red" }, { id: "b", name: "B", color: "blue" }] },
    });
    const r = await createRecord(s, data.id, { values: { [num.id]: 3, [sel.id]: ["a", "b"] } });
    await updateProperty(s, data.id, num.id, { type: "TEXT" });
    await updateProperty(s, data.id, sel.id, { config: { options: [{ id: "b", name: "B", color: "blue" }] } });
    let row = await s.t("records").get(r.id);
    expect(row?.values[num.id]).toBeUndefined();
    expect(row?.values[sel.id]).toEqual(["b"]);
    await deleteProperty(s, data.id, sel.id);
    row = await s.t("records").get(r.id);
    expect(row?.values[sel.id]).toBeUndefined();
  });

  it("moves records between groups and versions record bodies", async () => {
    const { s, data } = await setup();
    const status = data.properties.find((p) => p.type === "STATUS")!;
    const [first, second] = data.records;
    const moved = await moveRecord(s, data.id, second.id, { beforeId: null, afterId: first.id, values: { [status.id]: "done" } });
    expect(moved.rank < first.rank).toBe(true);
    expect(moved.values[status.id]).toBe("done");
    const doc = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "notes" }] }] };
    expect((await saveRecordContent(s, data.id, first.id, { doc, version: 0 })).version).toBe(1);
    await expectLocalError(saveRecordContent(s, data.id, first.id, { doc, version: 0 }), "conflict");
  });
});

describe("projects & tasks", () => {
  it("tracks progress and completion timestamps", async () => {
    const { s } = await newWorkspace();
    const project = await createProject(s, { name: "Launch" });
    const a = await createTask(s, { title: "A", projectId: project.id });
    await createTask(s, { title: "B", projectId: project.id });
    await createTask(s, { title: "C", projectId: project.id, status: "CANCELLED" });
    await updateTask(s, a.id, { status: "COMPLETED" });
    expect((await getProject(s, project.id)).counts).toEqual({ total: 3, completed: 1, cancelled: 1 });
    expect((await s.t("tasks").get(a.id))?.completedAt).not.toBeNull();
    await updateTask(s, a.id, { status: "IN_PROGRESS" });
    expect((await s.t("tasks").get(a.id))?.completedAt).toBeNull();
  });

  it("keeps subtasks one level deep and deletes them with the project", async () => {
    const { s } = await newWorkspace();
    const project = await createProject(s, { name: "P" });
    const parent = await createTask(s, { title: "Parent", projectId: project.id });
    const child = await createTask(s, { title: "Child", parentId: parent.id });
    expect(child.projectId).toBe(project.id);
    await expectLocalError(createTask(s, { title: "x", parentId: child.id }), "bad_request");
    expect((await listTasks(s, { projectId: project.id })).map((t) => t.title)).toEqual(["Parent"]);
    await deleteProject(s, project.id);
    expect(await s.t("tasks").count()).toBe(0);
  });

  it("moves tasks across board columns and builds the dashboard", async () => {
    const { s } = await newWorkspace();
    const a = await createTask(s, { title: "A", dueDate: new Date().toISOString() });
    const b = await createTask(s, { title: "B" });
    const moved = await moveTask(s, b.id, { status: "IN_PROGRESS", beforeId: null, afterId: a.id });
    expect(moved.status).toBe("IN_PROGRESS");
    expect(moved.rank < a.rank).toBe(true);
    const d = await dashboard(s);
    expect(d.deadlines.map((t) => t.title)).toEqual(["A"]);
    expect(d.overview).toEqual({ NOT_STARTED: 1, IN_PROGRESS: 1 });
  });
});

describe("files & search", () => {
  it("stores attachments locally and rejects disguised files", async () => {
    const { s } = await newWorkspace();
    const up = await uploadFile(s, pngFile(), null);
    expect(up.url).toMatch(/^skele-file:/);
    await expectLocalError(uploadFile(s, new File(["<svg onload=alert(1)>"], "x.png", { type: "image/png" }), null), "bad_request");
    await expectLocalError(uploadFile(s, new File(["x"], "x.exe", { type: "application/x-msdownload" }), null), "bad_request");
    expect((await listFiles(s)).usage.count).toBe(1);
  });

  it("finds pages by title, body and #tag", async () => {
    const { s } = await newWorkspace();
    const page = await createPage(s, { title: "Roadmap" });
    await saveContent(s, page.id, {
      doc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Ship offline mode #q4" }] }] },
      version: 0,
    });
    expect((await search(s, "roadm")).pages.map((p) => p.title)).toEqual(["Roadmap"]);
    expect((await search(s, "offline mode")).pages[0].snippet).toContain("offline mode");
    expect((await search(s, "#q4")).pages.map((p) => p.title)).toEqual(["Roadmap"]);
    expect((await search(s, "%")).pages).toEqual([]);
  });
});

describe("backup, import and recovery", () => {
  it("round-trips a workspace through a .skele archive", async () => {
    const sample = await createSampleWorkspace();
    const s = workspaceStore(sample.id);
    const page = (await listPages(s)).pages[0];
    const up = await uploadFile(s, pngFile(), page.id);
    const blob = await exportWorkspaceArchive(s, await getWorkspace(sample.id));
    const { workspace, counts, problems } = await importWorkspace(new Uint8Array(await blob.arrayBuffer()));
    expect(problems).toEqual([]);
    const copy = workspaceStore(workspace.id);
    expect(workspace.id).not.toBe(sample.id);
    expect((await listPages(copy)).pages.map((p) => p.title).sort()).toEqual((await listPages(s)).pages.map((p) => p.title).sort());
    expect(counts.tasks).toBe(await s.t("tasks").count());
    expect(counts.records).toBe(await s.t("records").count());
    const file = await copy.t("files").get(up.id);
    expect(new Uint8Array(await file!.blob.arrayBuffer())).toEqual(PNG);
    // Links survive and are re-indexed.
    expect(await copy.t("links").count()).toBe(await s.t("links").count());
  });

  it("imports the legacy PostgreSQL export format", async () => {
    const legacy = {
      format: "skele-workspace",
      version: 1,
      source: "legacy-postgres",
      workspace: { id: "old", name: "Old Workspace", icon: "🦴", color: "indigo" },
      pages: [
        { id: "p1", parentId: null, kind: "DOCUMENT", title: "Notes", icon: null, rank: "a0", archivedAt: null, createdAt: "2026-01-01T00:00:00Z" },
        { id: "p2", parentId: "missing", kind: "DOCUMENT", title: "Orphan", rank: "a1" },
      ],
      contents: [
        {
          pageId: "p1",
          doc: {
            type: "doc",
            content: [
              { type: "paragraph", content: [{ type: "text", text: "hi" }] },
              { type: "image", attrs: { src: "skele-file:f1" } },
            ],
          },
        },
      ],
      tasks: [{ id: "t1", title: "Do it", status: "NOT_STARTED", priority: "HIGH", rank: "a0", assignee: "Alex", labelIds: ["nope"] }],
      files: [{ id: "f1", name: "pic.png", mimeType: "image/png", size: PNG.length, pageId: "p1", data: btoa(String.fromCharCode(...PNG)) }],
    };
    const { workspace, problems } = await importWorkspace(strToU8(JSON.stringify(legacy)));
    expect(problems).toEqual([]);
    const s = workspaceStore(workspace.id);
    const page = await getPage(s, "p1");
    expect(JSON.stringify(page.content.doc)).toContain("skele-file:f1");
    expect((await s.t("pages").get("p2"))?.parentId).toBeNull(); // dangling parent repaired
    expect((await s.t("tasks").get("t1"))?.labelIds).toEqual([]); // unknown label dropped
    expect((await s.t("files").get("f1"))?.size).toBe(PNG.length);
  });

  it("rejects corrupted or foreign files", async () => {
    await expectLocalError(readWorkspaceFile(strToU8("not json")), "bad_request");
    await expectLocalError(readWorkspaceFile(strToU8(JSON.stringify({ format: "other" }))), "bad_request");
    const bad = {
      format: "skele-workspace",
      version: 1,
      workspace: { id: "x", name: "x" },
      pages: [],
      contents: [],
      files: [{ id: "f", name: "a.png", mimeType: "image/png", size: 3, data: btoa("abc") }],
    };
    const { problems } = await readWorkspaceFile(strToU8(JSON.stringify(bad)));
    expect(problems).toEqual(["a.png: content doesn't match its type"]);
  });

  it("restores a backup into an existing workspace and rolls back snapshots", async () => {
    const { ws, s } = await newWorkspace();
    const keep = await createPage(s, { title: "Keep me" });
    const archive = await exportWorkspaceArchive(s, ws);
    await takeSnapshot(s, "test");
    await createPage(s, { title: "Added later" });
    // Snapshot rollback removes the later page.
    const [snap] = await listSnapshots(ws.id);
    await restoreSnapshot(s, snap.id);
    expect((await listPages(s)).pages.map((p) => p.title)).not.toContain("Added later");
    // Full restore from archive.
    await createPage(s, { title: "Another" });
    await restoreIntoWorkspace(s, new Uint8Array(await archive.arrayBuffer()));
    expect((await listPages(s)).pages.map((p) => p.id)).toContain(keep.id);
    expect((await listPages(s)).pages.map((p) => p.title)).not.toContain("Another");
    // A "before restore" safety snapshot was kept.
    expect((await listSnapshots(ws.id)).some((x) => x.reason === "before restore")).toBe(true);
  });
});
