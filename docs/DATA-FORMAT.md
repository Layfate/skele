# Skele data format

Skele stores workspaces locally and exchanges them as **`skele-workspace` version 1** files.
The reader and writer are in `src/data/backup.ts`, and the zod schema there is the
authoritative definition.

## Files

| Extension | Contents | Produced by |
|---|---|---|
| `.skele` | zip: `skele.json` (manifest) + `attachments/<file id>` (raw bytes) | Settings → Data & backup → Export backup |
| `.skele.json` | the manifest alone, with attachments inlined as base64 in `files[].data` | `tools/legacy-export.mjs` (server → local migration) |

Both are accepted by **Open a backup** (welcome screen), **Import as new workspace**, and
**Restore from backup**.

## Manifest (`skele.json`)

```jsonc
{
  "format": "skele-workspace",
  "version": 1,
  "exportedAt": "2026-11-13T12:00:00.000Z",
  "workspace": { "id": "…", "name": "My notes", "icon": "🦴", "color": "indigo" },
  "pages":      [{ "id", "parentId", "kind": "DOCUMENT" | "DATABASE", "title", "icon", "cover",
                   "rank", "tags": [], "properties": {}, "isTemplate", "archivedAt", … }],
  "contents":   [{ "pageId", "doc": <Tiptap/ProseMirror JSON>, "version" }],
  "favorites":  [{ "pageId" }],
  "projects":   [{ "id", "name", "status", "lead": "name or null", "rank", … }],
  "labels":     [{ "id", "name", "color" }],
  "tasks":      [{ "id", "projectId", "parentId", "pageId", "title", "status", "priority",
                   "dueDate", "assignee": "name or null", "labelIds": [], "rank", … }],
  "comments":   [{ "id", "taskId", "author": "name", "body", "createdAt" }],
  "databases":  [{ "id", "pageId" }],
  "properties": [{ "id", "databaseId", "name", "type", "config", "rank" }],
  "records":    [{ "id", "databaseId", "title", "values": { "<propertyId>": … }, "doc", "rank" }],
  "views":      [{ "id", "databaseId", "name", "type": "TABLE" | "BOARD" | "CALENDAR" | "GALLERY" | "LIST", "config", "rank" }],
  "files":      [{ "id", "name", "mimeType", "size", "pageId", "path": "attachments/<id>", "sha256" }],
  "settings":   { "<key>": <value> }
}
```

- **Ranks** are fractional-index strings. Siblings sort by `rank`.
- **Dates** are ISO 8601 strings.
- **Documents** are Tiptap JSON. Attachments are referenced as `skele-file:<file id>` in image
  `src` / file-block `href` attributes. Wiki links are `wikiLink` nodes with `attrs.pageId`.
- **People** (assignees, leads, comment authors) are plain display names. Skele has no user
  accounts.
- **Not included:** app preferences, the workspace list, recovery points and integration tokens
  (Spotify). Backups never carry credentials.

## Import rules

1. Size limits and the schema are checked first. Unknown fields are ignored.
2. Every attachment's `sha256` is verified, and its bytes are sniffed against the declared type
   (see `src/data/file-validation.ts`). Attachments that fail are skipped and reported.
3. Documents pass through `sanitizeDoc` (URL allow-list, depth limit, safe colours).
4. References are repaired: tasks pointing at missing projects or pages, records pointing at
   missing databases and so on are detached rather than rejected.
5. **Import** always creates a new workspace with new ids. **Restore** replaces the current
   workspace's content after taking a recovery point first.

## Markdown export

**Export as Markdown** writes a zip that opens as an Obsidian vault:

- One `.md` file per page, nested in folders that mirror the page tree. Front matter holds
  `tags`, `icon`, page properties, `created` and `updated`.
- `[[Page title]]` links, `> [!note]` callouts, `==highlights==`, task lists, tables.
- `attachments/` holds files. `Tasks.md` lists tasks as checklists grouped by project.
- Each note ends with a hidden `<!-- skele:doc v1 <hash> <base64> -->` comment. If the Markdown
  above it is unchanged when re-imported, Skele restores the exact original document.
  Otherwise it parses the Markdown.
- Databases aren't exported to Markdown. Use a `.skele` backup for a complete copy.

## Versioning

`version` increases only for changes old readers can't ignore. A new Skele must import every
older version. Add a fixture-based test when bumping it.
