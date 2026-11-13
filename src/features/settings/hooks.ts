"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTheme } from "next-themes";
import { useEffect } from "react";
import { toast } from "sonner";
import { errorMessage } from "@/lib/errors";
import { getPreferences, updatePreferences, type Preferences } from "@/data/registry";
import { getQuickNote, setQuickNote } from "@/data/workspaces";
import { workspaceStore } from "@/data/registry";

export type { Preferences };
export const preferencesKey = ["preferences"] as const;

export function usePreferences() {
  return useQuery({ queryKey: preferencesKey, queryFn: getPreferences, staleTime: Infinity });
}

export function useUpdatePreferences() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<Preferences>) => updatePreferences(input),
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: preferencesKey });
      const prev = qc.getQueryData<Preferences>(preferencesKey);
      if (prev) qc.setQueryData(preferencesKey, { ...prev, ...input });
      return { prev };
    },
    onError: (error, _input, ctx) => {
      if (ctx?.prev) qc.setQueryData(preferencesKey, ctx.prev);
      toast.error(errorMessage(error));
    },
    onSuccess: (data) => qc.setQueryData(preferencesKey, data),
  });
}

export function useQuickNote(workspaceId: string) {
  return useQuery({ queryKey: ["quick-note", workspaceId], queryFn: () => getQuickNote(workspaceStore(workspaceId)) });
}

export function useSaveQuickNote(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (text: string) => setQuickNote(workspaceStore(workspaceId), text),
    onSuccess: (_d, text) => qc.setQueryData(["quick-note", workspaceId], text),
    onError: (e) => toast.error(errorMessage(e)),
  });
}

/** Keeps theme / accent / font size / density on <html> in sync with the stored preferences. */
export function useAppearanceSync() {
  const { data } = usePreferences();
  const { theme, setTheme } = useTheme();
  useEffect(() => {
    if (!data) return;
    if (data.theme !== theme) setTheme(data.theme);
    const root = document.documentElement;
    root.dataset.accent = data.accent;
    root.dataset.fontSize = data.fontSize;
    root.dataset.density = data.density;
    try {
      localStorage.setItem(
        "skele-appearance",
        JSON.stringify({ accent: data.accent, fontSize: data.fontSize, density: data.density }),
      );
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.theme, data?.accent, data?.fontSize, data?.density]);
}
