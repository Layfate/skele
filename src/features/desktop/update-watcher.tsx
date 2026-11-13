"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { toast } from "sonner";
import { desktopInfo, isDesktop } from "@/lib/desktop";
import { routes } from "@/lib/routes";
import { desktopKeys } from "./hooks";
import { checkForUpdate, getUpdateSettings } from "./updates";

const FIRST_CHECK_DELAY = 20_000;
const RECHECK_EVERY = 6 * 60 * 60_000;
const MIN_GAP = 20 * 60 * 60_000;

/**
 * Background update check for the desktop app: shortly after start, then every few hours, at
 * most once a day, and only if automatic checks are on (Settings → Desktop app). Failures,
 * such as being offline, are silent.
 */
export function UpdateWatcher() {
  const qc = useQueryClient();
  const router = useRouter();

  useEffect(() => {
    if (!isDesktop()) return;
    let cancelled = false;
    const run = async () => {
      try {
        const [info, settings] = await Promise.all([desktopInfo(), getUpdateSettings()]);
        if (cancelled || !info || info.updateMode === "unconfigured" || !settings.autoCheck) return;
        if (settings.lastCheckedAt && Date.now() - Date.parse(settings.lastCheckedAt) < MIN_GAP) return;
        const update = await qc.fetchQuery({ queryKey: desktopKeys.update, queryFn: checkForUpdate, staleTime: 0 });
        qc.invalidateQueries({ queryKey: desktopKeys.updateSettings });
        if (cancelled || !update || update.version === settings.skippedVersion) return;
        toast.info(`Skele ${update.version} is available`, {
          description: info.updateMode === "app" ? "Review the changes and install it from Settings." : "Download it from the releases page.",
          duration: 20_000,
          action: { label: "View", onClick: () => router.push(routes.settings("desktop")) },
        });
      } catch (e) {
        console.info("[skele] update check skipped:", e);
      }
    };
    const first = setTimeout(run, FIRST_CHECK_DELAY);
    const timer = setInterval(run, RECHECK_EVERY);
    return () => {
      cancelled = true;
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [qc, router]);

  return null;
}
