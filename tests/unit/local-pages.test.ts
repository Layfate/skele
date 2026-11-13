import { describe, expect, it } from "vitest";
import {
  archivePage,
  createPage,
  duplicatePage,
  getPage,
  listPages,
  listTrash,
  movePage,
  purgePage,
  restorePage,
  saveContent,
  setFavorite,
} from "@/data/repo/pages";
import { expectLocalError, newWorkspace } from "../setup/local";

describe("local pages repository", () => {
  it("creates a workspace with a starter page", async () => {
    const { s } = await newWorkspace();
    const { pages } = await listPages(s);
    expect(pages.map((p) => p.title)).toEqual(["Getting started"]);
  });

  it("creates nested pages in rank order with breadcrumbs", async () => {
    const { s } = await newWorkspace();
    const parent = await createPage(s, { title: "Parent" });
    const a = await createPage(s, { title: "A", parentId: parent.id });
    const b = await createPage(s, { title: "B", parentId: parent.id });
    const mid = await createPage(s, { title: "A2", parentId: parent.id, afterId: a.id });
    const { pages } = await listPages(s);
    expect(pages.filter((p) => p.parentId === parent.id).map((p) => p.title)).toEqual(["A", "A2", "B"]);
    expect(mid.rank > a.rank && mid.rank < b.rank).toBe(true);
    const full = await getPage(s, mid.id);
    expect(full.breadcrumbs.map((c) => c.title)).toEqual(["Parent", "A2"]);
  });

  it("prevents cycles when moving", async () => {
    const { s } = await newWorkspace();
    const root = await createPage(s, { title: "Root" });
    const child = await createPage(s, { parentId: root.id });
    const grandchild = await createPage(s, { parentId: child.id });
    await expectLocalError(movePage(s, root.id, { parentId: grandchild.id }), "bad_request");
    await expectLocalError(movePage(s, root.id, { parentId: root.id }), "bad_request");
    expect((await movePage(s, grandchild.id, { parentId: null })).parentId).toBeNull();
  });

  it("reorders among siblings using neighbours", async () => {
    const { s } = await newWorkspace("w", false);
    const a = await createPage(s, { title: "a" });
    const b = await createPage(s, { title: "b" });
    const c = await createPage(s, { title: "c" });
    await movePage(s, c.id, { parentId: null, beforeId: a.id, afterId: b.id });
    expect((await listPages(s)).pages.map((p) => p.title)).toEqual(["a", "c", "b"]);
  });

  it("archives and restores a subtree; independently trashed children stay trashed", async () => {
    const { s } = await newWorkspace();
    const root = await createPage(s, { title: "Root" });
    const child = await createPage(s, { title: "Child", parentId: root.id });
    const other = await createPage(s, { title: "Other", parentId: root.id });
    await archivePage(s, other.id);
    await archivePage(s, root.id);
    expect((await listPages(s)).pages.find((p) => p.id === child.id)).toBeUndefined();
    expect((await listTrash(s)).map((p) => p.id).sort()).toEqual([root.id, other.id].sort());
    await restorePage(s, root.id);
    const { pages } = await listPages(s);
    expect(pages.find((p) => p.id === child.id)?.parentId).toBe(root.id);
    expect((await listTrash(s)).map((p) => p.id)).toEqual([other.id]);
  });

  it("restores a child to the top level when its parent is still trashed", async () => {
    const { s } = await newWorkspace();
    const root = await createPage(s, { title: "Root" });
    const child = await createPage(s, { title: "Child", parentId: root.id });
    await archivePage(s, child.id);
    await archivePage(s, root.id);
    expect((await restorePage(s, child.id)).parentId).toBeNull();
  });

  it("purges only trashed pages, with their content and favourites", async () => {
    const { s } = await newWorkspace();
    const page = await createPage(s, { title: "Gone" });
    await setFavorite(s, page.id, true);
    await expectLocalError(purgePage(s, page.id), "bad_request");
    await archivePage(s, page.id);
    await purgePage(s, page.id);
    expect(await s.t("pages").get(page.id)).toBeUndefined();
    expect(await s.t("contents").get(page.id)).toBeUndefined();
    expect(await s.t("favorites").get(page.id)).toBeUndefined();
  });

  it("detects stale saves (another tab saved first)", async () => {
    const { s } = await newWorkspace();
    const page = await createPage(s, {});
    const doc = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "hello #idea" }] }] };
    expect((await saveContent(s, page.id, { doc, version: 0 })).version).toBe(1);
    await expectLocalError(saveContent(s, page.id, { doc, version: 0 }), "conflict");
    const stored = await s.t("contents").get(page.id);
    expect(stored?.text).toBe("hello #idea");
    expect(stored?.tags).toEqual(["idea"]);
  });

  it("indexes [[links]] on save", async () => {
    const { s } = await newWorkspace();
    const target = await createPage(s, { title: "Target" });
    const source = await createPage(s, { title: "Source" });
    const doc = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "wikiLink", attrs: { pageId: target.id, label: "Target" } }] }],
    };
    await saveContent(s, source.id, { doc, version: 0 });
    expect((await s.t("links").where("toId", target.id)).map((l) => l.fromId)).toEqual([source.id]);
    await saveContent(s, source.id, { doc: { type: "doc", content: [] }, version: 1 });
    expect(await s.t("links").where("toId", target.id)).toEqual([]);
  });

  it("duplicates a subtree with content and databases", async () => {
    const { s } = await newWorkspace();
    const root = await createPage(s, { title: "Root" });
    await createPage(s, { title: "Child", parentId: root.id });
    await createPage(s, { title: "Table", parentId: root.id, kind: "DATABASE" });
    const { id } = await duplicatePage(s, root.id);
    const { pages } = await listPages(s);
    expect(pages.find((p) => p.id === id)?.title).toBe("Root (copy)");
    const kids = pages.filter((p) => p.parentId === id);
    expect(kids.map((p) => p.title)).toEqual(["Child", "Table"]);
    expect(await s.t("databases").where("pageId", kids[1].id)).toHaveLength(1);
  });

  it("keeps workspaces isolated", async () => {
    const one = await newWorkspace("One");
    const two = await newWorkspace("Two", false);
    const page = await createPage(one.s, { title: "Private" });
    await expectLocalError(getPage(two.s, page.id), "not_found");
  });
});

describe("backlinks, mentions, daily notes, templates", () => {
  it("finds backlinks and unlinked mentions", async () => {
    const { listBacklinks, listUnlinkedMentions } = await import("@/data/repo/pages");
    const { s } = await newWorkspace("w", false);
    const target = await createPage(s, { title: "Roadmap" });
    const linker = await createPage(s, { title: "Linker" });
    const mentioner = await createPage(s, { title: "Mentioner" });
    await saveContent(s, linker.id, {
      doc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "See " }, { type: "wikiLink", attrs: { pageId: target.id, label: "Roadmap" } }] }] },
      version: 0,
    });
    await saveContent(s, mentioner.id, {
      doc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "The roadmap is due. Roadmaps are fun." }] }] },
      version: 0,
    });
    expect((await listBacklinks(s, target.id)).map((p) => p.title)).toEqual(["Linker"]);
    expect((await listUnlinkedMentions(s, target.id)).map((p) => p.title)).toEqual(["Mentioner"]);
  });

  it("creates one daily note per day and pages from templates", async () => {
    const { openDailyNote, createFromTemplate } = await import("@/data/repo/pages");
    const { s } = await newWorkspace("w", false);
    const day = new Date("2026-11-13T10:00:00");
    const a = await openDailyNote(s, day);
    const b = await openDailyNote(s, day);
    expect(a.id).toBe(b.id);
    expect(a.title).toBe("2026-11-13");
    const tpl = await createPage(s, { title: "Meeting template", isTemplate: true, doc: { type: "doc", content: [{ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Agenda" }] }] } });
    const page = await createFromTemplate(s, tpl.id);
    expect(page.title).toBe("Meeting");
    expect(page.isTemplate).toBe(false);
    expect((await s.t("contents").get(page.id))?.text).toBe("Agenda");
  });
});
