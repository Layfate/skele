"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

// UI-only state. Server data lives in TanStack Query — never mirror it here.
type UIState = {
  sidebarCollapsed: boolean;
  sidebarWidth: number;
  mobileSidebarOpen: boolean;
  /** Expanded page-tree nodes, keyed by page id. */
  expanded: Record<string, boolean>;
  commandOpen: boolean;
  spotifyPanelOpen: boolean;
  toggleSidebar: () => void;
  setSidebarCollapsed: (v: boolean) => void;
  setSidebarWidth: (w: number) => void;
  setMobileSidebarOpen: (v: boolean) => void;
  setExpanded: (id: string, open: boolean) => void;
  setCommandOpen: (v: boolean) => void;
  setSpotifyPanelOpen: (v: boolean) => void;
};

export const SIDEBAR_MIN = 220;
export const SIDEBAR_MAX = 420;

export const useUI = create<UIState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      sidebarWidth: 260,
      mobileSidebarOpen: false,
      expanded: {},
      commandOpen: false,
      spotifyPanelOpen: false,
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
      setSidebarWidth: (w) => set({ sidebarWidth: Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(w))) }),
      setMobileSidebarOpen: (mobileSidebarOpen) => set({ mobileSidebarOpen }),
      setExpanded: (id, open) =>
        set((s) => {
          const expanded = { ...s.expanded };
          if (open) expanded[id] = true;
          else delete expanded[id];
          return { expanded };
        }),
      setCommandOpen: (commandOpen) => set({ commandOpen }),
      setSpotifyPanelOpen: (spotifyPanelOpen) => set({ spotifyPanelOpen }),
    }),
    {
      name: "skele-ui",
      partialize: (s) => ({ sidebarCollapsed: s.sidebarCollapsed, sidebarWidth: s.sidebarWidth, expanded: s.expanded }),
    },
  ),
);
