"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { errorMessage } from "@/lib/errors";
import * as registry from "@/data/registry";
import { createSampleWorkspace, createWorkspace, deleteWorkspace } from "@/data/workspaces";
import { importWorkspace } from "@/data/backup";
import type { WorkspaceMeta } from "@/data/types";
import type { CreateWorkspaceInput, UpdateWorkspaceInput } from "./schemas";

export type WorkspaceSummary = WorkspaceMeta;
export type WorkspaceDetail = WorkspaceMeta & { role: "OWNER" };

export const wsKeys = {
  all: ["workspaces"] as const,
  one: (id: string) => ["workspace", id] as const,
  current: ["current-workspace"] as const,
};

export function useWorkspaces() {
  return useQuery({ queryKey: wsKeys.all, queryFn: registry.listWorkspaces });
}

export function useCurrentWorkspaceId() {
  return useQuery({ queryKey: wsKeys.current, queryFn: registry.getCurrentWorkspaceId });
}

export function useWorkspace(id: string | null | undefined) {
  return useQuery({
    queryKey: wsKeys.one(id ?? ""),
    queryFn: async (): Promise<WorkspaceDetail> => ({ ...(await registry.getWorkspace(id!)), role: "OWNER" }),
    enabled: !!id,
  });
}

/** Makes a workspace the active one (and remembers it for next launch). */
export function useOpenWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await registry.markOpened(id);
      return id;
    },
    onSuccess: (id) => {
      qc.setQueryData(wsKeys.current, id);
      qc.invalidateQueries({ queryKey: wsKeys.all });
    },
  });
}

export function useCreateWorkspace() {
  const qc = useQueryClient();
  const open = useOpenWorkspace();
  return useMutation({
    mutationFn: async (input: CreateWorkspaceInput & { sample?: boolean }) =>
      input.sample ? createSampleWorkspace() : createWorkspace({ name: input.name, icon: input.icon, color: input.color }),
    onSuccess: async (ws) => {
      await open.mutateAsync(ws.id);
      qc.invalidateQueries({ queryKey: wsKeys.all });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
}

export function useImportWorkspace() {
  const qc = useQueryClient();
  const open = useOpenWorkspace();
  return useMutation({
    mutationFn: async (file: File) => importWorkspace(new Uint8Array(await file.arrayBuffer())),
    onSuccess: async ({ workspace, problems, counts }) => {
      await open.mutateAsync(workspace.id);
      qc.invalidateQueries({ queryKey: wsKeys.all });
      toast.success(`Imported “${workspace.name}” — ${counts.pages} pages, ${counts.tasks} tasks, ${counts.files} files`);
      if (problems.length) toast.warning(`${problems.length} attachment(s) couldn't be imported: ${problems.slice(0, 3).join("; ")}`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
}

export function useUpdateWorkspace(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateWorkspaceInput) => registry.updateWorkspace(id, input),
    onSuccess: (ws) => {
      qc.setQueryData<WorkspaceDetail>(wsKeys.one(id), { ...ws, role: "OWNER" });
      qc.invalidateQueries({ queryKey: wsKeys.all });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
}

export function useDeleteWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await deleteWorkspace(id);
      return id;
    },
    onSuccess: (id) => {
      qc.removeQueries({ queryKey: wsKeys.one(id) });
      qc.invalidateQueries({ queryKey: wsKeys.all });
      qc.invalidateQueries({ queryKey: wsKeys.current });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
}
