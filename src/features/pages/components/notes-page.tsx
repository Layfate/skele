"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { CalendarPlus, FilePlus2, FileText, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, PageIcon } from "@/components/common";
import { routes } from "@/lib/routes";
import { cn } from "@/lib/utils";
import { openDailyNote } from "@/data/repo/pages";
import { listTags } from "@/data/repo/search";
import { Topbar } from "@/features/shell/topbar";
import { useWorkspaceCtx } from "@/features/shell/workspace-context";
import { pageKeys, useCreatePage, usePages } from "../hooks";

type Sort = "edited" | "title" | "created";

/** Every note in the workspace, filterable by tag — an Obsidian-style file browser. */
export function NotesPage() {
  const { workspaceId, store } = useWorkspaceCtx();
  const router = useRouter();
  const qc = useQueryClient();
  const pages = usePages(workspaceId);
  const create = useCreatePage(workspaceId);
  const tags = useQuery({ queryKey: ["tags", workspaceId], queryFn: () => listTags(store) });
  const contents = useQuery({
    queryKey: ["content-tags", workspaceId],
    queryFn: async () => new Map((await store.t("contents").all()).map((c) => [c.pageId, c.tags ?? []])),
  });
  const [q, setQ] = useState("");
  const [tag, setTag] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort>("edited");
  const [templatesOnly, setTemplatesOnly] = useState(false);

  const byId = useMemo(() => new Map((pages.data?.pages ?? []).map((p) => [p.id, p])), [pages.data]);
  const notes = useMemo(() => {
    let list = (pages.data?.pages ?? []).filter((p) => p.kind === "DOCUMENT");
    if (templatesOnly) list = list.filter((p) => p.isTemplate);
    if (tag) list = list.filter((p) => [...p.tags, ...(contents.data?.get(p.id) ?? [])].some((t) => t === tag || t.startsWith(`${tag}/`)));
    const needle = q.trim().toLowerCase();
    if (needle) list = list.filter((p) => (p.title || "untitled").toLowerCase().includes(needle));
    return [...list].sort((a, b) =>
      sort === "title" ? (a.title || "").localeCompare(b.title || "") : sort === "created" ? b.createdAt.localeCompare(a.createdAt) : b.updatedAt.localeCompare(a.updatedAt),
    );
  }, [pages.data, contents.data, tag, q, sort, templatesOnly]);

  const pathOf = (parentId: string | null) => {
    const parts: string[] = [];
    let cur = parentId ? byId.get(parentId) : undefined;
    while (cur && parts.length < 6) {
      parts.unshift(cur.title || "Untitled");
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    return parts.join(" / ");
  };

  return (
    <>
      <Topbar
        crumbs={[{ label: "Notes" }]}
        actions={
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={async () => {
                const page = await openDailyNote(store);
                qc.invalidateQueries({ queryKey: pageKeys.list(workspaceId) });
                router.push(routes.page(page.id));
              }}
            >
              <CalendarPlus /> Today
            </Button>
            <Button size="sm" onClick={() => create.mutate({})}>
              <FilePlus2 /> New note
            </Button>
          </>
        }
      />
      <div className="flex-1 overflow-y-auto px-[clamp(1.25rem,4vw,3rem)] pt-6 pb-16 scrollbar-thin">
        <div className="mx-auto max-w-4xl">
          <h1 className="mb-4 text-2xl font-bold tracking-tight">Notes</h1>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div className="relative min-w-52 flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Filter by title"
                aria-label="Filter notes"
                className="h-8 w-full rounded-md border bg-background pr-2 pl-8 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <select aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="h-8 rounded-md border bg-background px-2 text-sm">
              <option value="edited">Recently edited</option>
              <option value="created">Newest</option>
              <option value="title">Title</option>
            </select>
            <button
              type="button"
              aria-pressed={templatesOnly}
              onClick={() => setTemplatesOnly(!templatesOnly)}
              className={cn("h-8 rounded-md border px-2.5 text-sm text-muted-foreground hover:bg-accent", templatesOnly && "border-brand bg-brand-soft text-foreground")}
            >
              Templates
            </button>
          </div>
          {!!tags.data?.length && (
            <div className="mb-4 flex flex-wrap gap-1" role="group" aria-label="Filter by tag">
              {tags.data.slice(0, 40).map(({ tag: t, count }) => (
                <button
                  key={t}
                  type="button"
                  aria-pressed={tag === t}
                  onClick={() => setTag(tag === t ? null : t)}
                  className={cn("h-6 rounded-full border px-2 text-xs text-muted-foreground hover:bg-accent", tag === t && "border-brand bg-brand-soft text-foreground")}
                >
                  #{t} <span className="opacity-60">{count}</span>
                </button>
              ))}
            </div>
          )}
          {pages.isPending ? (
            <div className="space-y-2">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-12" />
              ))}
            </div>
          ) : notes.length === 0 ? (
            <EmptyState icon={FileText} title={q || tag || templatesOnly ? "No matching notes" : "No notes yet"} action={<Button onClick={() => create.mutate({})}>New note</Button>} />
          ) : (
            <ul className="divide-y rounded-lg border bg-card">
              {notes.map((p) => {
                const path = pathOf(p.parentId);
                const allTags = [...new Set([...p.tags, ...(contents.data?.get(p.id) ?? [])])];
                return (
                  <li key={p.id}>
                    <Link href={routes.page(p.id)} className="flex items-center gap-3 px-3 py-2 hover:bg-accent/50">
                      <PageIcon icon={p.icon} kind={p.kind} className="size-4 text-[15px]" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{p.title || "Untitled"}</span>
                        {(path || allTags.length > 0) && (
                          <span className="block truncate text-xs text-muted-foreground">
                            {path}
                            {path && allTags.length > 0 && " · "}
                            {allTags.slice(0, 4).map((t) => `#${t}`).join(" ")}
                          </span>
                        )}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">{formatDistanceToNow(new Date(p.updatedAt), { addSuffix: true })}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}
