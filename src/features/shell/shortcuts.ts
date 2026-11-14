"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { routes } from "@/lib/routes";
import { errorMessage } from "@/lib/errors";
import { useUI } from "@/stores/ui";
import { getCurrentWorkspaceId, workspaceStore } from "@/data/registry";
import { createPage, openDailyNote } from "@/data/repo/pages";
import { usePreferences } from "@/features/settings/hooks";

export type ShortcutAction = { id: string; label: string; default: string };

/** Global shortcuts. Combos use "mod" for Ctrl (Windows/Linux) or ⌘ (macOS). */
export const SHORTCUT_ACTIONS: ShortcutAction[] = [
  { id: "palette", label: "Search & command palette", default: "mod+k" },
  { id: "sidebar", label: "Toggle sidebar", default: "mod+\\" },
  { id: "newPage", label: "New page", default: "mod+alt+n" },
  { id: "newChat", label: "New AI chat", default: "mod+shift+o" },
  { id: "dailyNote", label: "Today's daily note", default: "mod+shift+d" },
  { id: "graph", label: "Graph view", default: "mod+shift+g" },
  { id: "tasks", label: "My tasks", default: "mod+shift+t" },
  { id: "home", label: "Home", default: "mod+shift+h" },
];

const isMac = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/** Normalised combo for a keyboard event, e.g. "mod+shift+k". */
export function comboFromEvent(e: KeyboardEvent): string | null {
  if (["Control", "Meta", "Shift", "Alt"].includes(e.key)) return null;
  const mod = isMac() ? e.metaKey : e.ctrlKey;
  const parts = [];
  if (mod) parts.push("mod");
  if (e.altKey) parts.push("alt");
  if (e.shiftKey) parts.push("shift");
  const key = e.code.startsWith("Key") ? e.code.slice(3).toLowerCase() : e.code.startsWith("Digit") ? e.code.slice(5) : e.key.toLowerCase();
  parts.push(key === "backslash" ? "\\" : key);
  return parts.join("+");
}

export function formatCombo(combo: string): string {
  const mac = isMac();
  return combo
    .split("+")
    .map((p) => (p === "mod" ? (mac ? "⌘" : "Ctrl") : p === "alt" ? (mac ? "⌥" : "Alt") : p === "shift" ? (mac ? "⇧" : "Shift") : p.toUpperCase()))
    .join(mac ? "" : " ");
}

export function resolvedShortcuts(overrides: Record<string, string> = {}) {
  return SHORTCUT_ACTIONS.map((a) => ({ ...a, combo: overrides[a.id] || a.default }));
}

export function useShortcuts() {
  const router = useRouter();
  const qc = useQueryClient();
  const prefs = usePreferences();
  const handlers = useRef<Record<string, () => void>>({});
  // Refreshed after every render so handlers always see the latest router/query client.
  useEffect(() => {
    handlers.current = {
      palette: () => useUI.getState().setCommandOpen(!useUI.getState().commandOpen),
      sidebar: () => useUI.getState().toggleSidebar(),
      graph: () => router.push(routes.graph),
      tasks: () => router.push(routes.tasks),
      home: () => router.push(routes.home),
      newChat: () => router.push(routes.chat()),
      newPage: async () => {
        const id = await getCurrentWorkspaceId();
        if (!id) return;
        const page = await createPage(workspaceStore(id), {});
        qc.invalidateQueries({ queryKey: ["pages", id] });
        router.push(routes.page(page.id));
      },
      dailyNote: async () => {
        const id = await getCurrentWorkspaceId();
        if (!id) return;
        try {
          const page = await openDailyNote(workspaceStore(id));
          qc.invalidateQueries({ queryKey: ["pages", id] });
          router.push(routes.page(page.id));
        } catch (e) {
          toast.error(errorMessage(e));
        }
      },
    };
  });

  const map = resolvedShortcuts(prefs.data?.shortcuts);
  const comboKey = map.map((m) => m.combo).join("|");

  useEffect(() => {
    const bindings = new Map(resolvedShortcuts(prefs.data?.shortcuts).map((s) => [s.combo, s.id]));
    const onKey = (e: KeyboardEvent) => {
      const combo = comboFromEvent(e);
      if (!combo) return;
      const id = bindings.get(combo);
      if (!id) return;
      // Plain-letter shortcuts never fire while typing (all defaults use a modifier).
      e.preventDefault();
      void handlers.current[id]?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comboKey]);
}
