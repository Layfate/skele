"use client";

import { createContext, useContext, useMemo } from "react";
import { workspaceStore } from "@/data/registry";
import type { WorkspaceStore } from "@/data/store";
import type { WorkspaceDetail } from "@/features/workspaces/hooks";

// Skele is single-user and local: the person using the app owns the workspace. The permission
// flags remain so read-only states (e.g. a page in the trash) can still be expressed per screen.
type WorkspaceCtx = {
  workspaceId: string;
  workspace: WorkspaceDetail;
  store: WorkspaceStore;
  role: "OWNER";
  canEdit: boolean;
  canManage: boolean;
  canPurge: boolean;
};

const Ctx = createContext<WorkspaceCtx | null>(null);

export function WorkspaceProvider({ workspace, children }: { workspace: WorkspaceDetail; children: React.ReactNode }) {
  const value = useMemo<WorkspaceCtx>(
    () => ({
      workspaceId: workspace.id,
      workspace,
      store: workspaceStore(workspace.id),
      role: "OWNER",
      canEdit: true,
      canManage: true,
      canPurge: true,
    }),
    [workspace],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWorkspaceCtx() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useWorkspaceCtx must be used inside a workspace");
  return ctx;
}

/** The storage for the active workspace. */
export const useStore = () => useWorkspaceCtx().store;
