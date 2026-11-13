// Export workspaces from the old server-based Skele (PostgreSQL) into portable
// `.skele.json` files (format "skele-workspace" v1) that the local-first app imports.
//
//   node tools/legacy-export.mjs [--email you@example.com] [--all] [--out .data/legacy-export]
//
// Reads DATABASE_URL (from .env). Read-only: nothing in PostgreSQL is modified.
// Uploaded files are read from LOCAL_STORAGE_DIR (default .data/uploads) and embedded as base64.
import "dotenv/config";
import pg from "pg";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
};
const all = args.includes("--all");
const email = flag("--email");
const outDir = path.resolve(flag("--out") ?? ".data/legacy-export");
const uploads = path.resolve(process.env.LOCAL_STORAGE_DIR ?? ".data/uploads");

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
const q = async (sql, params = []) => (await client.query(sql, params)).rows;
const iso = (d) => (d ? new Date(d).toISOString() : null);

/** Rewrites server file URLs (/api/files/<id>) in documents to local references. */
function rewriteDoc(doc) {
  return JSON.parse(JSON.stringify(doc ?? { type: "doc", content: [] }).replace(/\/api\/files\/([A-Za-z0-9_-]+)/g, "skele-file:$1"));
}

let workspaces;
if (all) {
  workspaces = await q(`select * from workspace order by "createdAt"`);
} else if (email) {
  workspaces = await q(
    `select w.* from workspace w join workspace_member m on m."workspaceId" = w.id join "user" u on u.id = m."userId"
     where lower(u.email) = lower($1) order by w."createdAt"`,
    [email],
  );
} else {
  console.error("Pass --email <address> to export one account's workspaces, or --all.");
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
const summary = [];

for (const ws of workspaces) {
  const W = [ws.id];
  const users = new Map(
    (await q(`select u.id, u.name from "user" u join workspace_member m on m."userId" = u.id where m."workspaceId" = $1`, W)).map((u) => [u.id, u.name]),
  );
  const name = (id) => (id ? (users.get(id) ?? null) : null);

  const pages = await q(`select * from page where "workspaceId" = $1 order by rank`, W);
  const contents = await q(`select c.* from page_content c join page p on p.id = c."pageId" where p."workspaceId" = $1`, W);
  const favorites = await q(`select * from favorite where "workspaceId" = $1`, W);
  const projects = await q(`select * from project where "workspaceId" = $1 order by rank`, W);
  const labels = await q(`select * from label where "workspaceId" = $1`, W);
  const tasks = await q(`select * from task where "workspaceId" = $1 order by rank`, W);
  const taskLabels = await q(`select "A" as "labelId", "B" as "taskId" from "_LabelToTask" lt join task t on t.id = lt."B" where t."workspaceId" = $1`, W);
  const comments = await q(`select * from task_comment where "workspaceId" = $1 order by "createdAt"`, W);
  const databases = await q(`select * from database where "workspaceId" = $1`, W);
  const dbIds = databases.map((d) => d.id);
  const properties = dbIds.length ? await q(`select * from database_property where "databaseId" = any($1) order by rank`, [dbIds]) : [];
  const records = dbIds.length ? await q(`select * from database_record where "databaseId" = any($1) order by rank`, [dbIds]) : [];
  const views = dbIds.length ? await q(`select * from database_view where "databaseId" = any($1) order by rank`, [dbIds]) : [];
  const files = await q(`select * from file_attachment where "workspaceId" = $1`, W);
  const prefs = (await q(`select p."quickNotes" from user_preferences p join workspace_member m on m."userId" = p."userId" where m."workspaceId" = $1 and m.role = 'OWNER' limit 1`, W))[0];

  const personProps = new Set(properties.filter((p) => p.type === "PERSON").map((p) => p.id));
  const missingFiles = [];

  const out = {
    format: "skele-workspace",
    version: 1,
    exportedAt: new Date().toISOString(),
    source: "legacy-postgres",
    workspace: { id: ws.id, name: ws.name, icon: ws.icon, color: ws.color, createdAt: iso(ws.createdAt) },
    pages: pages.map((p) => ({
      id: p.id,
      parentId: p.parentId,
      kind: p.kind,
      title: p.title,
      icon: p.icon,
      cover: p.cover ? p.cover.replace(/^\/api\/files\//, "skele-file:") : null,
      coverPosition: p.coverPosition,
      rank: p.rank,
      pinned: p.pinned,
      fullWidth: p.fullWidth,
      archivedAt: iso(p.archivedAt),
      archivedRootId: p.archivedRootId,
      isTemplate: false,
      tags: [],
      properties: {},
      createdAt: iso(p.createdAt),
      updatedAt: iso(p.updatedAt),
    })),
    contents: contents.map((c) => ({ pageId: c.pageId, doc: rewriteDoc(c.doc), text: c.text, version: c.version, updatedAt: iso(c.updatedAt) })),
    favorites: favorites.map((f) => ({ pageId: f.pageId, createdAt: iso(f.createdAt) })),
    projects: projects.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      icon: p.icon,
      color: p.color,
      status: p.status,
      startDate: iso(p.startDate),
      targetDate: iso(p.targetDate),
      lead: name(p.leadId),
      rank: p.rank,
      archivedAt: iso(p.archivedAt),
      createdAt: iso(p.createdAt),
      updatedAt: iso(p.updatedAt),
    })),
    labels: labels.map((l) => ({ id: l.id, name: l.name, color: l.color })),
    tasks: tasks.map((t) => ({
      id: t.id,
      projectId: t.projectId,
      parentId: t.parentId,
      title: t.title,
      description: t.description,
      status: t.status,
      priority: t.priority,
      dueDate: iso(t.dueDate),
      assignee: name(t.assigneeId),
      labelIds: taskLabels.filter((l) => l.taskId === t.id).map((l) => l.labelId),
      rank: t.rank,
      completedAt: iso(t.completedAt),
      pageId: null,
      createdAt: iso(t.createdAt),
      updatedAt: iso(t.updatedAt),
    })),
    comments: comments.map((c) => ({ id: c.id, taskId: c.taskId, author: name(c.authorId) ?? "Former member", body: c.body, createdAt: iso(c.createdAt) })),
    databases: databases.map((d) => ({ id: d.id, pageId: d.pageId, createdAt: iso(d.createdAt) })),
    properties: properties.map((p) => ({ id: p.id, databaseId: p.databaseId, name: p.name, type: p.type, config: p.config, rank: p.rank })),
    records: records.map((r) => {
      const values = { ...(r.values ?? {}) };
      // Person values referenced user ids; keep the person's name instead.
      for (const id of personProps) if (typeof values[id] === "string") values[id] = name(values[id]) ?? values[id];
      return {
        id: r.id,
        databaseId: r.databaseId,
        title: r.title,
        icon: r.icon,
        values,
        doc: rewriteDoc(r.doc),
        text: r.text,
        version: r.version,
        rank: r.rank,
        createdAt: iso(r.createdAt),
        updatedAt: iso(r.updatedAt),
      };
    }),
    views: views.map((v) => ({ id: v.id, databaseId: v.databaseId, name: v.name, type: v.type, config: v.config, rank: v.rank })),
    files: files.map((f) => {
      const full = path.join(uploads, f.storageKey);
      let data = null;
      if (existsSync(full)) data = readFileSync(full).toString("base64");
      else missingFiles.push(f.name);
      return { id: f.id, name: f.name, mimeType: f.mimeType, size: f.size, pageId: f.pageId, createdAt: iso(f.createdAt), data };
    }),
    settings: { quickNote: (prefs?.quickNotes ?? {})[ws.id] ?? "" },
  };

  const safe = ws.name.replace(/[^\p{L}\p{N} _-]+/gu, "").trim().slice(0, 60) || "workspace";
  const file = path.join(outDir, `${safe} (${ws.id.slice(-6)}).skele.json`);
  writeFileSync(file, JSON.stringify(out, null, 2));
  summary.push({
    workspace: ws.name,
    pages: out.pages.length,
    tasks: out.tasks.length,
    projects: out.projects.length,
    records: out.records.length,
    files: `${out.files.length - missingFiles.length}/${out.files.length}`,
    file: path.relative(process.cwd(), file),
  });
  if (missingFiles.length) console.warn(`! ${ws.name}: missing file content for ${missingFiles.join(", ")}`);
}

console.table(summary);
await client.end();
