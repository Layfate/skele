"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import {
  ArrowDownUp,
  CalendarDays,
  Columns3,
  Filter as FilterIcon,
  GalleryVerticalEnd,
  List,
  MoreHorizontal,
  Plus,
  Search,
  Settings2,
  Table2,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/common";
import { cn } from "@/lib/utils";
import { useWorkspaceCtx } from "@/features/shell/workspace-context";
import { usePeople } from "@/features/projects/hooks";
import { useDatabase, useDatabaseMutations, type DatabaseData, type DbView } from "../hooks";
import { applyView } from "../query";
import type { Property } from "../properties";
import { DatabaseProvider, useDb, type DatabaseCtx } from "./database-context";
import { newOption } from "./property-cell";
import { FilterPopover, SortPopover, ViewSettingsPopover } from "./view-toolbar";
import { TableView } from "./table-view";
import { BoardView } from "./board-view";
import { CalendarView, GalleryView, ListView } from "./other-views";
import { RecordSheet } from "./record-sheet";

export const VIEW_META: Record<DbView["type"], { label: string; icon: LucideIcon }> = {
  TABLE: { label: "Table", icon: Table2 },
  BOARD: { label: "Board", icon: Columns3 },
  LIST: { label: "List", icon: List },
  GALLERY: { label: "Gallery", icon: GalleryVerticalEnd },
  CALENDAR: { label: "Calendar", icon: CalendarDays },
};

export function DatabaseView({ pageId, editable }: { pageId: string; editable: boolean }) {
  const { workspaceId } = useWorkspaceCtx();
  const query = useDatabase(workspaceId, pageId);

  if (query.error) {
    return <EmptyState icon={Table2} title="Could not load this database" description={query.error.message} />;
  }
  if (!query.data) {
    return (
      <div className="space-y-2 pt-4">
        <Skeleton className="h-8 w-64" />
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-9 w-full" />
        ))}
      </div>
    );
  }
  return <LoadedDatabase data={query.data} pageId={pageId} editable={editable && query.data.canEdit} />;
}

function LoadedDatabase({ data, pageId, editable }: { data: DatabaseData; pageId: string; editable: boolean }) {
  const { workspaceId } = useWorkspaceCtx();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const people = usePeople(workspaceId);
  const m = useDatabaseMutations(workspaceId, pageId, data.id);
  const storageKey = `skele-view:${data.id}`;
  const [viewId, setViewId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(storageKey);
    } catch {
      return null;
    }
  });
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);

  const view = data.views.find((v) => v.id === viewId) ?? data.views[0];
  const selectView = (id: string) => {
    setViewId(id);
    try {
      localStorage.setItem(storageKey, id);
    } catch {}
  };

  const recordId = params.get("record");
  const openRecord = useCallback(
    (id: string | null) => {
      const next = new URLSearchParams(params.toString());
      if (id) next.set("record", id);
      else next.delete("record");
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );

  // Person values are stored as names; ids and names are the same thing locally.
  const memberOptions = useMemo(() => (people.data ?? []).map((name) => ({ id: name, name })), [people.data]);

  const ctx: DatabaseCtx = useMemo(() => {
    const visible = data.properties.filter((p) => !view.config.hidden.includes(p.id));
    return {
      workspaceId,
      pageId,
      data,
      view,
      editable,
      members: memberOptions,
      m,
      visible,
      openRecord: (id) => openRecord(id),
      setValue: (recordId, propertyId, value) => m.updateRecord.mutate({ id: recordId, values: { [propertyId]: value } }),
      createOption: (prop: Property, name: string) => {
        const options = prop.config.options ?? [];
        const option = newOption(name, options);
        m.updateProperty.mutate({ id: prop.id, config: { ...prop.config, options: [...options, option] } });
        return option.id;
      },
    };
  }, [workspaceId, pageId, data, view, editable, memberOptions, m, openRecord]);

  const records = useMemo(() => {
    const filtered = applyView(data.records, data.properties, view.config);
    const q = search.trim().toLowerCase();
    return q ? filtered.filter((r) => (r.title || "untitled").toLowerCase().includes(q)) : filtered;
  }, [data.records, data.properties, view.config, search]);

  const addView = (type: DbView["type"]) => {
    const config: Partial<DbView["config"]> = {};
    if (type === "BOARD") {
      config.groupBy = data.properties.find((p) => p.type === "STATUS" || p.type === "SELECT")?.id ?? null;
    }
    if (type === "CALENDAR") config.dateProperty = data.properties.find((p) => p.type === "DATE")?.id ?? null;
    m.createView.mutate({ name: VIEW_META[type].label, type, config }, { onSuccess: (v) => selectView(v.id) });
  };

  const ViewComponent = { TABLE: TableView, BOARD: BoardView, LIST: ListView, GALLERY: GalleryView, CALENDAR: CalendarView }[view.type];
  const activeFilters = view.config.filters.length;
  const activeSorts = view.config.sorts.length;

  return (
    <DatabaseProvider value={ctx}>
      <div className="mt-2 mb-1 flex flex-wrap items-center gap-1 border-b pb-1.5">
        <div role="tablist" aria-label="Views" className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto no-scrollbar">
          {data.views.map((v) => {
            const Icon = VIEW_META[v.type].icon;
            const active = v.id === view.id;
            return (
              <div key={v.id} className="group/tab relative flex items-center">
                <button
                  role="tab"
                  type="button"
                  aria-selected={active}
                  onClick={() => selectView(v.id)}
                  className={cn(
                    "flex h-7 items-center gap-1.5 rounded-md px-2 text-sm whitespace-nowrap text-muted-foreground hover:bg-accent hover:text-foreground",
                    active && "font-medium text-foreground after:absolute after:inset-x-2 after:-bottom-[7px] after:h-0.5 after:rounded-full after:bg-foreground",
                  )}
                >
                  <Icon className="size-3.5" />
                  {v.name}
                </button>
                {active && editable && <ViewMenu view={v} canDelete={data.views.length > 1} />}
              </div>
            );
          })}
          {editable && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-xs" aria-label="Add view" className="ml-0.5 text-muted-foreground">
                  <Plus />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {(Object.keys(VIEW_META) as DbView["type"][]).map((t) => {
                  const Icon = VIEW_META[t].icon;
                  return (
                    <DropdownMenuItem key={t} onSelect={() => addView(t)}>
                      <Icon /> {VIEW_META[t].label}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
        <div className="flex items-center gap-0.5">
          <FilterPopover>
            <Button variant="ghost" size="sm" className={cn("text-muted-foreground", activeFilters && "text-brand")}>
              <FilterIcon /> {activeFilters ? `${activeFilters} filter${activeFilters > 1 ? "s" : ""}` : "Filter"}
            </Button>
          </FilterPopover>
          <SortPopover>
            <Button variant="ghost" size="sm" className={cn("text-muted-foreground", activeSorts && "text-brand")}>
              <ArrowDownUp /> {activeSorts ? `${activeSorts} sort${activeSorts > 1 ? "s" : ""}` : "Sort"}
            </Button>
          </SortPopover>
          {searchOpen ? (
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onBlur={() => !search && setSearchOpen(false)}
              onKeyDown={(e) => e.key === "Escape" && (setSearch(""), setSearchOpen(false))}
              placeholder="Search records…"
              aria-label="Search records"
              className="h-7 w-40 rounded-md border bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          ) : (
            <Button variant="ghost" size="icon-sm" aria-label="Search records" className="text-muted-foreground" onClick={() => setSearchOpen(true)}>
              <Search />
            </Button>
          )}
          <ViewSettingsPopover>
            <Button variant="ghost" size="icon-sm" aria-label="View settings" className="text-muted-foreground">
              <Settings2 />
            </Button>
          </ViewSettingsPopover>
          {editable && (
            <Button
              size="sm"
              aria-label="New record"
              className="ml-1 bg-brand text-brand-foreground hover:bg-brand/90"
              onClick={() => m.createRecord.mutate({ atStart: false }, { onSuccess: (r) => openRecord(r.id) })}
            >
              New
            </Button>
          )}
        </div>
      </div>
      {data.truncated && (
        <p className="mb-2 text-xs text-muted-foreground">Showing the first 5,000 records.</p>
      )}
      <div className="pb-24">
        <ViewComponent records={records} />
      </div>
      <RecordSheet recordId={recordId} onClose={() => openRecord(null)} />
    </DatabaseProvider>
  );
}

function ViewMenu({ view, canDelete }: { view: DbView; canDelete: boolean }) {
  const { m } = useDb();
  const rename = () => {
    const name = prompt("Rename view", view.name)?.trim();
    if (name) m.updateView.mutate({ id: view.id, name });
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label="View options" className="flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-accent">
          <MoreHorizontal className="size-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem onSelect={rename}>Rename</DropdownMenuItem>
        <DropdownMenuSeparator />
        {(Object.keys(VIEW_META) as DbView["type"][]).map((t) => {
          const Icon = VIEW_META[t].icon;
          return (
            <DropdownMenuItem key={t} disabled={t === view.type} onSelect={() => m.updateView.mutate({ id: view.id, type: t })}>
              <Icon /> Show as {VIEW_META[t].label.toLowerCase()}
            </DropdownMenuItem>
          );
        })}
        {canDelete && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => m.deleteView.mutate(view.id)}>
              <Trash2 /> Delete view
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
