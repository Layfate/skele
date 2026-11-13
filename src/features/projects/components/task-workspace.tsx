"use client";

import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  ChevronDown,
  CircleCheckBig,
  Columns3,
  List,
  Plus,
  Search,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ColorDot, EmptyState } from "@/components/common";
import { MonthCalendar } from "@/components/month-calendar";
import { cn } from "@/lib/utils";
import type { TaskQuery } from "@/data/repo/projects";
import { useWorkspaceCtx } from "@/features/shell/workspace-context";
import { useCreateTask, useDeleteTasks, useMoveTask, useTasks, useUpdateTask, useUpdateTasks, type TaskItem } from "../hooks";
import {
  PRIORITY_LABEL,
  STATUS_LABEL,
  TASK_PRIORITIES,
  TASK_STATUSES,
  type CreateTaskInput,
  type TaskPriority,
  type TaskStatus,
} from "../schemas";
import { groupTasks, sortTasks, type TaskGroupBy, type TaskSortBy } from "../task-view-logic";
import {
  AssigneePicker,
  DueBadge,
  LabelChips,
  PriorityIcon,
  PriorityPicker,
  StatusIcon,
  StatusPicker,
} from "./task-fields";
import { TaskSheet } from "./task-sheet";

type ViewMode = "list" | "board" | "calendar";
type Prefs = { view: ViewMode; groupBy: TaskGroupBy; sortBy: TaskSortBy; status: TaskStatus[]; priority: TaskPriority[]; hideDone: boolean };
const DEFAULT_PREFS: Prefs = { view: "list", groupBy: "status", sortBy: "manual", status: [], priority: [], hideDone: false };

function usePrefs(key: string) {
  const [prefs, setPrefs] = useState<Prefs>(() => {
    try {
      const raw = typeof window !== "undefined" ? localStorage.getItem(key) : null;
      return raw ? { ...DEFAULT_PREFS, ...JSON.parse(raw) } : DEFAULT_PREFS;
    } catch {
      return DEFAULT_PREFS;
    }
  });
  const update = (patch: Partial<Prefs>) =>
    setPrefs((p) => {
      const next = { ...p, ...patch };
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {}
      return next;
    });
  return [prefs, update] as const;
}

/**
 * Task list/board/calendar used by project pages and "My tasks".
 * `query` scopes the tasks; `defaults` pre-fills new tasks (e.g. projectId).
 */
export function TaskWorkspace({
  query,
  defaults,
  prefsKey,
  showProject,
}: {
  query: TaskQuery;
  defaults: Partial<CreateTaskInput>;
  prefsKey: string;
  showProject?: boolean;
}) {
  const { workspaceId, canEdit } = useWorkspaceCtx();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [prefs, setPrefs] = usePrefs(`skele-tasks:${prefsKey}`);
  const [search, setSearch] = useState("");
  const tasks = useTasks(workspaceId, query);
  const openTaskId = params.get("task");

  const openTask = (id: string | null) => {
    const next = new URLSearchParams(params.toString());
    if (id) next.set("task", id);
    else next.delete("task");
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const visible = useMemo(() => {
    let list = tasks.data ?? [];
    if (prefs.status.length) list = list.filter((t) => prefs.status.includes(t.status));
    if (prefs.priority.length) list = list.filter((t) => prefs.priority.includes(t.priority));
    if (prefs.hideDone) list = list.filter((t) => t.status !== "COMPLETED" && t.status !== "CANCELLED");
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((t) => t.title.toLowerCase().includes(q));
    return sortTasks(list, prefs.sortBy);
  }, [tasks.data, prefs, search]);

  const filterCount = prefs.status.length + prefs.priority.length + (prefs.hideDone ? 1 : 0);

  // Multi-select (list view): Ctrl/Cmd-click or the row checkbox toggles, Shift-click selects a range.
  const [picked, setPicked] = useState<string[]>([]);
  const [anchor, setAnchor] = useState<string | null>(null);
  const visibleIds = useMemo(() => {
    if (prefs.view !== "list") return [];
    return groupTasks(visible, prefs.groupBy).flatMap((g) => g.tasks.map((t) => t.id));
  }, [visible, prefs.view, prefs.groupBy]);
  const selected = useMemo(() => picked.filter((id) => visibleIds.includes(id)), [picked, visibleIds]);
  const select = (id: string, mode: "toggle" | "range") => {
    if (mode === "range" && anchor && visibleIds.includes(anchor)) {
      const [a, b] = [visibleIds.indexOf(anchor), visibleIds.indexOf(id)].sort((x, y) => x - y);
      setPicked((p) => [...new Set([...p, ...visibleIds.slice(a, b + 1)])]);
    } else {
      setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
      setAnchor(id);
    }
  };
  const clearSelection = () => setPicked([]);
  useEffect(() => {
    if (!selected.length) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPicked([]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected.length]);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-1 border-b pb-2">
        <div className="flex items-center rounded-md bg-muted p-0.5" role="tablist" aria-label="Task view">
          {(
            [
              ["list", List, "List"],
              ["board", Columns3, "Board"],
              ["calendar", CalendarDays, "Calendar"],
            ] as const
          ).map(([mode, Icon, label]) => (
            <button
              key={mode}
              type="button"
              role="tab"
              aria-selected={prefs.view === mode}
              onClick={() => setPrefs({ view: mode })}
              className={cn(
                "flex h-7 items-center gap-1.5 rounded px-2.5 text-sm text-muted-foreground",
                prefs.view === mode && "bg-background text-foreground shadow-sm",
              )}
            >
              <Icon className="size-3.5" /> {label}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-1">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search tasks"
              aria-label="Search tasks"
              className="h-8 w-40 rounded-md border bg-background pr-2 pl-7 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="sm" className={cn("text-muted-foreground", filterCount && "text-brand")}>
                <SlidersHorizontal /> Display{filterCount ? ` · ${filterCount}` : ""}
                <ChevronDown className="size-3" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72 space-y-4">
              {prefs.view === "list" && (
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Group by</Label>
                  <select
                    className="h-8 w-full rounded-md border bg-background px-2 text-sm"
                    value={prefs.groupBy}
                    onChange={(e) => setPrefs({ groupBy: e.target.value as TaskGroupBy })}
                  >
                    <option value="status">Status</option>
                    <option value="priority">Priority</option>
                    <option value="assignee">Assignee</option>
                    <option value="none">No grouping</option>
                  </select>
                </div>
              )}
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Sort by</Label>
                <select
                  className="h-8 w-full rounded-md border bg-background px-2 text-sm"
                  value={prefs.sortBy}
                  onChange={(e) => setPrefs({ sortBy: e.target.value as TaskSortBy })}
                >
                  <option value="manual">Manual</option>
                  <option value="due">Due date</option>
                  <option value="priority">Priority</option>
                  <option value="created">Newest</option>
                  <option value="title">Title</option>
                </select>
              </div>
              <FilterChips
                label="Status"
                options={TASK_STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] }))}
                value={prefs.status}
                onChange={(status) => setPrefs({ status: status as TaskStatus[] })}
              />
              <FilterChips
                label="Priority"
                options={TASK_PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABEL[p] }))}
                value={prefs.priority}
                onChange={(priority) => setPrefs({ priority: priority as TaskPriority[] })}
              />
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={prefs.hideDone} onCheckedChange={(v) => setPrefs({ hideDone: v === true })} />
                Hide completed and cancelled
              </label>
              {filterCount > 0 && (
                <Button variant="ghost" size="sm" onClick={() => setPrefs({ status: [], priority: [], hideDone: false })}>
                  Clear filters
                </Button>
              )}
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {tasks.isPending ? (
        <div className="space-y-2">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-9" />
          ))}
        </div>
      ) : prefs.view === "board" ? (
        <TaskBoard tasks={visible} onOpen={openTask} defaults={defaults} showProject={showProject} />
      ) : prefs.view === "calendar" ? (
        <TaskCalendar tasks={visible} onOpen={openTask} defaults={defaults} />
      ) : (
        <TaskList
          tasks={visible}
          groupBy={prefs.groupBy}
          onOpen={openTask}
          defaults={defaults}
          showProject={showProject}
          selected={canEdit ? selected : undefined}
          onSelect={canEdit ? select : undefined}
        />
      )}
      {prefs.view === "list" && selected.length > 0 && <BulkBar ids={selected} onDone={clearSelection} />}
      {!tasks.isPending && (tasks.data?.length ?? 0) === 0 && prefs.view !== "calendar" && !canEdit && (
        <EmptyState icon={CircleCheckBig} title="No tasks yet" />
      )}
      <TaskSheet taskId={openTaskId} onClose={() => openTask(null)} onOpen={openTask} />
    </div>
  );
}

function FilterChips({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: string; label: string }[];
  value: string[];
  onChange: (v: string[]) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <div className="flex flex-wrap gap-1">
        {options.map((o) => {
          const on = value.includes(o.value);
          return (
            <button
              key={o.value}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(on ? value.filter((v) => v !== o.value) : [...value, o.value])}
              className={cn(
                "h-6 rounded-full border px-2 text-xs text-muted-foreground hover:bg-accent",
                on && "border-brand bg-brand-soft text-foreground",
              )}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function QuickAdd({ defaults, status, placeholder = "Add a task…" }: { defaults: Partial<CreateTaskInput>; status?: TaskStatus; placeholder?: string }) {
  const { workspaceId, canEdit } = useWorkspaceCtx();
  const create = useCreateTask(workspaceId);
  const [title, setTitle] = useState("");
  if (!canEdit) return null;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!title.trim()) return;
        create.mutate({ ...defaults, status: status ?? defaults.status, title: title.trim() });
        setTitle("");
      }}
      className="flex h-9 items-center gap-2 rounded-md px-2 text-sm text-muted-foreground focus-within:bg-accent/50 hover:bg-accent/40"
    >
      <Plus className="size-4 shrink-0" />
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={placeholder}
        aria-label="New task title"
        maxLength={500}
        className="h-full min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground"
      />
    </form>
  );
}

export function TaskRow({
  task,
  onOpen,
  showProject,
  selected,
  selecting,
  onSelect,
}: {
  task: TaskItem;
  onOpen: (id: string) => void;
  showProject?: boolean;
  selected?: boolean;
  /** Some row is selected, so checkboxes stay visible and plain clicks select. */
  selecting?: boolean;
  onSelect?: (id: string, mode: "toggle" | "range") => void;
}) {
  const { workspaceId, canEdit } = useWorkspaceCtx();
  const update = useUpdateTask(workspaceId);
  const done = task.status === "COMPLETED" || task.status === "CANCELLED";
  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={onSelect ? !!selected : undefined}
      onClick={(e) => {
        if (onSelect && (e.shiftKey || e.ctrlKey || e.metaKey || selecting)) {
          e.preventDefault();
          onSelect(task.id, e.shiftKey ? "range" : "toggle");
        } else onOpen(task.id);
      }}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter") onOpen(task.id);
        if (e.key === " " && onSelect) {
          e.preventDefault();
          onSelect(task.id, "toggle");
        }
      }}
      className={cn(
        "group flex min-h-10 cursor-pointer items-center gap-1.5 rounded-md px-1.5 select-none hover:bg-accent/50 focus-visible:bg-accent/50 focus-visible:outline-none",
        selected && "bg-brand-soft hover:bg-brand-soft",
      )}
    >
      {onSelect && (
        <span
          className={cn(
            "flex w-5 shrink-0 justify-center opacity-0 group-hover:opacity-100 focus-within:opacity-100",
            (selecting || selected) && "opacity-100",
          )}
          onClick={(e) => e.stopPropagation()}
        >
          <Checkbox
            checked={!!selected}
            aria-label={`Select ${task.title}`}
            onClick={(e) => {
              e.preventDefault();
              onSelect(task.id, e.shiftKey ? "range" : "toggle");
            }}
          />
        </span>
      )}
      <PriorityPicker value={task.priority} disabled={!canEdit} onChange={(priority) => update.mutate({ id: task.id, priority })} />
      <StatusPicker value={task.status} disabled={!canEdit} onChange={(status) => update.mutate({ id: task.id, status })} />
      <span className={cn("min-w-0 flex-1 truncate text-sm", done && "text-muted-foreground line-through decoration-foreground/30")}>
        {task.title}
      </span>
      {task._count.subtasks > 0 && <span className="text-xs text-muted-foreground">{task._count.subtasks} sub</span>}
      <span className="hidden items-center gap-1 md:flex">
        <LabelChips labels={task.labels} />
      </span>
      {showProject && task.project && (
        <span className="hidden max-w-36 items-center gap-1.5 truncate text-xs text-muted-foreground sm:flex">
          {task.project.icon ?? <ColorDot color={task.project.color} />}
          <span className="truncate">{task.project.name}</span>
        </span>
      )}
      <DueBadge due={task.dueDate} />
      <AssigneePicker
        workspaceId={workspaceId}
        value={task.assignee}
        disabled={!canEdit}
        onChange={(assignee) => update.mutate({ id: task.id, assignee })}
      />
    </div>
  );
}

function TaskList({
  tasks,
  groupBy,
  onOpen,
  defaults,
  showProject,
  selected,
  onSelect,
}: {
  tasks: TaskItem[];
  groupBy: TaskGroupBy;
  onOpen: (id: string) => void;
  defaults: Partial<CreateTaskInput>;
  showProject?: boolean;
  selected?: string[];
  onSelect?: (id: string, mode: "toggle" | "range") => void;
}) {
  const groups = groupTasks(tasks, groupBy).filter((g) => groupBy !== "status" || g.tasks.length > 0 || g.key === "NOT_STARTED");
  return (
    <div className="space-y-5">
      {groups.map((g) => (
        <section key={g.key} aria-label={g.label}>
          {groupBy !== "none" && (
            <h3 className="mb-1 flex items-center gap-2 px-1.5 text-sm font-medium">
              {groupBy === "status" && <StatusIcon status={g.key as TaskStatus} />}
              {groupBy === "priority" && <PriorityIcon priority={g.key as TaskPriority} />}
              {g.label}
              <span className="text-xs font-normal text-muted-foreground">{g.tasks.length}</span>
            </h3>
          )}
          <div className="divide-y divide-border/60">
            {g.tasks.map((t) => (
              <TaskRow
                key={t.id}
                task={t}
                onOpen={onOpen}
                showProject={showProject}
                selected={selected?.includes(t.id)}
                selecting={!!selected?.length}
                onSelect={onSelect}
              />
            ))}
          </div>
          <QuickAdd
            defaults={{
              ...defaults,
              ...(groupBy === "priority" ? { priority: g.key as TaskPriority } : {}),
            }}
            status={groupBy === "status" ? (g.key as TaskStatus) : undefined}
          />
        </section>
      ))}
    </div>
  );
}

const dayOffset = (days: number) => {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + days);
  return d.toISOString();
};

type BulkChange = Omit<Parameters<ReturnType<typeof useUpdateTasks>["mutate"]>[0], "ids">;

function BulkBar({ ids, onDone }: { ids: string[]; onDone: () => void }) {
  const { workspaceId } = useWorkspaceCtx();
  const update = useUpdateTasks(workspaceId);
  const remove = useDeleteTasks(workspaceId);
  const apply = (change: BulkChange) => update.mutate({ ids, ...change });
  const [confirming, setConfirming] = useState(false);
  return (
    <div
      role="toolbar"
      aria-label="Selected tasks"
      className="fixed bottom-5 left-1/2 z-40 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-wrap items-center gap-1 rounded-xl border bg-popover p-1.5 text-sm shadow-lg"
    >
      <span className="px-2 font-medium tabular-nums">{ids.length} selected</span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm">
            Status <ChevronDown className="size-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center" side="top">
          {TASK_STATUSES.map((st) => (
            <DropdownMenuItem key={st} onSelect={() => apply({ status: st })}>
              <StatusIcon status={st} /> {STATUS_LABEL[st]}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm">
            Priority <ChevronDown className="size-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center" side="top">
          {TASK_PRIORITIES.map((p) => (
            <DropdownMenuItem key={p} onSelect={() => apply({ priority: p })}>
              <PriorityIcon priority={p} /> {PRIORITY_LABEL[p]}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm">
            Due <ChevronDown className="size-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center" side="top">
          <DropdownMenuItem onSelect={() => apply({ dueDate: dayOffset(0) })}>Today</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => apply({ dueDate: dayOffset(1) })}>Tomorrow</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => apply({ dueDate: dayOffset(7) })}>In a week</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => apply({ dueDate: null })}>No due date</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AssigneePicker workspaceId={workspaceId} value={null} showLabel onChange={(assignee) => apply({ assignee })} />
      {confirming ? (
        <Button
          variant="destructive"
          size="sm"
          onClick={() => {
            remove.mutate(ids);
            onDone();
          }}
        >
          Delete {ids.length}?
        </Button>
      ) : (
        <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setConfirming(true)}>
          <Trash2 /> Delete
        </Button>
      )}
      <Button variant="ghost" size="icon-sm" aria-label="Clear selection" onClick={onDone}>
        <X />
      </Button>
    </div>
  );
}

function TaskBoard({
  tasks,
  onOpen,
  defaults,
  showProject,
}: {
  tasks: TaskItem[];
  onOpen: (id: string) => void;
  defaults: Partial<CreateTaskInput>;
  showProject?: boolean;
}) {
  const { workspaceId, canEdit } = useWorkspaceCtx();
  const move = useMoveTask(workspaceId);
  const [active, setActive] = useState<TaskItem | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const columns = groupTasks(tasks, "status");

  const onDragEnd = (e: DragEndEvent) => {
    setActive(null);
    if (!e.over) return;
    const taskId = String(e.active.id).replace("task:", "");
    const overId = String(e.over.id);
    let status: TaskStatus;
    let beforeCard: string | null = null;
    if (overId.startsWith("col:")) status = overId.slice(4) as TaskStatus;
    else {
      beforeCard = overId.replace("task:", "");
      if (beforeCard === taskId) return;
      status = tasks.find((t) => t.id === beforeCard)!.status;
    }
    const column = columns.find((c) => c.key === status)!.tasks.filter((t) => t.id !== taskId);
    let beforeId: string | null = column.at(-1)?.id ?? null;
    let afterId: string | null = null;
    if (beforeCard) {
      const idx = column.findIndex((t) => t.id === beforeCard);
      beforeId = column[idx - 1]?.id ?? null;
      afterId = beforeCard;
    }
    move.mutate({ id: taskId, status, beforeId, afterId });
  };

  return (
    <DndContext
      sensors={sensors}
      onDragStart={(e) => setActive(tasks.find((t) => `task:${t.id}` === e.active.id) ?? null)}
      onDragEnd={onDragEnd}
      onDragCancel={() => setActive(null)}
    >
      <div className="flex gap-3 overflow-x-auto pb-4 scrollbar-thin">
        {columns.map((col) => (
          <BoardColumn key={col.key} status={col.key as TaskStatus} count={col.tasks.length}>
            {col.tasks.map((t) => (
              <BoardCard key={t.id} task={t} onOpen={onOpen} draggable={canEdit} showProject={showProject} />
            ))}
            <QuickAdd defaults={defaults} status={col.key as TaskStatus} placeholder="Add…" />
          </BoardColumn>
        ))}
      </div>
      <DragOverlay dropAnimation={null}>{active && <CardBody task={active} dragging showProject={showProject} />}</DragOverlay>
    </DndContext>
  );
}

function BoardColumn({ status, count, children }: { status: TaskStatus; count: number; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: `col:${status}` });
  return (
    <section ref={setNodeRef} aria-label={STATUS_LABEL[status]} className={cn("flex w-72 shrink-0 flex-col rounded-lg bg-muted/40 p-1.5", isOver && "bg-brand-soft")}>
      <header className="mb-1.5 flex h-7 items-center gap-2 px-1.5 text-sm font-medium">
        <StatusIcon status={status} />
        {STATUS_LABEL[status]}
        <span className="text-xs font-normal text-muted-foreground">{count}</span>
      </header>
      <div className="flex min-h-10 flex-col gap-1.5">{children}</div>
    </section>
  );
}

function BoardCard({ task, onOpen, draggable, showProject }: { task: TaskItem; onOpen: (id: string) => void; draggable: boolean; showProject?: boolean }) {
  const drag = useDraggable({ id: `task:${task.id}`, disabled: !draggable });
  const drop = useDroppable({ id: `task:${task.id}` });
  return (
    <div
      ref={(n) => {
        drag.setNodeRef(n);
        drop.setNodeRef(n);
      }}
      {...drag.attributes}
      {...drag.listeners}
      onClick={() => onOpen(task.id)}
      className={cn("relative", drag.isDragging && "opacity-30")}
    >
      {drop.isOver && !drag.isDragging && <span className="absolute -top-1 right-1 left-1 h-0.5 rounded bg-brand" />}
      <CardBody task={task} showProject={showProject} />
    </div>
  );
}

function CardBody({ task, dragging, showProject }: { task: TaskItem; dragging?: boolean; showProject?: boolean }) {
  return (
    <div
      className={cn(
        "cursor-pointer rounded-md border bg-card p-2.5 text-sm shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-shadow hover:shadow-md",
        dragging && "rotate-1 shadow-lg",
      )}
    >
      <div className="flex items-start gap-2">
        <PriorityIcon priority={task.priority} className="mt-0.5" />
        <span className="min-w-0 flex-1 font-medium break-words">{task.title}</span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <LabelChips labels={task.labels} />
        <DueBadge due={task.dueDate} />
        {showProject && task.project && <span className="truncate text-xs text-muted-foreground">{task.project.name}</span>}
        {task.assignee && (
          <span
            title={task.assignee}
            className="ml-auto flex size-5 items-center justify-center rounded-full bg-brand-soft text-[10px] font-semibold text-brand"
          >
            {task.assignee.charAt(0).toUpperCase()}
          </span>
        )}
      </div>
    </div>
  );
}

function TaskCalendar({ tasks, onOpen, defaults }: { tasks: TaskItem[]; onOpen: (id: string) => void; defaults: Partial<CreateTaskInput> }) {
  const { workspaceId, canEdit } = useWorkspaceCtx();
  const update = useUpdateTask(workspaceId);
  const create = useCreateTask(workspaceId);
  const items = tasks.filter((t) => t.dueDate).map((t) => ({ ...t, date: t.dueDate! }));
  const undated = tasks.length - items.length;
  return (
    <MonthCalendar
      items={items}
      editable={canEdit}
      onMove={(id, date) => update.mutate({ id, dueDate: date })}
      onAdd={(date) => {
        const title = prompt("New task")?.trim();
        if (title) create.mutate({ ...defaults, title, dueDate: date });
      }}
      renderItem={(t) => (
        <button
          type="button"
          onClick={() => onOpen(t.id)}
          className={cn(
            "flex w-full items-center gap-1 truncate rounded border bg-card px-1.5 py-0.5 text-left text-xs shadow-sm hover:bg-accent",
            t.status === "COMPLETED" && "text-muted-foreground line-through",
          )}
        >
          <StatusIcon status={t.status} className="size-3" />
          <span className="truncate">{t.title}</span>
        </button>
      )}
      footer={undated > 0 ? <p className="mt-2 text-xs text-muted-foreground">{undated} tasks without a due date are not shown.</p> : null}
    />
  );
}
