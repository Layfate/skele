import { describe, expect, it } from "vitest";
import { docToMarkdown, markdownToDoc, resolveRefs } from "@/features/import-export/markdown";
import { importMarkdownEntries } from "@/features/import-export/markdown-import";
import { exportMarkdownArchive } from "@/features/import-export/markdown-export";
import { workspaceStore } from "@/data/registry";
import { createPage, getPage, listPages, saveContent } from "@/data/repo/pages";
import { newWorkspace } from "../setup/local";
import { unzipSync, strFromU8 } from "fflate";

const ctx = { pageTitle: (id: string) => ({ p1: "Project plan" })[id], filePath: (id: string) => ({ f1: "attachments/pic.png" })[id] };
const para = (...content: object[]) => ({ type: "paragraph", content });
const text = (t: string, marks?: object[]) => ({ type: "text", text: t, ...(marks ? { marks } : {}) });

describe("markdown export", () => {
  it("writes Obsidian-flavoured Markdown", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1 }, content: [text("Notes")] },
        para(text("See "), { type: "wikiLink", attrs: { pageId: "p1", label: "old" } }, text(" and "), text("this", [{ type: "highlight", attrs: { color: "var(--hl-yellow)" } }])),
        { type: "callout", attrs: { emoji: "💡", color: "green" }, content: [para(text("Remember"))] },
        { type: "taskList", content: [{ type: "taskItem", attrs: { checked: true }, content: [para(text("done"))] }] },
        { type: "image", attrs: { src: "skele-file:f1", alt: "pic" } },
      ],
    };
    const { markdown } = docToMarkdown(doc, ctx, { frontmatter: { tags: ["work", "q4"] } });
    expect(markdown).toContain("---\ntags:\n  - work\n  - q4\n---");
    expect(markdown).toContain("# Notes");
    expect(markdown).toContain("See [[Project plan]] and ==this==");
    expect(markdown).toContain("> [!tip] Remember");
    expect(markdown).toContain("- [x] done");
    expect(markdown).toContain("![pic](attachments/pic.png)");
    expect(markdown).toMatch(/<!-- skele:doc v1 [0-9a-f]{8} /);
  });

  it("round-trips losslessly when the Markdown is unchanged, and reports what Markdown can't show", () => {
    const doc = { type: "doc", content: [para(text("Red", [{ type: "textStyle", attrs: { color: "var(--tc-red)" } }]))] };
    const { markdown, lossy } = docToMarkdown(doc, ctx);
    expect(lossy).toEqual(["text colours"]);
    const back = markdownToDoc(markdown);
    expect(back.lossless).toBe(true);
    expect(JSON.stringify(back.doc)).toContain("var(--tc-red)");
    // Edited elsewhere → the Markdown wins.
    const edited = markdownToDoc(markdown.replace("Red", "Blue"));
    expect(edited.lossless).toBe(false);
    expect(JSON.stringify(edited.doc)).toContain("Blue");
  });
});

describe("markdown import", () => {
  it("parses Obsidian syntax", () => {
    const r = markdownToDoc(
      "---\ntags: [Idea, project]\nstatus: draft\n---\n# Hi\n\nLink to [[Other note|the other one]] and ![[photo.png]]\n\n> [!warning] Careful\n> Hot surface\n\nSome ==marked== text #inline\n",
    );
    expect(r.tags).toEqual(["idea", "project"]);
    expect(r.properties).toEqual({ status: "draft" });
    expect(r.wikiTargets).toEqual(["Other note"]);
    expect(r.attachments).toContain("photo.png");
    const json = JSON.stringify(r.doc);
    expect(json).toContain('"type":"callout"');
    expect(json).toContain('"type":"highlight"');
    const resolved = resolveRefs(r.doc, (t) => (t === "Other note" ? "page-2" : undefined), (p) => (p === "photo.png" ? "skele-file:abc" : undefined));
    const out = JSON.stringify(resolved);
    expect(out).toContain('"pageId":"page-2"');
    expect(out).toContain("skele-file:abc");
  });

  it("imports a vault folder with links between notes and attachments", async () => {
    const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
    const entries = [
      { path: "Inbox.md", file: new File(["Start at [[Projects/Launch]]"], "Inbox.md") },
      { path: "Projects/Launch.md", file: new File(["# Launch\n\n![[cover.png]]\n\nBack to [[Inbox]]"], "Launch.md") },
      { path: "assets/cover.png", file: new File([PNG], "cover.png", { type: "image/png" }) },
      { path: ".obsidian/app.json", file: new File(["{}"], "app.json") },
      { path: "tool.exe", file: new File(["MZ"], "tool.exe") },
    ];
    const result = await importMarkdownEntries(entries, { newWorkspaceName: "Vault" });
    expect(result.pages).toBe(2);
    expect(result.files).toBe(1);
    expect(result.skipped).toEqual(["tool.exe (unsupported type)"]);
    const s = workspaceStore(result.workspaceId);
    const { pages } = await listPages(s);
    const launch = pages.find((p) => p.title === "Launch")!;
    const inbox = pages.find((p) => p.title === "Inbox")!;
    expect(pages.find((p) => p.id === launch.parentId)?.title).toBe("Projects");
    const doc = JSON.stringify((await getPage(s, launch.id)).content.doc);
    expect(doc).toContain(`"pageId":"${inbox.id}"`);
    expect(doc).toMatch(/skele-file:/);
    expect((await s.t("links").where("toId", launch.id)).map((l) => l.fromId)).toEqual([inbox.id]);
  });

  it("exports a workspace and re-imports it without losing content", async () => {
    const { ws, s } = await newWorkspace("Round trip", false);
    const a = await createPage(s, { title: "Alpha" });
    const b = await createPage(s, { title: "Beta", parentId: a.id });
    const doc = {
      type: "doc",
      content: [para(text("Coloured", [{ type: "textStyle", attrs: { color: "var(--tc-blue)" } }]), text(" link "), { type: "wikiLink", attrs: { pageId: b.id, label: "Beta" } })],
    };
    await saveContent(s, a.id, { doc, version: 0 });
    const { blob } = await exportMarkdownArchive(s, ws.name);
    const zip = unzipSync(new Uint8Array(await blob.arrayBuffer()));
    expect(Object.keys(zip).sort()).toEqual(["Alpha.md", "Alpha/Beta.md", "README.md"]);
    expect(strFromU8(zip["Alpha.md"])).toContain("[[Beta]]");
    const entries = Object.entries(zip).map(([path, bytes]) => ({ path, file: new File([bytes as BlobPart], path.split("/").pop()!) }));
    const back = await importMarkdownEntries(entries, { newWorkspaceName: "Back" });
    const s2 = workspaceStore(back.workspaceId);
    const pages = (await listPages(s2)).pages;
    const alpha = pages.find((p) => p.title === "Alpha")!;
    const beta = pages.find((p) => p.title === "Beta")!;
    const json = JSON.stringify((await getPage(s2, alpha.id)).content.doc);
    expect(json).toContain("var(--tc-blue)"); // lossless restore
    expect(json).toContain(`"pageId":"${beta.id}"`); // link remapped to the new page
    expect(back.lossless).toBeGreaterThanOrEqual(2);
  });
});
