// Export a workspace as a zip of Markdown files (Obsidian-compatible folder layout).
// The .skele backup remains the complete format; this is for reading/editing elsewhere.

import { strToU8, zipSync } from "fflate";
import type { WorkspaceStore } from "@/data/store";
import type { Page } from "@/data/types";
import { docToMarkdown } from "./markdown";

const clean = (name: string) => name.replace(/[\\/:*?"<>|#^[\]\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || "Untitled";

export async function exportMarkdownArchive(s: WorkspaceStore, workspaceName: string) {
  const [pages, contents, files, tasks, projects] = await Promise.all([
    s.t("pages").all(),
    s.t("contents").all(),
    s.t("files").all(),
    s.t("tasks").all(),
    s.t("projects").all(),
  ]);
  const live = pages.filter((p) => !p.archivedAt);
  const byId = new Map(live.map((p) => [p.id, p]));
  const contentById = new Map(contents.map((c) => [c.pageId, c]));
  const out: Record<string, Uint8Array> = {};
  const lossyPages: string[] = [];

  // Attachments
  const filePaths = new Map<string, string>();
  const used = new Set<string>();
  for (const f of files) {
    let name = clean(f.name);
    if (used.has(name.toLowerCase())) name = `${f.id.slice(0, 6)}-${name}`;
    used.add(name.toLowerCase());
    filePaths.set(f.id, `attachments/${name}`);
    out[`attachments/${name}`] = new Uint8Array(await f.blob.arrayBuffer());
  }

  // Unique, filesystem-safe titles (also used for [[links]], so they resolve on re-import).
  const titleOf = new Map<string, string>();
  const seen = new Map<string, number>();
  for (const p of live) {
    let t = clean(p.title || "Untitled");
    const n = seen.get(t.toLowerCase()) ?? 0;
    seen.set(t.toLowerCase(), n + 1);
    if (n) t = `${t} ${n + 1}`;
    titleOf.set(p.id, t);
  }
  const dirOf = (p: Page): string => {
    const chain: string[] = [];
    let cur = p.parentId ? byId.get(p.parentId) : undefined;
    while (cur) {
      chain.unshift(titleOf.get(cur.id)!);
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    return chain.join("/");
  };

  for (const p of live) {
    if (p.kind !== "DOCUMENT") continue;
    const dir = dirOf(p);
    const ctx = { pageTitle: (id: string) => titleOf.get(id), filePath: (id: string) => filePaths.get(id) };
    // Attachment paths are relative to the vault root; Obsidian resolves those from any folder.
    const { markdown, lossy } = docToMarkdown(contentById.get(p.id)?.doc, ctx, {
      frontmatter: {
        ...(p.tags.length ? { tags: p.tags } : {}),
        ...(p.icon ? { icon: p.icon } : {}),
        ...p.properties,
        created: p.createdAt,
        updated: p.updatedAt,
      },
    });
    if (lossy.length) lossyPages.push(`${titleOf.get(p.id)} (${lossy.join(", ")})`);
    out[`${dir ? `${dir}/` : ""}${titleOf.get(p.id)}.md`] = strToU8(markdown);
  }

  // Tasks, grouped by project, as Markdown checklists.
  const lines = [`# Tasks`, ""];
  const groups = [...projects.filter((p) => !p.archivedAt).map((p) => ({ id: p.id as string | null, name: p.name })), { id: null, name: "No project" }];
  for (const g of groups) {
    const list = tasks.filter((t) => t.projectId === g.id && !t.parentId);
    if (!list.length) continue;
    lines.push(`## ${g.name}`, "");
    for (const t of list) {
      const done = t.status === "COMPLETED" ? "x" : " ";
      const meta = [t.priority !== "MEDIUM" ? t.priority.toLowerCase() : "", t.dueDate ? `📅 ${t.dueDate.slice(0, 10)}` : "", t.assignee ? `@${t.assignee}` : ""].filter(Boolean).join(" ");
      lines.push(`- [${done}] ${t.title}${meta ? ` ${meta}` : ""}`);
      for (const sub of tasks.filter((x) => x.parentId === t.id)) lines.push(`  - [${sub.status === "COMPLETED" ? "x" : " "}] ${sub.title}`);
    }
    lines.push("");
  }
  if (tasks.length) out["Tasks.md"] = strToU8(lines.join("\n"));

  out["README.md"] = strToU8(
    `# ${workspaceName}\n\nExported from Skele on ${new Date().toISOString().slice(0, 10)}.\n\n` +
      `- Notes are Markdown with Obsidian-style [[links]], callouts and ==highlights==.\n` +
      `- Each note ends with a hidden comment holding the exact Skele document, so re-importing an unedited note loses nothing.\n` +
      `- Databases aren't included here — use a .skele backup for a complete copy.\n` +
      (lossyPages.length ? `\nFormatting Markdown can't show (kept in the hidden copy):\n${lossyPages.map((l) => `- ${l}`).join("\n")}\n` : ""),
  );

  return { blob: new Blob([zipSync(out, { level: 6 }) as BlobPart], { type: "application/zip" }), lossyPages };
}
