"use client";

import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import Link from "next/link";
import { Plus, Table2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, PageIcon } from "@/components/common";
import { routes } from "@/lib/routes";
import { listDatabases } from "@/data/repo/databases";
import { Topbar } from "@/features/shell/topbar";
import { useWorkspaceCtx } from "@/features/shell/workspace-context";
import { useCreatePage } from "@/features/pages/hooks";

export function DatabasesPage() {
  const { workspaceId, store } = useWorkspaceCtx();
  const create = useCreatePage(workspaceId);
  const dbs = useQuery({ queryKey: ["databases", workspaceId], queryFn: () => listDatabases(store) });
  const newDb = () => create.mutate({ kind: "DATABASE", title: "Untitled database" });

  return (
    <>
      <Topbar
        crumbs={[{ label: "Databases" }]}
        actions={
          <Button size="sm" onClick={newDb}>
            <Plus /> New database
          </Button>
        }
      />
      <div className="flex-1 overflow-y-auto px-[clamp(1.25rem,4vw,3rem)] pt-6 pb-16 scrollbar-thin">
        <div className="mx-auto max-w-5xl">
          <h1 className="mb-4 text-2xl font-bold tracking-tight">Databases</h1>
          {!dbs.data ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-24 rounded-xl" />
              ))}
            </div>
          ) : dbs.data.length === 0 ? (
            <EmptyState
              icon={Table2}
              title="No databases yet"
              description="Databases hold structured records with properties, shown as tables, boards, calendars, galleries or lists."
              action={<Button onClick={newDb}>Create a database</Button>}
            />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {dbs.data.map((d) => (
                <Link
                  key={d.id}
                  href={routes.page(d.pageId)}
                  className="flex flex-col gap-1 rounded-xl border bg-card p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-shadow hover:shadow-md"
                >
                  <span className="flex items-center gap-2 font-semibold">
                    <PageIcon icon={d.page.icon} kind="DATABASE" className="size-4 text-base" />
                    <span className="truncate">{d.page.title || "Untitled database"}</span>
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {d.recordCount} {d.recordCount === 1 ? "record" : "records"} · edited {formatDistanceToNow(new Date(d.page.updatedAt), { addSuffix: true })}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
