"use client";

import { routes } from "@/lib/routes";
import { useState, type ReactNode } from "react";
import {
  ArrowRightLeft,
  Copy,
  Link2,
  Maximize2,
  Pencil,
  Pin,
  PinOff,
  Star,
  StarOff,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
  DropdownMenuCheckboxItem,
} from "@/components/ui/dropdown-menu";
import { useWorkspaceCtx } from "@/features/shell/workspace-context";
import { useArchivePage, useDuplicatePage, useToggleFavorite, useUpdatePage } from "../hooks";
import { MovePageDialog } from "./move-page-dialog";

export type PageMenuTarget = {
  id: string;
  pinned: boolean;
  isFavorite: boolean;
  fullWidth?: boolean;
};

export function PageActionsMenu({
  page,
  children,
  onRename,
  align = "start",
  onOpenChange,
}: {
  page: PageMenuTarget;
  children: ReactNode;
  onRename?: () => void;
  align?: "start" | "end";
  onOpenChange?: (open: boolean) => void;
}) {
  const { workspaceId, canEdit } = useWorkspaceCtx();
  const [moveOpen, setMoveOpen] = useState(false);
  const favorite = useToggleFavorite(workspaceId);
  const duplicate = useDuplicatePage(workspaceId);
  const archive = useArchivePage(workspaceId);
  const update = useUpdatePage(workspaceId, page.id);

  const copyLink = async () => {
    await navigator.clipboard.writeText(`${window.location.origin}${routes.page(page.id)}`);
    toast.success("Link copied");
  };

  return (
    <>
      <DropdownMenu onOpenChange={onOpenChange}>
        <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
        <DropdownMenuContent align={align} className="w-56" onCloseAutoFocus={(e) => e.preventDefault()}>
          <DropdownMenuItem onSelect={() => favorite.mutate({ id: page.id, favorite: !page.isFavorite })}>
            {page.isFavorite ? <StarOff /> : <Star />}
            {page.isFavorite ? "Remove from favorites" : "Add to favorites"}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={copyLink}>
            <Link2 />
            Copy link
          </DropdownMenuItem>
          {canEdit && (
            <>
              <DropdownMenuSeparator />
              {onRename && (
                <DropdownMenuItem onSelect={onRename}>
                  <Pencil />
                  Rename
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onSelect={() => duplicate.mutate(page.id)}>
                <Copy />
                Duplicate
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setMoveOpen(true)}>
                <ArrowRightLeft />
                Move to…
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => update.mutate({ pinned: !page.pinned })}>
                {page.pinned ? <PinOff /> : <Pin />}
                {page.pinned ? "Unpin from sidebar" : "Pin for everyone"}
              </DropdownMenuItem>
              {page.fullWidth !== undefined && (
                <DropdownMenuCheckboxItem
                  checked={page.fullWidth}
                  onCheckedChange={(v) => update.mutate({ fullWidth: v === true })}
                >
                  <Maximize2 />
                  Full width
                </DropdownMenuCheckboxItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => archive.mutate(page.id)}>
                <Trash2 />
                Move to trash
                <DropdownMenuShortcut>Del</DropdownMenuShortcut>
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {moveOpen && (
        <MovePageDialog workspaceId={workspaceId} pageId={page.id} open={moveOpen} onOpenChange={setMoveOpen} />
      )}
    </>
  );
}
