# Migrating from the server version of Skele

Earlier versions of Skele ran on a Next.js server with PostgreSQL and user accounts. The
local-first version has neither, so your data moves over through an export file. The
exporter only reads from PostgreSQL and never modifies it.

## 1. Start the old database

If you used the embedded development database (data in `.data/postgres`):

```bash
npm run legacy:db        # starts PostgreSQL 17 on port 54329; leave it running
```

If you used your own PostgreSQL, make sure it's reachable.

## 2. Export

Put the connection string in `.env`:

```
DATABASE_URL="postgresql://skele:skele@localhost:54329/skele"
```

Then run one of:

```bash
npm run legacy:export -- --email you@example.com    # workspaces you belong to
npm run legacy:export -- --all                       # every workspace
npm run legacy:export -- --email you@example.com --out ~/skele-export
```

You get one `<workspace name> (<id>).skele.json` per workspace, in `.data/legacy-export/` by
default. Uploaded files are read from `LOCAL_STORAGE_DIR` (default `.data/uploads`) and
embedded. Files that were stored in S3 must be downloaded to that folder first.

What changes on the way:

| Server version | Local version |
|---|---|
| `/api/files/<id>` URLs in pages | `skele-file:<id>` references to the embedded attachment |
| assignee / project lead / comment author (user ids) | the person's display name |
| members, invitations, roles, sessions | not exported (no accounts any more) |
| per-user favourites | every member's favourites, merged into one list |

## 3. Import

Open Skele, then on the welcome screen choose **Open a backup**, or go to
**Settings → Data & backup → Import as new workspace**, and pick the `.skele.json` file.
A notification shows how many pages, tasks and files were imported.

## 4. Check, then clean up

Open a few pages, a database and a project to check them. Then make a `.skele` backup of the
imported workspace (**Settings → Data & backup → Export backup**).

Once you're satisfied, you can delete the old data directory (`.data/postgres`, `.data/uploads`)
and the export files. **Skele never deletes them for you.**

The exporter and `legacy:db` will be removed in a future release, so keep a `.skele` backup
rather than relying on them.
