// Import a folder of Markdown files (e.g. an Obsidian vault) into a workspace.
// Folders become pages, notes become child pages, [[links]] and attachments are resolved.

import { registerWorkspace, workspaceStore } from "@/data/registry";
import { createPage, saveContent } from "@/data/repo/pages";
import { uploadFile } from "@/data/repo/files";
import { ALLOWED } from "@/data/file-validation";
import { markdownToDoc, resolveRefs, type ParsedMarkdown } from "./markdown";

const MAX_NOTE_BYTES = 5 * 1024 * 1024;
const SKIP_DIRS = new Set([".obsidian", ".trash", ".git", "node_modules", ".skele"]);

export type ImportableFile = { path: string; file: File };

/** Opens a native folder picker (Chromium/Edge/Safari support `webkitdirectory`). */
export function pickMarkdownFolder(): Promise<File[] | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.setAttribute("webkitdirectory", "");
    input.onchange = () => resolve(input.files ? [...input.files] : null);
    input.oncancel = () => resolve(null);
    input.click();
  });
}

const extOf = (p: string) => p.split(".").pop()?.toLowerCase() ?? "";
const isAttachment = (p: string) => Object.values(ALLOWED).some((a) => a.ext.includes(extOf(p))) && extOf(p) !== "md";

export type ImportResult = { workspaceId: string; pages: number; files: number; skipped: string[]; lossless: number };

export async function importMarkdownFolder(
  files: File[],
  target: { newWorkspaceName: string } | { workspaceId: string; parentTitle?: string },
): Promise<ImportResult> {
  const entries: ImportableFile[] = files.map((file) => {
    const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
    // Drop the selected folder's own name so paths are relative to the vault root.
    const parts = rel.split("/");
    return { path: parts.length > 1 ? parts.slice(1).join("/") : rel, file };
  });
  return importMarkdownEntries(entries, target);
}

export async function importMarkdownEntries(
  entries: ImportableFile[],
  target: { newWorkspaceName: string } | { workspaceId: string; parentTitle?: string },
): Promise<ImportResult> {
  const skipped: string[] = [];
  const usable = entries.filter((e) => {
    const parts = e.path.split("/");
    if (parts.some((p) => SKIP_DIRS.has(p) || p.startsWith("."))) return false;
    if (extOf(e.path) === "md" && e.file.size > MAX_NOTE_BYTES) {
      skipped.push(`${e.path} (too large)`);
      return false;
    }
    return true;
  });
  const notes = usable.filter((e) => extOf(e.path) === "md").sort((a, b) => a.path.localeCompare(b.path));
  const attachmentFiles = usable.filter((e) => isAttachment(e.path));
  for (const e of usable) if (extOf(e.path) !== "md" && !isAttachment(e.path)) skipped.push(`${e.path} (unsupported type)`);
  if (!notes.length) throw new Error("No Markdown (.md) files were found in that folder.");

  let workspaceId: string;
  let rootParent: string | null = null;
  if ("newWorkspaceName" in target) {
    workspaceId = (await registerWorkspace({ name: target.newWorkspaceName.slice(0, 80) || "Imported notes", icon: "📥" })).id;
  } else {
    workspaceId = target.workspaceId;
    if (target.parentTitle) rootParent = (await createPage(workspaceStore(workspaceId), { title: target.parentTitle, icon: "📥" })).id;
  }
  const s = workspaceStore(workspaceId);

  // Attachments first, so notes can reference them.
  const fileRefs = new Map<string, string>();
  const byBasename = new Map<string, string>();
  for (const a of attachmentFiles) {
    try {
      const up = await uploadFile(s, a.file, null);
      fileRefs.set(a.path.toLowerCase(), up.url);
      byBasename.set(a.path.split("/").pop()!.toLowerCase(), up.url);
    } catch (e) {
      skipped.push(`${a.path} (${e instanceof Error ? e.message : "rejected"})`);
    }
  }

  // Folder pages.
  const folderIds = new Map<string, string>();
  const ensureFolder = async (dir: string): Promise<string | null> => {
    if (!dir) return rootParent;
    const existing = folderIds.get(dir);
    if (existing) return existing;
    const parent = await ensureFolder(dir.split("/").slice(0, -1).join("/"));
    const page = await createPage(s, { parentId: parent, title: dir.split("/").pop()!, icon: "📁" });
    folderIds.set(dir, page.id);
    return page.id;
  };

  // Pass 1: create every note (so links can be resolved in pass 2).
  const created: { id: string; dir: string; parsed: ParsedMarkdown }[] = [];
  const idByTitle = new Map<string, string>();
  for (const note of notes) {
    const dir = note.path.split("/").slice(0, -1).join("/");
    const title = note.path.split("/").pop()!.replace(/\.md$/i, "");
    let parsed: ParsedMarkdown;
    try {
      parsed = markdownToDoc(await note.file.text());
    } catch {
      skipped.push(`${note.path} (couldn't be read)`);
      continue;
    }
    const parentId = await ensureFolder(dir);
    const page = await createPage(s, { parentId, title, tags: parsed.tags, properties: parsed.properties });
    created.push({ id: page.id, dir, parsed });
    const key = title.toLowerCase();
    if (!idByTitle.has(key)) idByTitle.set(key, page.id);
    idByTitle.set(note.path.replace(/\.md$/i, "").toLowerCase(), page.id);
  }

  // Pass 2: resolve [[links]] and attachment paths, then store the content.
  let lossless = 0;
  for (const { id, dir, parsed } of created) {
    const doc = resolveRefs(
      parsed.doc,
      (title) => idByTitle.get(title.toLowerCase()) ?? idByTitle.get(title.replace(/\.md$/i, "").toLowerCase()),
      (path) => {
        const clean = path.replace(/^\.\//, "").toLowerCase();
        return fileRefs.get(clean) ?? fileRefs.get(dir ? `${dir.toLowerCase()}/${clean}` : clean) ?? byBasename.get(clean.split("/").pop()!);
      },
    );
    await saveContent(s, id, { doc, version: 0 });
    if (parsed.lossless) lossless += 1;
  }
  return { workspaceId, pages: created.length, files: fileRefs.size, skipped, lossless };
}
