"use client";

import { useMutation, useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { toast } from "sonner";
import { errorMessage } from "@/lib/errors";
import { workspaceStore as st } from "@/data/registry";
import * as repo from "@/data/repo/projects";
import { rankBetween } from "@/lib/rank";
import type {
  CreateProjectInput,
  CreateTaskInput,
  MoveTaskInput,
  UpdateProjectInput,
  UpdateTaskInput,
} from "./schemas";

export type ProjectItem = Awaited<ReturnType<typeof repo.listProjects>>[number];
export type ProjectDetail = Awaited<ReturnType<typeof repo.getProject>>;
export type TaskItem = Awaited<ReturnType<typeof repo.listTasks>>[number];
export type TaskDetail = Awaited<ReturnType<typeof repo.getTask>>;
export type LabelItem = Awaited<ReturnType<typeof repo.listLabels>>[number];
export type DashboardData = Awaited<ReturnType<typeof repo.dashboard>>;

export const projectKeys = {
  list: (ws: string, archived = false) => ["projects", ws, archived] as const,
  one: (ws: string, id: string) => ["project", ws, id] as const,
  tasks: (ws: string, q?: object) => (q ? (["tasks", ws, q] as const) : (["tasks", ws] as const)),
  task: (ws: string, id: string) => ["task", ws, id] as const,
  labels: (ws: string) => ["labels", ws] as const,
  dashboard: (ws: string) => ["dashboard", ws] as const,
};

export function useProjects(ws: string, archived = false) {
  return useQuery({
    queryKey: projectKeys.list(ws, archived),
    queryFn: () => repo.listProjects(st(ws), archived),
  });
}

export function useProject(ws: string, id: string) {
  return useQuery({ queryKey: projectKeys.one(ws, id), queryFn: () => repo.getProject(st(ws), id) });
}

export function useCreateProject(ws: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateProjectInput) => repo.createProject(st(ws), input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["projects", ws] }),
    onError: (e) => toast.error(errorMessage(e)),
  });
}

export function useUpdateProject(ws: string, id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateProjectInput) => repo.updateProject(st(ws), id, input),
    onMutate: (input) => {
      qc.setQueryData<ProjectDetail>(projectKeys.one(ws, id), (p) => (p ? ({ ...p, ...input } as ProjectDetail) : p));
    },
    onError: (e) => toast.error(errorMessage(e)),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: projectKeys.one(ws, id) });
      qc.invalidateQueries({ queryKey: ["projects", ws] });
      qc.invalidateQueries({ queryKey: projectKeys.dashboard(ws) });
    },
  });
}

export function useDeleteProject(ws: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => repo.deleteProject(st(ws), id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["projects", ws] }),
    onError: (e) => toast.error(errorMessage(e)),
  });
}

export function useTasks(ws: string, query: repo.TaskQuery) {
  return useQuery({
    queryKey: projectKeys.tasks(ws, query),
    queryFn: () => repo.listTasks(st(ws), query),
  });
}

export function useTask(ws: string, id: string | null) {
  return useQuery({
    queryKey: projectKeys.task(ws, id ?? ""),
    queryFn: () => repo.getTask(st(ws), id!),
    enabled: !!id,
  });
}

/** Shared helpers to patch every cached task list optimistically. */
function useTaskCache(ws: string) {
  const qc = useQueryClient();
  const listsKey = projectKeys.tasks(ws);
  return {
    qc,
    snapshot: async () => {
      await qc.cancelQueries({ queryKey: listsKey });
      return qc.getQueriesData<TaskItem[]>({ queryKey: listsKey });
    },
    patch: (fn: (list: TaskItem[]) => TaskItem[]) =>
      qc.setQueriesData<TaskItem[]>({ queryKey: listsKey }, (list) => (list ? fn(list) : list)),
    restore: (snap?: [QueryKey, TaskItem[] | undefined][]) => snap?.forEach(([k, v]) => qc.setQueryData(k, v)),
    invalidate: (id?: string) => {
      qc.invalidateQueries({ queryKey: listsKey });
      qc.invalidateQueries({ queryKey: projectKeys.dashboard(ws) });
      qc.invalidateQueries({ queryKey: ["projects", ws] });
      qc.invalidateQueries({ queryKey: ["project", ws] });
      if (id) qc.invalidateQueries({ queryKey: projectKeys.task(ws, id) });
    },
  };
}

export function useCreateTask(ws: string) {
  const cache = useTaskCache(ws);
  return useMutation({
    mutationFn: (input: CreateTaskInput) => repo.createTask(st(ws), input),
    onSuccess: (task) => {
      cache.invalidate(task.parentId ?? undefined);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
}

export function useUpdateTask(ws: string) {
  const cache = useTaskCache(ws);
  return useMutation({
    mutationFn: ({ id, ...input }: UpdateTaskInput & { id: string }) => repo.updateTask(st(ws), id, input),
    onMutate: async ({ id, labelIds: _labels, projectId: _p, ...input }) => {
      const snap = await cache.snapshot();
      cache.patch((list) => list.map((t) => (t.id === id ? ({ ...t, ...input } as TaskItem) : t)));
      cache.qc.setQueryData<TaskDetail>(projectKeys.task(ws, id), (t) => (t ? ({ ...t, ...input } as TaskDetail) : t));
      return { snap };
    },
    onError: (e, _v, ctx) => {
      cache.restore(ctx?.snap);
      toast.error(errorMessage(e));
    },
    onSettled: (_d, _e, { id }) => cache.invalidate(id),
  });
}

export function useMoveTask(ws: string) {
  const cache = useTaskCache(ws);
  return useMutation({
    mutationFn: ({ id, ...input }: MoveTaskInput & { id: string }) => repo.moveTask(st(ws), id, input),
    onMutate: async ({ id, status, beforeId, afterId }) => {
      const snap = await cache.snapshot();
      cache.patch((list) => {
        const rankOf = (tid?: string | null) => list.find((t) => t.id === tid)?.rank ?? null;
        const b = rankOf(beforeId);
        const a = rankOf(afterId);
        return list
          .map((t) => (t.id === id ? { ...t, status: status ?? t.status, rank: b || a ? rankBetween(b, a) : t.rank } : t))
          .sort((x, y) => (x.rank < y.rank ? -1 : x.rank > y.rank ? 1 : 0));
      });
      return { snap };
    },
    onError: (e, _v, ctx) => {
      cache.restore(ctx?.snap);
      toast.error(errorMessage(e));
    },
    onSettled: (_d, _e, { id }) => cache.invalidate(id),
  });
}

export function useDeleteTask(ws: string) {
  const cache = useTaskCache(ws);
  return useMutation({
    mutationFn: (id: string) => repo.deleteTasks(st(ws), [id]),
    onMutate: async (id) => {
      const snap = await cache.snapshot();
      cache.patch((list) => list.filter((t) => t.id !== id));
      return { snap };
    },
    onSuccess: () => toast.success("Task deleted"),
    onError: (e, _v, ctx) => {
      cache.restore(ctx?.snap);
      toast.error(errorMessage(e));
    },
    onSettled: () => cache.invalidate(),
  });
}

type BulkTaskChange = Parameters<typeof repo.updateTasks>[2];

/** Applies one change to several tasks (list multi-select). */
export function useUpdateTasks(ws: string) {
  const cache = useTaskCache(ws);
  return useMutation({
    mutationFn: ({ ids, ...input }: BulkTaskChange & { ids: string[] }) => repo.updateTasks(st(ws), ids, input),
    onMutate: async ({ ids, ...input }) => {
      const snap = await cache.snapshot();
      const set = new Set(ids);
      cache.patch((list) => list.map((t) => (set.has(t.id) ? ({ ...t, ...input } as TaskItem) : t)));
      return { snap };
    },
    onSuccess: ({ count }) => toast.success(`Updated ${count} task${count === 1 ? "" : "s"}`),
    onError: (e, _v, ctx) => {
      cache.restore(ctx?.snap);
      toast.error(errorMessage(e));
    },
    onSettled: () => cache.invalidate(),
  });
}

export function useDeleteTasks(ws: string) {
  const cache = useTaskCache(ws);
  return useMutation({
    mutationFn: (ids: string[]) => repo.deleteTasks(st(ws), ids),
    onMutate: async (ids) => {
      const snap = await cache.snapshot();
      const set = new Set(ids);
      cache.patch((list) => list.filter((t) => !set.has(t.id)));
      return { snap };
    },
    onSuccess: (_d, ids) => toast.success(`Deleted ${ids.length} task${ids.length === 1 ? "" : "s"}`),
    onError: (e, _v, ctx) => {
      cache.restore(ctx?.snap);
      toast.error(errorMessage(e));
    },
    onSettled: () => cache.invalidate(),
  });
}

export function useLabels(ws: string) {
  return useQuery({ queryKey: projectKeys.labels(ws), queryFn: () => repo.listLabels(st(ws)) });
}

export function useCreateLabel(ws: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; color?: string }) => repo.createLabel(st(ws), input),
    onSuccess: (label) => qc.setQueryData<LabelItem[]>(projectKeys.labels(ws), (l) => [...(l ?? []), label]),
    onError: (e) => toast.error(errorMessage(e)),
  });
}

export function useAddComment(ws: string, taskId: string, author = "Me") {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: string) => repo.addComment(st(ws), taskId, body, author),
    onSuccess: () => qc.invalidateQueries({ queryKey: projectKeys.task(ws, taskId) }),
    onError: (e) => toast.error(errorMessage(e)),
  });
}

export function useDeleteComment(ws: string, taskId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (commentId: string) => repo.deleteComment(st(ws), commentId),
    onSuccess: () => qc.invalidateQueries({ queryKey: projectKeys.task(ws, taskId) }),
    onError: (e) => toast.error(errorMessage(e)),
  });
}

/** Names used for assignees, project leads and person properties. */
export function usePeople(ws: string) {
  return useQuery({ queryKey: ["people", ws], queryFn: () => repo.listPeople(st(ws)) });
}

export function useDashboard(ws: string) {
  return useQuery({ queryKey: projectKeys.dashboard(ws), queryFn: () => repo.dashboard(st(ws)) });
}
