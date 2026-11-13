"use client";

import { routes } from "@/lib/routes";
import { formatDistanceToNow } from "date-fns";
import Link from "next/link";
import { useState } from "react";
import { RotateCcw, Trash2 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { EmptyState, PageIcon } from "@/components/common";
import { useWorkspaceCtx } from "@/features/shell/workspace-context";
import { useEmptyTrash, usePurgePage, useRestorePage, useTrash } from "../hooks";

export function TrashPopover({ children }: { children: React.ReactNode }) {
  const { workspaceId, canEdit, canPurge } = useWorkspaceCtx();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [confirm, setConfirm] = useState<null | { kind: "one"; id: string; title: string } | { kind: "all" }>(null);
  const trash = useTrash(workspaceId, open);
  const restore = useRestorePage(workspaceId);
  const purge = usePurgePage(workspaceId);
  const empty = useEmptyTrash(workspaceId);

  const items = (trash.data ?? []).filter((p) => (p.title || "Untitled").toLowerCase().includes(query.toLowerCase()));

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>{children}</PopoverTrigger>
        <PopoverContent side="right" align="end" className="w-[380px] p-0">
          <div className="border-b p-2">
            <Input placeholder="Search pages in trash…" value={query} onChange={(e) => setQuery(e.target.value)} className="h-8" />
          </div>
          <div className="max-h-[340px] overflow-y-auto p-1 scrollbar-thin">
            {trash.isPending ? (
              <div className="space-y-1 p-1">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-8" />
                ))}
              </div>
            ) : items.length === 0 ? (
              <EmptyState icon={Trash2} title={query ? "No matches" : "Trash is empty"} description="Pages you delete stay here until removed permanently." className="py-8" />
            ) : (
              items.map((p) => (
                <div key={p.id} className="group flex h-9 items-center gap-2 rounded-md px-2 hover:bg-accent">
                  <Link
                    href={routes.page(p.id)}
                    onClick={() => setOpen(false)}
                    className="flex min-w-0 flex-1 items-center gap-2"
                  >
                    <PageIcon icon={p.icon} kind={p.kind} className="size-4 text-[15px]" />
                    <span className="truncate">{p.title || "Untitled"}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {p.archivedAt && formatDistanceToNow(new Date(p.archivedAt), { addSuffix: true })}
                    </span>
                  </Link>
                  {canEdit && (
                    <Button size="icon-xs" variant="ghost" aria-label="Restore" title="Restore" onClick={() => restore.mutate(p.id)}>
                      <RotateCcw />
                    </Button>
                  )}
                  {canPurge && (
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      aria-label="Delete permanently"
                      title="Delete permanently"
                      onClick={() => setConfirm({ kind: "one", id: p.id, title: p.title || "Untitled" })}
                    >
                      <Trash2 />
                    </Button>
                  )}
                </div>
              ))
            )}
          </div>
          {canPurge && !!trash.data?.length && (
            <div className="flex justify-end border-t p-2">
              <Button size="sm" variant="destructive" onClick={() => setConfirm({ kind: "all" })}>
                Empty trash
              </Button>
            </div>
          )}
        </PopoverContent>
      </Popover>
      <AlertDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm?.kind === "all" ? "Empty the trash?" : `Delete “${confirm?.kind === "one" ? confirm.title : ""}” forever?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes {confirm?.kind === "all" ? "every page in the trash" : "the page and its subpages"},
              including attachments. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (confirm?.kind === "all") empty.mutate();
                else if (confirm?.kind === "one") purge.mutate(confirm.id);
              }}
            >
              Delete permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
