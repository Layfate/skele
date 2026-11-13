"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useUI } from "@/stores/ui";
import { useIsMobile } from "@/hooks/use-media-query";
import { routes } from "@/lib/routes";
import { workspaceStore } from "@/data/registry";
import { SNAPSHOT_INTERVAL_MS, takeSnapshot } from "@/data/snapshots";
import { useAppearanceSync } from "@/features/settings/hooks";
import { useCurrentWorkspaceId, useWorkspace } from "@/features/workspaces/hooks";
import { CommandPalette } from "@/features/search/components/command-palette";
import { SpotifyFloatingPlayer } from "@/features/spotify/components/spotify-player";
import { Sidebar, SidebarContent } from "./sidebar";
import { WorkspaceProvider } from "./workspace-context";
import { useShortcuts } from "./shortcuts";

export function WorkspaceShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const current = useCurrentWorkspaceId();
  const workspace = useWorkspace(current.data);
  const isMobile = useIsMobile();
  const mobileOpen = useUI((s) => s.mobileSidebarOpen);
  const setMobileOpen = useUI((s) => s.setMobileSidebarOpen);
  useAppearanceSync();
  useShortcuts();
  useCrossTabSync(current.data ?? null);
  useAutoSnapshots(current.data ?? null);

  useEffect(() => {
    // First launch (or every workspace deleted): show the welcome screen.
    if (current.isSuccess && !current.data) router.replace(routes.welcome);
  }, [current.isSuccess, current.data, router]);

  if (!workspace.data) return <ShellSkeleton />;

  return (
    <WorkspaceProvider workspace={workspace.data}>
      <div className="flex h-full">
        <Sidebar />
        {isMobile && (
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetContent side="left" className="bg-sidebar p-0 data-[side=left]:w-[280px]" showCloseButton={false}>
              <SheetTitle className="sr-only">Navigation</SheetTitle>
              <SidebarContent onNavigate={() => setMobileOpen(false)} />
            </SheetContent>
          </Sheet>
        )}
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">{children}</main>
      </div>
      <CommandPalette />
      <SpotifyFloatingPlayer />
    </WorkspaceProvider>
  );
}

/** Other tabs/windows of Skele refresh their data when this one writes (and vice versa). */
function useCrossTabSync(workspaceId: string | null) {
  const qc = useQueryClient();
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel("skele-changes");
    channel.onmessage = (e: MessageEvent<{ workspaceId?: string }>) => {
      if (!e.data?.workspaceId || e.data.workspaceId === workspaceId) qc.invalidateQueries();
    };
    const unsubscribe = qc.getMutationCache().subscribe((event) => {
      if (event.type === "updated" && event.mutation.state.status === "success") {
        channel.postMessage({ workspaceId });
      }
    });
    return () => {
      unsubscribe();
      channel.close();
    };
  }, [qc, workspaceId]);
}

/** Takes a recovery snapshot every few minutes while changes are being made. */
function useAutoSnapshots(workspaceId: string | null) {
  const qc = useQueryClient();
  const dirty = useRef(false);
  useEffect(() => {
    if (!workspaceId) return;
    const unsubscribe = qc.getMutationCache().subscribe((event) => {
      if (event.type === "updated" && event.mutation.state.status === "success") dirty.current = true;
    });
    const timer = setInterval(() => {
      if (!dirty.current || document.visibilityState === "hidden") return;
      dirty.current = false;
      takeSnapshot(workspaceStore(workspaceId)).catch((e) => console.warn("[skele] snapshot failed", e));
    }, SNAPSHOT_INTERVAL_MS);
    return () => {
      unsubscribe();
      clearInterval(timer);
    };
  }, [qc, workspaceId]);
}

export function ShellSkeleton() {
  return (
    <div className="flex h-full" aria-busy="true" aria-label="Loading workspace">
      <div className="hidden w-[260px] shrink-0 space-y-3 border-r bg-sidebar p-3 md:block">
        <Skeleton className="h-8 w-40" />
        <div className="space-y-2 pt-2">
          {[60, 45, 50, 70, 55].map((w, i) => (
            <Skeleton key={i} className="h-5" style={{ width: `${w}%` }} />
          ))}
        </div>
      </div>
      <div className="flex-1 space-y-4 p-12">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-4 w-full max-w-xl" />
        <Skeleton className="h-4 w-full max-w-lg" />
      </div>
    </div>
  );
}
