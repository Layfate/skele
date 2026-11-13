// Pure grouping/sorting for task views (unit-tested).
import { PRIORITY_LABEL, STATUS_LABEL, TASK_PRIORITIES, TASK_STATUSES, type TaskPriority, type TaskStatus } from "./schemas";

export type TaskLike = {
  id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string | null;
  rank: string;
  createdAt: string;
  assignee: string | null;
};

export type TaskGroupBy = "status" | "priority" | "assignee" | "none";
export type TaskSortBy = "manual" | "due" | "priority" | "created" | "title";

const PRIORITY_ORDER: Record<TaskPriority, number> = { URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

export function sortTasks<T extends TaskLike>(tasks: T[], sortBy: TaskSortBy): T[] {
  const byRank = (a: T, b: T) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0);
  const list = [...tasks];
  switch (sortBy) {
    case "due":
      return list.sort((a, b) => {
        if (!a.dueDate && !b.dueDate) return byRank(a, b);
        if (!a.dueDate) return 1;
        if (!b.dueDate) return -1;
        return a.dueDate.localeCompare(b.dueDate) || byRank(a, b);
      });
    case "priority":
      return list.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] || byRank(a, b));
    case "created":
      return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    case "title":
      return list.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base", numeric: true }));
    default:
      return list.sort(byRank);
  }
}

export type TaskGroup<T> = { key: string; label: string; tasks: T[] };

export function groupTasks<T extends TaskLike>(tasks: T[], groupBy: TaskGroupBy): TaskGroup<T>[] {
  if (groupBy === "none") return [{ key: "all", label: "All tasks", tasks }];
  if (groupBy === "status") {
    return TASK_STATUSES.map((s) => ({ key: s, label: STATUS_LABEL[s], tasks: tasks.filter((t) => t.status === s) }));
  }
  if (groupBy === "priority") {
    return [...TASK_PRIORITIES].reverse().map((p) => ({ key: p, label: PRIORITY_LABEL[p], tasks: tasks.filter((t) => t.priority === p) }));
  }
  const groups = new Map<string, TaskGroup<T>>();
  for (const t of tasks) {
    const key = t.assignee ?? "__none";
    if (!groups.has(key)) groups.set(key, { key, label: t.assignee ?? "Unassigned", tasks: [] });
    groups.get(key)!.tasks.push(t);
  }
  return [...groups.values()].sort((a, b) => (a.key === "__none" ? 1 : b.key === "__none" ? -1 : a.label.localeCompare(b.label)));
}
