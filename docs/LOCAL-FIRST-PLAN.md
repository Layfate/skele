# Local-first migration plan

Goal: Skele runs with **no account and no server**. All data lives on the user's device, the
UI stays as it is, and existing PostgreSQL data is exported before anything is removed.

## What exists today (inspected 2026-11-13)

| Area | Implementation | Coupling |
|---|---|---|
| UI (shell, editor, dashboard, pages, projects, tasks, databases, settings) | React client components | Talk to the server only through `features/*/hooks.ts` |
| Business logic | `features/*/server/service.ts` over Prisma | Server-only |
| API | 44 Next.js route handlers in `src/app/api` | Server-only |
| Auth | Better Auth, `proxy.ts`, `(auth)` pages, sessions | Every request |
| Multi-user | workspace members, roles, invitations | Services + settings UI |
| Storage | PostgreSQL (embedded in dev), files on disk/S3 | Server-only |
| Data | 107 workspaces, 2 non-test accounts (`demo`, the owner's) | Must be migrated |

## Target architecture

```
React UI (unchanged components)
   │  TanStack Query hooks (same names, same shapes)
   ▼
Repository layer  src/data/repo/*      ← business rules ported from server services
   │  Store interface (tables, transactions)   src/data/store.ts
   ▼
Storage adapter: IndexedDB via Dexie (web + desktop webview)   ← default, tested
                 SQLite via Tauri (desktop vault folder)          ← planned, needs Rust to verify
```

- One database per workspace (`skele-ws-<id>`) + a registry (`skele`) holding the workspace list,
  app preferences and integration tokens. Exports never include the registry, so tokens never
  leave the device inside a backup.
- Routes become static (`/page?id=…` instead of `/w/[id]/p/[id]`) so the app can be exported as
  static files: deployable anywhere, bundled into Tauri, cached offline as a PWA.
- Multi-tab safety: optimistic version numbers on documents stay; a BroadcastChannel tells other
  tabs to refresh after writes.
- Durability: Dexie transactions (strict durability) + rolling automatic snapshots + manual
  `.skele` backup archives.

## Module decisions

| Module | Decision |
|---|---|
| `features/*/components` | **Keep** (links updated for new routes) |
| `features/*/hooks.ts` | **Refactor**: same hooks, call repositories instead of `fetch` |
| `features/*/server/service.ts` | **Port** logic into `src/data/repo`, then remove |
| `features/*/schemas.ts`, `properties.ts`, `query.ts`, `task-view-logic.ts`, `editor/doc.ts` | **Keep** (validation reused client-side) |
| `src/app/api/**`, `src/server/**`, `proxy.ts` | **Remove** after migration is verified |
| `features/auth`, `(auth)` pages, `invite`, members/invitations/roles UI, sessions UI | **Remove** |
| Prisma schema/migrations, Better Auth, pg, embedded-postgres, nodemailer, AWS SDK | **Remove** after export; a standalone legacy exporter (`tools/legacy-export.mjs`, uses `pg`) stays for one release |
| Tests | Service tests **ported** to repository tests (fake-indexeddb); e2e rewritten for no-login flow |

## Data migration (safe order)

1. `tools/legacy-export.mjs` reads PostgreSQL and writes one `.skele.json` per workspace (pages,
   content, favourites, projects, tasks, labels, comments, databases, files as base64).
2. Run it on the existing database → `.data/legacy-export/`; check counts against SQL.
3. App imports `.skele.json` / `.skele` files (Welcome screen → "Import"); repository tests import
   a fixture and verify pages, content, tasks, records and attachments round-trip.
4. Only then remove server code. The PostgreSQL data directory itself is left untouched.

## Phases

1. Remove auth + local onboarding · 2. Local persistence + migration · 3. Notes (Markdown,
`[[links]]`, backlinks, tags, outline, daily notes, templates) · 4. Productivity UI · 5. Spotify
(PKCE) · 6. Graph, import/export · 7. Desktop + open-source packaging.
