"use client";

import { routes } from "@/lib/routes";
import { closestCenter, DndContext, PointerSensor, KeyboardSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { arrayMove, rectSortingStrategy, SortableContext, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { formatDistanceToNow } from "date-fns";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, type ReactNode } from "react";
import {
  CalendarClock,
  CircleCheckBig,
  Clock,
  Eye,
  EyeOff,
  FilePlus2,
  FolderKanban,
  FolderPlus,
  GripVertical,
  ListPlus,
  LayoutGrid,
  NotebookPen,
  Star,
  Table2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { IconTile, PageIcon } from "@/components/common";
import { cn } from "@/lib/utils";
import { Topbar } from "@/features/shell/topbar";
import { useWorkspaceCtx } from "@/features/shell/workspace-context";
import { useCreatePage, usePages, useRecent } from "@/features/pages/hooks";
import { useCreateTask, useDashboard, useUpdateTask } from "@/features/projects/hooks";
import { progress, STATUS_LABEL } from "@/features/projects/schemas";
import { DueBadge, PriorityIcon, ProgressBar, StatusPicker } from "@/features/projects/components/task-fields";
import { usePreferences, useQuickNote, useSaveQuickNote, useUpdatePreferences } from "@/features/settings/hooks";
import { dashboardWidgetIds, type DashboardWidgetId } from "@/features/settings/schemas";

const WIDGETS: Record<DashboardWidgetId, { title: string; icon: typeof Clock; wide?: boolean }> = {
  tasks: { title: "My tasks", icon: CircleCheckBig, wide: true },
  recent: { title: "Recently visited", icon: Clock },
  deadlines: { title: "Upcoming deadlines", icon: CalendarClock },
  projects: { title: "Active projects", icon: FolderKanban },
  favorites: { title: "Favorites", icon: Star },
  quickNote: { title: "Quick note", icon: NotebookPen },
};

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? "Good evening" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

export function DashboardPage() {
  const { workspace, canEdit } = useWorkspaceCtx();
  const prefs = usePreferences();
  const updatePrefs = useUpdatePreferences();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const config = (prefs.data?.dashboard ?? {}) as { order?: DashboardWidgetId[]; hidden?: DashboardWidgetId[] };
  const order = useMemo(() => {
    const saved = (config.order ?? []).filter((id) => dashboardWidgetIds.includes(id));
    return [...saved, ...dashboardWidgetIds.filter((id) => !saved.includes(id))];
  }, [config.order]);
  const hidden = config.hidden ?? [];
  const shown = order.filter((id) => !hidden.includes(id));

  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const next = arrayMove(order, order.indexOf(e.active.id as DashboardWidgetId), order.indexOf(e.over.id as DashboardWidgetId));
    updatePrefs.mutate({ dashboard: { order: next, hidden } });
  };

  const firstName = prefs.data?.displayName.trim().split(" ")[0] ?? "";

  return (
    <>
      <Topbar
        crumbs={[{ label: "Home" }]}
        actions={
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="sm" className="text-muted-foreground">
                <LayoutGrid /> Customize
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-64">
              <p className="mb-1 text-xs text-muted-foreground">Show widgets — drag cards on the page to reorder.</p>
              {order.map((id) => {
                const isHidden = hidden.includes(id);
                const W = WIDGETS[id];
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() =>
                      updatePrefs.mutate({ dashboard: { order, hidden: isHidden ? hidden.filter((h) => h !== id) : [...hidden, id] } })
                    }
                    className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-sm hover:bg-accent"
                  >
                    <W.icon className="size-4 text-muted-foreground" />
                    <span className={cn("flex-1 text-left", isHidden && "text-muted-foreground")}>{W.title}</span>
                    {isHidden ? <EyeOff className="size-3.5 text-muted-foreground" /> : <Eye className="size-3.5" />}
                  </button>
                );
              })}
            </PopoverContent>
          </Popover>
        }
      />
      <div className="flex-1 overflow-y-auto px-[clamp(1.25rem,5vw,4rem)] pt-10 pb-16 scrollbar-thin">
        <div className="mx-auto max-w-5xl">
          <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <IconTile icon={workspace.icon} name={workspace.name} color={workspace.color} className="size-5 text-[11px]" />
                {workspace.name} · {new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
              </p>
              <h1 className="mt-1 text-3xl font-bold tracking-tight">
                {greeting()}
                {firstName && `, ${firstName}`}
              </h1>
            </div>
            {canEdit && <QuickCreate />}
          </div>
          {!prefs.data ? (
            <div className="grid gap-4 md:grid-cols-2">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-56 rounded-xl" />
              ))}
            </div>
          ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
              <SortableContext items={shown} strategy={rectSortingStrategy}>
                <div className="grid gap-4 md:grid-cols-2">
                  {shown.map((id) => (
                    <Widget key={id} id={id}>
                      <WidgetBody id={id} />
                    </Widget>
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}
        </div>
      </div>
    </>
  );
}

function QuickCreate() {
  const { workspaceId } = useWorkspaceCtx();
  const router = useRouter();
  const createPage = useCreatePage(workspaceId);
  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" size="sm" onClick={() => createPage.mutate({})}>
        <FilePlus2 /> Page
      </Button>
      <Button variant="outline" size="sm" onClick={() => createPage.mutate({ kind: "DATABASE", title: "Untitled database" })}>
        <Table2 /> Database
      </Button>
      <Button variant="outline" size="sm" onClick={() => router.push(routes.newProject)}>
        <FolderPlus /> Project
      </Button>
    </div>
  );
}

function Widget({ id, children }: { id: DashboardWidgetId; children: ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const W = WIDGETS[id];
  return (
    <section
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      aria-label={W.title}
      className={cn(
        "group flex min-h-56 flex-col rounded-xl border bg-card shadow-[0_1px_2px_rgba(0,0,0,0.04)]",
        W.wide && "md:col-span-2",
        isDragging && "z-10 opacity-80 shadow-lg",
      )}
    >
      <header className="flex h-11 items-center gap-2 border-b px-4">
        <W.icon className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-medium">{W.title}</h2>
        <button
          type="button"
          {...attributes}
          {...listeners}
          aria-label={`Reorder ${W.title}`}
          className="ml-auto flex size-6 cursor-grab items-center justify-center rounded text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-accent focus-visible:opacity-100 active:cursor-grabbing"
        >
          <GripVertical className="size-4" />
        </button>
      </header>
      <div className="flex flex-1 flex-col p-2">{children}</div>
    </section>
  );
}

function WidgetBody({ id }: { id: DashboardWidgetId }) {
  switch (id) {
    case "tasks":
      return <TasksWidget />;
    case "recent":
      return <RecentWidget />;
    case "deadlines":
      return <DeadlinesWidget />;
    case "projects":
      return <ProjectsWidget />;
    case "favorites":
      return <FavoritesWidget />;
    case "quickNote":
      return <QuickNoteWidget />;
  }
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="flex min-h-32 flex-1 items-center justify-center px-4 text-center text-sm text-muted-foreground">{children}</p>;
}

function ListSkeleton() {
  return (
    <div className="space-y-2 p-2">
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-6" />
      ))}
    </div>
  );
}

function TasksWidget() {
  const { workspaceId, canEdit } = useWorkspaceCtx();
  const dash = useDashboard(workspaceId);
  const update = useUpdateTask(workspaceId);
  const create = useCreateTask(workspaceId);
  const [title, setTitle] = useState("");
  if (!dash.data) return <ListSkeleton />;
  const o = dash.data.overview;
  const stats = [
    ["NOT_STARTED", o.NOT_STARTED ?? 0],
    ["IN_PROGRESS", o.IN_PROGRESS ?? 0],
    ["ON_HOLD", o.ON_HOLD ?? 0],
    ["COMPLETED", o.COMPLETED ?? 0],
  ] as const;
  return (
    <div className="grid gap-3 md:grid-cols-[180px_1fr]">
      <dl className="grid grid-cols-4 gap-2 p-2 md:grid-cols-1">
        {stats.map(([s, n]) => (
          <div key={s} className="rounded-lg bg-muted/50 px-3 py-2">
            <dt className="text-xs text-muted-foreground">{STATUS_LABEL[s]}</dt>
            <dd className="text-xl font-semibold tabular-nums">{n}</dd>
          </div>
        ))}
      </dl>
      <div className="flex min-w-0 flex-col">
        {dash.data.myTasks.length === 0 ? (
          <Empty>Nothing assigned to you. Enjoy the calm.</Empty>
        ) : (
          <ul>
            {dash.data.myTasks.map((t) => (
              <li key={t.id} className="flex h-9 items-center gap-1.5 rounded-md px-1.5 hover:bg-accent/50">
                <StatusPicker value={t.status} disabled={!canEdit} onChange={(status) => update.mutate({ id: t.id, status })} />
                <PriorityIcon priority={t.priority} />
                <Link href={routes.task(t.id)} className="min-w-0 flex-1 truncate text-sm hover:underline">
                  {t.title}
                </Link>
                {t.project && <span className="hidden max-w-32 truncate text-xs text-muted-foreground sm:inline">{t.project.name}</span>}
                <DueBadge due={t.dueDate} />
              </li>
            ))}
          </ul>
        )}
        {canEdit && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!title.trim()) return;
              create.mutate({ title: title.trim() });
              setTitle("");
            }}
            className="mt-1 flex h-9 items-center gap-2 rounded-md px-2 text-muted-foreground focus-within:bg-accent/40"
          >
            <ListPlus className="size-4" />
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Add a task…"
              aria-label="Quick add task"
              className="h-full flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
            />
          </form>
        )}
      </div>
    </div>
  );
}

function RecentWidget() {
  const { workspaceId } = useWorkspaceCtx();
  const recent = useRecent(workspaceId);
  if (!recent.data) return <ListSkeleton />;
  if (!recent.data.length) return <Empty>Pages you open will show up here.</Empty>;
  return (
    <ul>
      {recent.data.slice(0, 7).map((p) => (
        <li key={p.id}>
          <Link href={routes.page(p.id)} className="flex h-8 items-center gap-2 rounded-md px-2 text-sm hover:bg-accent/50">
            <PageIcon icon={p.icon} kind={p.kind} className="size-4 text-[15px]" />
            <span className="min-w-0 flex-1 truncate">{p.title || "Untitled"}</span>
            <span className="text-xs text-muted-foreground">{formatDistanceToNow(new Date(p.visitedAt), { addSuffix: true })}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function FavoritesWidget() {
  const { workspaceId } = useWorkspaceCtx();
  const pages = usePages(workspaceId);
  if (!pages.data) return <ListSkeleton />;
  const byId = new Map(pages.data.pages.map((p) => [p.id, p]));
  const favs = pages.data.favoriteIds.map((id) => byId.get(id)).filter((p) => !!p);
  if (!favs.length) return <Empty>Star a page to pin it here.</Empty>;
  return (
    <ul>
      {favs.map((p) => (
        <li key={p.id}>
          <Link href={routes.page(p.id)} className="flex h-8 items-center gap-2 rounded-md px-2 text-sm hover:bg-accent/50">
            <PageIcon icon={p.icon} kind={p.kind} className="size-4 text-[15px]" />
            <span className="truncate">{p.title || "Untitled"}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function DeadlinesWidget() {
  const { workspaceId } = useWorkspaceCtx();
  const dash = useDashboard(workspaceId);
  if (!dash.data) return <ListSkeleton />;
  if (!dash.data.deadlines.length) return <Empty>No deadlines in the next two weeks.</Empty>;
  return (
    <ul>
      {dash.data.deadlines.map((t) => (
        <li key={t.id}>
          <Link href={routes.task(t.id)} className="flex h-8 items-center gap-2 rounded-md px-2 text-sm hover:bg-accent/50">
            <DueBadge due={t.dueDate} className="w-20 shrink-0" />
            <span className="min-w-0 flex-1 truncate">{t.title}</span>
            {t.assignee && <span className="truncate text-xs text-muted-foreground">{t.assignee.split(" ")[0]}</span>}
          </Link>
        </li>
      ))}
    </ul>
  );
}

function ProjectsWidget() {
  const { workspaceId } = useWorkspaceCtx();
  const dash = useDashboard(workspaceId);
  if (!dash.data) return <ListSkeleton />;
  if (!dash.data.projects.length) {
    return (
      <Empty>
        No active projects.&nbsp;
        <Link className="text-brand hover:underline" href={routes.newProject}>
          Start one
        </Link>
      </Empty>
    );
  }
  return (
    <ul className="space-y-1">
      {dash.data.projects.map((p) => (
        <li key={p.id}>
          <Link href={routes.project(p.id)} className="block rounded-md px-2 py-1.5 hover:bg-accent/50">
            <span className="mb-1 flex items-center gap-2 text-sm">
              <IconTile icon={p.icon} name={p.name} color={p.color} className="size-5 text-[11px]" />
              <span className="truncate">{p.name}</span>
            </span>
            <ProgressBar value={progress(p.counts)} />
          </Link>
        </li>
      ))}
    </ul>
  );
}

function QuickNoteWidget() {
  const { workspaceId } = useWorkspaceCtx();
  const note = useQuickNote(workspaceId);
  if (note.data === undefined) return <ListSkeleton />;
  return <QuickNoteEditor key={workspaceId} workspaceId={workspaceId} initial={note.data} />;
}

function QuickNoteEditor({ workspaceId, initial }: { workspaceId: string; initial: string }) {
  const save = useSaveQuickNote(workspaceId);
  const [text, setText] = useState(initial);
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  return (
    <div className="flex h-full flex-col">
      <textarea
        value={text}
        maxLength={20_000}
        aria-label="Quick note"
        placeholder="Jot something down — it saves automatically."
        onChange={(e) => {
          setText(e.target.value);
          setStatus("saving");
          if (timer.current) clearTimeout(timer.current);
          const value = e.target.value;
          timer.current = setTimeout(() => save.mutate(value, { onSuccess: () => setStatus("saved") }), 400);
        }}
        className="min-h-40 flex-1 resize-none rounded-md bg-transparent p-2 text-sm leading-relaxed outline-none placeholder:text-muted-foreground"
      />
      <p className="px-2 text-right text-[11px] text-muted-foreground" aria-live="polite">
        {status === "saving" ? "Saving…" : status === "saved" ? "Saved" : ""}
      </p>
    </div>
  );
}
