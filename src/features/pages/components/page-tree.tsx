"use client";

import { routes } from "@/lib/routes";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { memo, useMemo, useRef, useState } from "react";
import { ChevronRight, MoreHorizontal, Plus } from "lucide-react";
import { PageIcon } from "@/components/common";
import { cn } from "@/lib/utils";
import { useUI } from "@/stores/ui";
import { useWorkspaceCtx } from "@/features/shell/workspace-context";
import { descendantIds, useCreatePage, useMovePage, useUpdatePage, type PageListItem } from "../hooks";
import { PageActionsMenu } from "./page-actions-menu";

type DropPosition = "before" | "after" | "inside";
type DropTarget = { id: string; position: DropPosition } | null;

type TreeData = {
  byParent: Map<string | null, PageListItem[]>;
  byId: Map<string, PageListItem>;
};

function buildTree(pages: PageListItem[]): TreeData {
  const byParent = new Map<string | null, PageListItem[]>();
  const byId = new Map<string, PageListItem>();
  for (const p of pages) {
    byId.set(p.id, p);
    const key = p.parentId ?? null;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(p);
  }
  for (const list of byParent.values()) list.sort((a, b) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0));
  return { byParent, byId };
}

/**
 * Sidebar page tree. Drag a row onto the top/bottom edge of another to reorder, or onto its
 * middle to nest it. "Move to…" in the row menu is the keyboard-accessible alternative.
 */
export function PageTree({
  pages,
  favoriteIds,
  roots,
  idPrefix = "tree",
}: {
  pages: PageListItem[];
  favoriteIds: string[];
  /** Override which pages appear at the top level (e.g. favorites). */
  roots?: PageListItem[];
  idPrefix?: string;
}) {
  const { workspaceId, canEdit } = useWorkspaceCtx();
  const tree = useMemo(() => buildTree(pages), [pages]);
  const favorites = useMemo(() => new Set(favoriteIds), [favoriteIds]);
  const move = useMovePage(workspaceId);
  const setExpanded = useUI((s) => s.setExpanded);
  const [dragging, setDragging] = useState<PageListItem | null>(null);
  const [target, setTarget] = useState<DropTarget>(null);
  const blocked = useRef<Set<string>>(new Set());
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const topLevel = roots ?? tree.byParent.get(null) ?? [];

  const onDragStart = (e: DragStartEvent) => {
    const id = String(e.active.id).split(":")[1];
    blocked.current = descendantIds(pages, id);
    setDragging(tree.byId.get(id) ?? null);
  };

  const onDragMove = (e: DragMoveEvent) => {
    const over = e.over;
    if (!over) return setTarget(null);
    const id = String(over.id).split(":")[1];
    if (blocked.current.has(id)) return setTarget(null);
    const start = e.activatorEvent as PointerEvent;
    const y = start.clientY + e.delta.y;
    const rel = (y - over.rect.top) / over.rect.height;
    const position: DropPosition = rel < 0.28 ? "before" : rel > 0.72 ? "after" : "inside";
    setTarget((t) => (t?.id === id && t.position === position ? t : { id, position }));
  };

  const onDragEnd = (e: DragEndEvent) => {
    const active = dragging;
    const drop = target;
    setDragging(null);
    setTarget(null);
    if (!active || !drop || !e.over) return;
    const over = tree.byId.get(drop.id);
    if (!over || over.id === active.id) return;

    if (drop.position === "inside") {
      const children = (tree.byParent.get(over.id) ?? []).filter((c) => c.id !== active.id);
      move.mutate({ id: active.id, parentId: over.id, beforeId: children.at(-1)?.id ?? null, afterId: null });
      setExpanded(over.id, true);
      return;
    }
    const siblings = (tree.byParent.get(over.parentId ?? null) ?? []).filter((c) => c.id !== active.id);
    const index = siblings.findIndex((s) => s.id === over.id);
    const [beforeId, afterId] =
      drop.position === "before"
        ? [siblings[index - 1]?.id ?? null, over.id]
        : [over.id, siblings[index + 1]?.id ?? null];
    move.mutate({ id: active.id, parentId: over.parentId ?? null, beforeId, afterId });
  };

  return (
    <DndContext
      sensors={sensors}
      onDragStart={onDragStart}
      onDragMove={onDragMove}
      onDragEnd={onDragEnd}
      onDragCancel={() => {
        setDragging(null);
        setTarget(null);
      }}
    >
      <ul role="tree" className="space-y-px">
        {topLevel.map((page) => (
          <TreeNode
            key={page.id}
            page={page}
            depth={0}
            tree={tree}
            favorites={favorites}
            target={target}
            idPrefix={idPrefix}
            draggable={canEdit}
          />
        ))}
      </ul>
      <DragOverlay dropAnimation={null}>
        {dragging && (
          <div className="flex h-7 max-w-56 items-center gap-2 rounded-md border bg-popover px-2 text-sm shadow-lg">
            <PageIcon icon={dragging.icon} kind={dragging.kind} className="size-4 text-[15px]" />
            <span className="truncate">{dragging.title || "Untitled"}</span>
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

const TreeNode = memo(function TreeNode({
  page,
  depth,
  tree,
  favorites,
  target,
  idPrefix,
  draggable,
}: {
  page: PageListItem;
  depth: number;
  tree: TreeData;
  favorites: Set<string>;
  target: DropTarget;
  idPrefix: string;
  draggable: boolean;
}) {
  const { workspaceId, canEdit } = useWorkspaceCtx();
  const pathname = usePathname();
  const expandedKey = idPrefix === "tree" ? page.id : `${idPrefix}:${page.id}`;
  const expanded = useUI((s) => !!s.expanded[expandedKey]);
  const setExpanded = useUI((s) => s.setExpanded);
  const create = useCreatePage(workspaceId);
  const update = useUpdatePage(workspaceId, page.id);
  const [renaming, setRenaming] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const children = tree.byParent.get(page.id) ?? [];
  const href = routes.page(page.id);
  const active = pathname === href;

  const dndId = `${idPrefix}:${page.id}`;
  const drag = useDraggable({ id: dndId, disabled: !draggable || renaming });
  const drop = useDroppable({ id: dndId, disabled: !draggable });
  const isTarget = target?.id === page.id;

  const addChild = () => {
    setExpanded(expandedKey, true);
    create.mutate({ parentId: page.id });
  };

  return (
    <li role="treeitem" aria-expanded={children.length ? expanded : undefined} aria-selected={active}>
      <div
        ref={(node) => {
          drag.setNodeRef(node);
          drop.setNodeRef(node);
        }}
        {...drag.attributes}
        {...drag.listeners}
        role="presentation"
        tabIndex={-1}
        className={cn(
          "group/row relative flex h-7 items-center gap-1 rounded-md pr-1 text-sidebar-foreground transition-colors",
          "hover:bg-sidebar-accent",
          (active || menuOpen) && "bg-sidebar-accent text-sidebar-accent-foreground",
          active && "font-medium",
          drag.isDragging && "opacity-40",
          isTarget && target?.position === "inside" && "bg-brand-soft ring-1 ring-brand/40",
        )}
        style={{ paddingLeft: 4 + depth * 14 }}
      >
        {isTarget && target?.position !== "inside" && (
          <span
            className={cn(
              "pointer-events-none absolute right-1 h-0.5 rounded-full bg-brand",
              target?.position === "before" ? "-top-px" : "-bottom-px",
            )}
            style={{ left: 8 + depth * 14 }}
          />
        )}
        <button
          type="button"
          aria-label={expanded ? "Collapse" : "Expand"}
          onClick={() => setExpanded(expandedKey, !expanded)}
          className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-black/5 dark:hover:bg-white/10"
        >
          <ChevronRight
            className={cn("size-3.5 transition-transform", expanded && "rotate-90", !children.length && "opacity-40")}
          />
        </button>
        {renaming ? (
          <RenameInput
            initial={page.title}
            onDone={(title) => {
              setRenaming(false);
              if (title !== null && title !== page.title) update.mutate({ title });
            }}
          />
        ) : (
          <Link
            href={href}
            className="flex min-w-0 flex-1 items-center gap-1.5 py-1 outline-none focus-visible:underline"
            draggable={false}
            onDoubleClick={(e) => {
              if (!canEdit) return;
              e.preventDefault();
              setRenaming(true);
            }}
          >
            <PageIcon icon={page.icon} kind={page.kind} className="size-4 text-[15px]" />
            <span className="truncate">{page.title || "Untitled"}</span>
          </Link>
        )}
        {!renaming && (
          <div
            className={cn(
              "flex shrink-0 items-center opacity-0 transition-opacity group-hover/row:opacity-100 focus-within:opacity-100",
              menuOpen && "opacity-100",
            )}
          >
            <PageActionsMenu
              page={{ id: page.id, pinned: page.pinned, isFavorite: favorites.has(page.id) }}
              onRename={() => setRenaming(true)}
              onOpenChange={setMenuOpen}
            >
              <button
                type="button"
                aria-label="Page actions"
                className="flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10"
              >
                <MoreHorizontal className="size-3.5" />
              </button>
            </PageActionsMenu>
            {canEdit && (
              <button
                type="button"
                aria-label="Add a page inside"
                onClick={addChild}
                className="flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10"
              >
                <Plus className="size-3.5" />
              </button>
            )}
          </div>
        )}
      </div>
      {expanded && (
        <ul role="group">
          {children.length ? (
            children.map((child) => (
              <TreeNode
                key={child.id}
                page={child}
                depth={depth + 1}
                tree={tree}
                favorites={favorites}
                target={target}
                idPrefix={idPrefix}
                draggable={draggable}
              />
            ))
          ) : (
            <li className="flex h-7 items-center text-[13px] text-muted-foreground/80" style={{ paddingLeft: 30 + depth * 14 }}>
              No pages inside
            </li>
          )}
        </ul>
      )}
    </li>
  );
});

function RenameInput({ initial, onDone }: { initial: string; onDone: (title: string | null) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <input
      autoFocus
      value={value}
      maxLength={255}
      aria-label="Page title"
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => onDone(value.trim())}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") onDone(value.trim());
        if (e.key === "Escape") onDone(null);
      }}
      className="h-6 min-w-0 flex-1 rounded border bg-background px-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
    />
  );
}
