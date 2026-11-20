# Skele — Product & Engineering Specification (v2)

> **Superseded in part (2026-11-13).** Skele is now local-first: no accounts, no server, no
> PostgreSQL. Data is stored on the device and exchanged as `.skele` files. The product,
> design and editor sections below still apply. The stack, auth, multi-user, API and storage
> sections describe the earlier server version. See [LOCAL-FIRST-PLAN.md](LOCAL-FIRST-PLAN.md)
> for the current architecture, [STATUS.md](STATUS.md) for what's built, and
> [DATA-FORMAT.md](DATA-FORMAT.md) for the file format.

> This is a revised version of the original Skele build prompt. It keeps every goal of the
> original but resolves its contradictions, pins down the decisions it left open, and adds
> acceptance criteria so "done" is checkable. A list of what changed is at the end.

## 0. One-paragraph pitch

Skele is a calm, fast, keyboard-first workspace: documents, projects, tasks and structured
databases in one tree. It borrows the *ideas* of Notion, Linear and Craft — nested pages, a
block editor, views over data — but has its own identity: a bone-white / graphite palette,
one configurable accent colour, tight 4-px spacing grid and almost no chrome.

**Non-goals for v1** (designed for, not built): real-time multi-cursor collaboration,
offline sync, AI features, automations, native mobile apps, public page publishing.

## 1. Stack (pinned)

| Concern | Choice | Notes |
|---|---|---|
| Framework | Next.js 16 (App Router, Turbopack, Cache Components) | Route Handlers are the only backend surface |
| Language | TypeScript, `strict` | No `any` in feature code |
| Styling | Tailwind CSS 4 + CSS-variable design tokens | shadcn/ui (Radix base) for primitives |
| Icons | lucide-react | |
| Editor | Tiptap 3 (ProseMirror) | Content stored as Tiptap JSON |
| DB / ORM | PostgreSQL 17 + Prisma 7 (`@prisma/adapter-pg`) | |
| Auth | Better Auth (email + password, DB sessions) | |
| Client state | Zustand (UI only) + TanStack Query (server state) | Never mirror server data in Zustand |
| Validation | Zod 4 — one schema shared by client forms and route handlers | |
| Files | `StorageDriver` interface: S3-compatible in prod, local disk in dev | |
| Animation | CSS (tw-animate-css); Motion when layout/physics animation is needed | ≤ 200 ms, respects `prefers-reduced-motion` |
| Tests | Vitest (unit + service tests against a real DB) and Playwright (e2e) | |
| Desktop | Tauri 2 shell | See §13 — it wraps the running web app |

**Local development must not require Docker.** `npm run db:start` boots an embedded
PostgreSQL 17 (the `embedded-postgres` package) in `.data/postgres`. Any `DATABASE_URL`
pointing at a real Postgres works instead.

## 2. Design system

- Logo: the folded-page "S" with a bookmark (`public/brand/skele-logo-source.png`), always shown
  on a **`#121212`** tile. Derived assets: `public/brand/skele-logo.png` (square tile),
  `src/app/icon.png` + `favicon.ico` (rounded tile), `src/app/apple-icon.png`, and the Tauri icon
  set in `src-tauri/icons/` (regenerate with `npx tauri icon src-tauri/app-icon.png -o src-tauri/icons`).
- Fonts: **Inter** (UI), **JetBrains Mono** (code). Geist is the fallback sans.
- Tokens live in `src/app/globals.css` as CSS variables; components use semantic tokens
  only (`bg-background`, `text-muted-foreground`, `border-border`, `bg-accent`).
- Neutrals are slightly warm ("bone") in light mode and cool graphite in dark mode.
- Accent colour: user-selectable from 8 presets, stored in preferences, applied as
  `--brand`. Workspaces also have a colour used for their icon tile.
- Themes: light, dark, system (via `next-themes`, no flash on load).
- Density: 28-px rows in the sidebar, 14-px base UI text, 16-px editor text.
- Every interactive element has a visible `:focus-visible` ring; hit targets ≥ 28 px.
- Loading = skeletons shaped like the content; empty states = icon + one line + one action.
- Target: WCAG 2.2 AA contrast and full keyboard operability.

## 3. Information architecture

```
Workspace
 ├─ Pages (tree, unlimited depth)       ← a page is a document, OR hosts a Database
 ├─ Projects ─ Tasks ─ Subtasks / Comments
 ├─ Members (Owner / Admin / Member / Guest)
 └─ Files (attachments, covers, images)
```

- A **Database** is attached to a page (`Page.kind = DATABASE`), so databases live in the
  same tree, have breadcrumbs, can be favourited, trashed and searched like pages.
- Database **records** are themselves rows with a document body (opening a record shows its
  properties above an editor).
- **Projects/Tasks** are first-class typed models (not a generic database) because they need
  assignment, due-date queries, progress and dashboard widgets that must be fast and typed.

## 4. Roles & permissions

| Action | Owner | Admin | Member | Guest |
|---|:-:|:-:|:-:|:-:|
| Read pages, projects, databases | ✓ | ✓ | ✓ | ✓ |
| Create / edit content | ✓ | ✓ | ✓ | – |
| Delete content (trash) | ✓ | ✓ | ✓ | – |
| Permanently delete from trash | ✓ | ✓ | – | – |
| Invite / remove members, change roles | ✓ | ✓ | – | – |
| Edit workspace settings | ✓ | ✓ | – | – |
| Delete workspace, transfer ownership | ✓ | – | – | – |

Rules: exactly one Owner per workspace; an Admin cannot change an Owner; nobody can remove
the last Owner. **Every route handler** resolves the session, then calls
`requireMember(workspaceId, minRole)` before touching data; resources are always looked up
*scoped by workspaceId* so an id from another workspace returns 404, never data.

## 5. Pages

- Tree ordering uses **fractional-index rank strings** (`Page.rank`), so a move or reorder
  updates exactly one row.
- Move validation: a page cannot be moved into itself or any descendant (checked server-side
  by walking ancestors in a transaction).
- Archive = soft delete (`archivedAt`). Archiving a page archives its whole subtree; restoring
  restores the subtree; restoring a child whose parent is still archived re-parents it to root.
- Permanently deleting cascades to children, content, databases and attachments metadata
  (objects are deleted from storage asynchronously after the DB commit).
- Favourites are per-user (`Favorite` join table). "Recent" comes from `PageVisit`
  (per-user, upserted on open).
- Duplicate copies the page and its subtree (content included) in one transaction.
- Titles ≤ 255 chars; icon = one emoji or a Lucide icon name; cover = uploaded image or preset
  gradient.

## 6. Editor

Blocks: paragraph, H1–H3, bulleted / numbered / to-do lists, toggle, quote, divider, code
(syntax highlighted), image, file, table, callout, bookmark.

- `/` opens the block menu (fuzzy filter, arrow keys, Enter). Markdown shortcuts (`# `,
  `- `, `1. `, `[] `, `> `, ``` ``` ```, `---`).
- Drag handle on hover to reorder blocks; Esc selects the current block.
- Bubble menu on selection: B / I / U / S, code, link, text colour, highlight.
- Saving: debounced 800 ms + on blur + on `beforeunload`; optimistic version number
  (`PageContent.version`) — a stale save returns 409 and the client reloads the latest copy
  instead of overwriting newer content.
- Content is stored as Tiptap JSON (never HTML). On load, unknown/malformed nodes are
  dropped by the schema rather than crashing the editor. Links are restricted to
  `http(s):`, `mailto:` and in-app paths. A plain-text projection (`PageContent.text`) is
  written on every save for search.

## 7. Projects & tasks

Status: Not Started · In Progress · On Hold · Completed · Cancelled.
Priority: Low · Medium · High · Urgent.
Task fields: title, description (rich text), status, priority, due date, assignee (a
workspace member), labels (workspace-scoped), parent task (one level of subtasks),
comments, rank (for board/list ordering).

Views: **List** (group by status/priority/assignee, sort, filter), **Board** (drag between
status columns), **Calendar** (month grid by due date, drag to reschedule).
Project progress = completed ÷ (total − cancelled).

## 8. Databases

Property types: text, number, select, multi-select, checkbox, date, URL, email, person,
status. Values are stored as `DatabaseRecord.values` (JSONB keyed by property id) and
validated server-side against the property definitions with Zod; a property-type registry
(`src/features/databases/properties/`) makes new types a single-file addition.

Views: table, board (group by select/status), calendar (by a date property), gallery, list.
Each view persists its filter / sort / group / visible-properties config (`DatabaseView.config`).

## 9. Search & command palette

- `Ctrl/⌘ K` opens a palette: recent pages when empty; typing searches pages (title + body),
  tasks, projects and records in the current workspace, plus commands ("New page",
  "Toggle theme", …).
- `pg_trgm` GIN indexes on page titles, page bodies (`PageContent.text`), task titles, project
  names and record titles serve case-insensitive substring search (works for partial words and
  any language); results are ranked by title match then trigram similarity, scoped to the
  workspace, capped per type, and highlighted client-side with `<mark>` (no raw HTML).
- Recent searches stored per user in preferences.

## 10. Auth & security

- Email + password (min 10 chars), DB-backed sessions (Better Auth), sign out, sign out
  everywhere, password reset by emailed token. In development emails are written to the
  server log (and `/dev/outbox` in non-production) instead of being sent.
- `proxy.ts` does an optimistic cookie check for redirects only; authorisation is always
  enforced in route handlers.
- Rate limits (Better Auth built-in + our limiter) on sign-in, sign-up, reset, invite and
  upload endpoints.
- Uploads: size limit (`MAX_UPLOAD_MB`), MIME allow-list, sniffed type must match, files
  served with `Content-Disposition` and `X-Content-Type-Options: nosniff`.
- No `dangerouslySetInnerHTML` anywhere except the theme no-flash script.
- Secrets only in env; `.env.example` documents every variable.

## 11. Files

`FileAttachment` rows hold metadata (name, size, mime, storage key, uploader, page). Storage
usage per workspace is `SUM(size)`; a configurable quota (`WORKSPACE_QUOTA_MB`) is enforced
on upload.

## 12. Settings

Account (email, password, sessions, delete account) · Profile (name, avatar) · Appearance
(theme, accent, font size, sidebar density) · Workspaces (general, members, invitations,
danger zone) · Notifications (stored preferences; in-app only in v1) · Keyboard shortcuts
(reference sheet) · Storage (usage bar, file list) · Privacy & security (active sessions).

## 13. Desktop (Tauri)

The Tauri 2 app is a native window around the same static build as the web app (`./out`,
embedded in the executable). It loads nothing remote, works fully offline, and needs no
server. Full details: [DESKTOP.md](DESKTOP.md).

- **Storage:** workspaces live in SQLite files on disk (`src-tauri/src/storage.rs`), not the
  webview's IndexedDB. The page reaches them through Skele's own commands
  (`src-tauri/src/commands.rs`, page side `src/data/adapters/sqlite.ts`).
- **Data folder:** the OS application-data folder for installed copies; `SkeleData/` beside
  the executable for portable copies (switched on by `skele-portable.txt`); `SKELE_DATA_DIR`
  overrides both. Portable copies write nothing to the user profile.
- **Window:** size, position and maximised state are remembered: `tauri-plugin-window-state`
  for installed copies, `window-state.json` in the data folder otherwise.
- **Native integration:** single instance, native message and save dialogs, external links
  in the default browser, in-app updates from GitHub Releases (installed copies only), and a
  loopback redirect for the optional Spotify and Gmail sign-ins. The page-side bridge
  (`src/lib/desktop.ts`) is a no-op in browsers.
- **Least privilege:** the page has no general file-system, shell or Node access; its
  permissions are listed in `src-tauri/capabilities/`, and the CSP allows only the bundled app
  plus the Spotify, Google sign-in and Gmail APIs (and the AI providers).
- **Builds:** Windows (NSIS, MSI, portable zip), macOS (DMG, signed and notarised when
  credentials are set) and Linux (AppImage, deb, rpm, tarball), built and smoke-tested by
  `.github/workflows/build.yml`.

## 14. Architecture

```
src/
  app/                    routes only (thin): (auth), (app)/w/[workspaceId]/…, api/…
  components/ui/          shadcn primitives (generated, lightly themed)
  components/             app-wide composites (EmptyState, Kbd, EmojiPicker, …)
  features/<feature>/     components/, hooks.ts (TanStack Query), schemas.ts (Zod),
                          server/ (services: pure functions over Prisma, unit-tested)
  server/                 db.ts, auth.ts, authz.ts, http.ts (handler wrapper), storage/
  lib/                    framework-agnostic helpers (rank, api client, utils)
prisma/                   schema.prisma, migrations/, seed.ts
scripts/                  db.mjs (embedded Postgres)
tests/                    e2e (Playwright)
src-tauri/                desktop shell
```

Route handler pattern: `route(handler, { auth: true, body: Schema })` → parses JSON, runs
Zod, resolves the session, maps `AppError`s to HTTP codes (400/401/403/404/409/413/429).

## 15. Data model (summary — full schema in `prisma/schema.prisma`)

User, Session, Account, Verification (Better Auth) · UserPreferences · Workspace ·
WorkspaceMember · Invitation · Page · PageContent · Favorite · PageVisit · Project · Task ·
TaskLabel · TaskComment · Database · DatabaseProperty · DatabaseRecord · DatabaseView ·
FileAttachment · ActivityLog.

Every content table carries `workspaceId` (denormalised) so authorisation is one indexed
equality check.

## 16. Phases & definition of done

| Phase | Scope | Done when |
|---|---|---|
| 1 Foundation | tooling, tokens, shell, auth, DB | sign up → land in a personal workspace; typecheck, lint, unit tests pass |
| 2 Workspace & pages | workspace CRUD, page tree, favourites, recent, trash | e2e: create / nest / move / trash / restore a page |
| 3 Editor | Tiptap blocks, slash menu, drag handle, autosave | content round-trips; stale save returns 409 |
| 4 Productivity | projects, tasks, list/board/calendar, dashboard | e2e: create task, drag across board |
| 5 Databases | properties, records, 5 views, saved view config | record values validated server-side |
| 6 Extras | search, files, settings, invites, roles | permission tests for every role |
| 7 Desktop & QA | Tauri shell, perf, a11y, docs | production build + docs |

Each phase: implement → typecheck → lint → tests → fix → summarise.

## What changed from the original prompt

1. **Resolved the Tauri contradiction** — route handlers + desktop static bundle can't
   coexist; the shell now wraps the server URL.
2. **No-Docker local dev** — embedded Postgres + a local-disk storage driver behind the same
   interface as S3.
3. **Defined roles** as a concrete permission matrix instead of "roles and permissions".
4. **Specified hard parts** the prompt left open: page ordering (fractional ranks), move
   cycle prevention, subtree archive/restore semantics, save conflicts (versioning),
   malformed content, search technique, highlight rendering without HTML injection.
5. **Clarified Projects vs Databases** and made databases live in the page tree.
6. **Added acceptance criteria** per phase and an explicit non-goals list.
7. **Replaced vague requirements** ("unlimited pages", "secure uploads") with measurable
   rules (limits, MIME allow-list, quotas, rate limits).
8. Added email delivery strategy (dev outbox) — needed for resets and invitations.
