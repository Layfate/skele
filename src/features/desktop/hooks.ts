"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { desktopInfo, isDesktop } from "@/lib/desktop";
import { checkForUpdate, getUpdateSettings, setUpdateSettings, type UpdateSettings } from "./updates";

export const desktopKeys = {
  info: ["desktop", "info"] as const,
  updateSettings: ["desktop", "update-settings"] as const,
  update: ["desktop", "update"] as const,
};

export function useDesktopInfo() {
  return useQuery({ queryKey: desktopKeys.info, queryFn: desktopInfo, staleTime: Infinity, enabled: isDesktop() });
}

export function useUpdateSettings() {
  return useQuery({ queryKey: desktopKeys.updateSettings, queryFn: getUpdateSettings, enabled: isDesktop() });
}

export function useSetUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<UpdateSettings>) => setUpdateSettings(patch),
    onSuccess: (next) => qc.setQueryData(desktopKeys.updateSettings, next),
  });
}

/** The last update check (shared by the startup check and Settings). Only runs when asked. */
export function useUpdateCheck() {
  return useQuery({ queryKey: desktopKeys.update, queryFn: checkForUpdate, enabled: false, retry: false, staleTime: Infinity, gcTime: Infinity });
}
