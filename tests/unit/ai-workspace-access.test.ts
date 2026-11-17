// The AI seeing the workspace: pages a message names, the title index, pages and databases
// as text, and the search/read tools API models get.
import { describe, expect, it } from "vitest";
import { createPage } from "@/data/repo/pages";
import { createProperty, createRecord, getDatabaseByPage } from "@/data/repo/databases";
import { cellText, mentionedTitles, pageText, referencedPages, workspaceIndex, workspaceTools } from "@/features/ai/workspace";
import { newWorkspace } from "../setup/local";

const doc = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });

describe("AI workspace access", () => {
  it("finds the pages a message names: [[links]], whole titles, longest first, no generic words", () => {
    const pages = [
      { id: "1", title: "Reading list" },
      { id: "2", title: "Reading" },
      { id: "3", title: "Notes" },
      { id: "4", title: "Trip to Japan" },
      { id: "5", title: "Ideas" },
      { id: "6", title: "Bugs" },
    ];
    const ids = (t: string) => mentionedTitles(t, pages).map((p) => p.id);
    expect(ids("what's left in my reading list?")).toEqual(["1"]);
    expect(ids("Summarize Trip to Japan and my [[Ideas]]")).toEqual(["4", "5"]);
    expect(ids("my notes say")).toEqual([]);
    expect(ids("debugsession")).toEqual([]);
    expect(ids("any bugs left?")).toEqual(["6"]);
  });

  it("turns database cells into text", () => {
    const status = { type: "STATUS" as const, config: { options: [{ id: "a", name: "Done", color: "green" }] } };
    expect(cellText(status, "a")).toBe("Done");
    expect(cellText({ type: "MULTI_SELECT", config: { options: [{ id: "x", name: "Red", color: "" }, { id: "y", name: "Blue", color: "" }] } }, ["x", "y"])).toBe("Red, Blue");
    expect(cellText({ type: "CHECKBOX", config: {} }, true)).toBe("yes");
    expect(cellText({ type: "NUMBER", config: {} }, null)).toBe("");
  });

  it("reads pages and databases, indexes titles, attaches named pages, and gives API models tools", async () => {
    const { ws, s } = await newWorkspace();
    const id = ws.id;
    const trip = await createPage(s, { title: "Trip to Japan", doc: doc("Fly to Osaka on May 3.") });
    const db = await createPage(s, { kind: "DATABASE", title: "Reading list" });
    const data = await getDatabaseByPage(s, db.id);
    const author = await createProperty(s, data.id, { name: "Author", type: "TEXT" });
    const done = data.properties.find((p) => p.type === "STATUS")!;
    await createRecord(s, data.id, { title: "Dune", values: { [author.id]: "Herbert", [done.id]: done.config.options![0].id } });

    const page = await pageText(id, trip.id);
    expect(page).toEqual({ title: "Trip to Japan", text: expect.stringContaining("Fly to Osaka on May 3.") });
    const table = (await pageText(id, db.id)).text;
    expect(table).toContain("Database with 4 rows"); // 3 example rows + Dune
    expect(table).toMatch(/\| Name \|.*Author/);
    expect(table).toMatch(/\| Dune \|.*Herbert/);

    const index = await workspaceIndex(id);
    expect(index).toContain("- Trip to Japan");
    expect(index).toContain("- Reading list (database, 4 rows)");

    const refs = await referencedPages(id, "When do I fly in the trip to japan plan? Also check my reading list", [{ id: db.id, title: "Reading list" }]);
    expect(refs).toEqual([expect.objectContaining({ id: trip.id, auto: true })]);

    const tools = Object.fromEntries(workspaceTools(id).map((t) => [t.name, t]));
    expect((await tools.search_workspace.run({ query: "osaka" })).text).toContain(`Page: Trip to Japan [id ${trip.id}]`);
    expect((await tools.search_workspace.run({ query: "dune" })).text).toContain('Row "Dune" in database Reading list');
    expect((await tools.list_pages.run({})).text).toContain("Reading list");
    expect((await tools.read_page.run({ page: "reading list" })).text).toContain("Herbert");
    expect((await tools.read_page.run({ page: trip.id })).text).toContain('<page title="Trip to Japan">');
    expect((await tools.read_page.run({ page: "nope" })).isError).toBe(true);
  });
});
