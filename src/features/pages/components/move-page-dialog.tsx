"use client";

import { useMemo } from "react";
import { CornerUpLeft } from "lucide-react";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { PageIcon } from "@/components/common";
import { descendantIds, useMovePage, usePages } from "../hooks";

/** Keyboard-accessible alternative to dragging pages in the sidebar. */
export function MovePageDialog({
  workspaceId,
  pageId,
  open,
  onOpenChange,
}: {
  workspaceId: string;
  pageId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { data } = usePages(workspaceId);
  const move = useMovePage(workspaceId);
  const page = data?.pages.find((p) => p.id === pageId);
  const targets = useMemo(() => {
    if (!data) return [];
    const excluded = descendantIds(data.pages, pageId);
    return data.pages.filter((p) => !excluded.has(p.id) && p.id !== page?.parentId);
  }, [data, pageId, page?.parentId]);

  const moveTo = (parentId: string | null) => {
    move.mutate({ id: pageId, parentId });
    onOpenChange(false);
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title="Move page" description="Choose a new parent page">
      <Command>
      <CommandInput placeholder="Move page to…" />
      <CommandList>
        <CommandEmpty>No pages found.</CommandEmpty>
        {page?.parentId && (
          <CommandGroup>
            <CommandItem onSelect={() => moveTo(null)}>
              <CornerUpLeft />
              Top level of the workspace
            </CommandItem>
          </CommandGroup>
        )}
        <CommandGroup heading="Pages">
          {targets.map((p) => (
            <CommandItem key={p.id} value={`${p.title || "Untitled"} ${p.id}`} onSelect={() => moveTo(p.id)}>
              <PageIcon icon={p.icon} kind={p.kind} className="size-4 text-base" />
              <span className="truncate">{p.title || "Untitled"}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
      </Command>
    </CommandDialog>
  );
}
