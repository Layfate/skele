"use client";

import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { CheckCircle2, Download, ExternalLink, FolderOpen, Loader2, RefreshCw, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { takeSnapshot } from "@/data/snapshots";
import { openDataFolder, openExternal, type DesktopInfo } from "@/lib/desktop";
import { errorMessage } from "@/lib/errors";
import { useWorkspaceCtx } from "@/features/shell/workspace-context";
import { SettingsCard } from "@/features/settings/components/settings-page";
import { useDesktopInfo, useSetUpdateSettings, useUpdateCheck, useUpdateSettings } from "./hooks";
import { installUpdate, restartApp, updateErrorMessage, type Progress } from "./updates";

const OS_NAMES: Record<string, string> = { windows: "Windows", macos: "macOS", linux: "Linux" };

export function DesktopSection() {
  const info = useDesktopInfo();
  if (!info.data) return null;
  return (
    <>
      <AboutCard info={info.data} />
      <UpdatesCard info={info.data} />
    </>
  );
}

function AboutCard({ info }: { info: DesktopInfo }) {
  return (
    <SettingsCard title="About this app">
      <dl className="grid grid-cols-[8rem_1fr] gap-y-2 text-sm">
        <dt className="text-muted-foreground">Version</dt>
        <dd className="flex items-center gap-2">
          Skele {info.version}
          {info.portable && <Badge variant="secondary">Portable</Badge>}
        </dd>
        <dt className="text-muted-foreground">System</dt>
        <dd>
          {OS_NAMES[info.os] ?? info.os} · {info.arch}
        </dd>
        <dt className="text-muted-foreground">Data folder</dt>
        <dd className="min-w-0">
          <code className="block truncate rounded bg-muted px-1.5 py-0.5 text-xs" title={info.dataDir}>
            {info.dataDir}
          </code>
          <p className="mt-1.5 text-xs text-muted-foreground">
            {info.portable
              ? "This portable copy keeps everything in the SkeleData folder next to the app. Move both together."
              : "Workspaces are SQLite files here, with attachments as plain files. Installing a new version never touches this folder."}
          </p>
        </dd>
      </dl>
      <Button variant="outline" size="sm" className="mt-4" onClick={() => openDataFolder().catch((e) => toast.error(errorMessage(e)))}>
        <FolderOpen /> Open data folder
      </Button>
    </SettingsCard>
  );
}

function UpdatesCard({ info }: { info: DesktopInfo }) {
  const settings = useUpdateSettings();
  const setSettings = useSetUpdateSettings();
  const check = useUpdateCheck();
  const { store } = useWorkspaceCtx();
  const [progress, setProgress] = useState<Progress | null>(null);
  const [installError, setInstallError] = useState<string | null>(null);
  const [installed, setInstalled] = useState(false);

  const update = check.data ?? null;
  const releases = info.releasesUrl;
  const canInstall = info.updateMode === "app";

  if (info.updateMode === "unconfigured") {
    return (
      <SettingsCard title="Updates" description="This copy of Skele was built without an update source, so it can't check for new versions.">
        <p className="text-sm text-muted-foreground">Official releases are published on GitHub. Download a new version there when you want to update.</p>
      </SettingsCard>
    );
  }

  const install = async () => {
    if (!update) return;
    setInstallError(null);
    setProgress({ downloaded: 0, total: null });
    try {
      // Updates never touch workspace data, but a recovery point costs little and makes
      // rolling back possible if a new version misbehaves.
      await takeSnapshot(store, `before update to ${update.version}`).catch(() => {});
      await installUpdate(update, setProgress);
      setInstalled(true);
    } catch (e) {
      setInstallError(updateErrorMessage(e));
    } finally {
      setProgress(null);
    }
  };

  const lastChecked = settings.data?.lastCheckedAt;
  const description =
    info.updateMode === "portable"
      ? "Portable copies don't update themselves. When a new version is out, download the new portable zip and replace the app files; keep the SkeleData folder."
      : info.updateMode === "package"
        ? "This copy was installed from a .deb, .rpm or archive. Install the new package to update; your data stays where it is."
        : "Updates are downloaded from GitHub Releases and checked against Skele's signing key before they're installed. Nothing is installed without asking.";

  return (
    <SettingsCard title="Updates" description={description}>
      <div className="flex items-center justify-between gap-4">
        <Label htmlFor="auto-update" className="flex flex-col items-start gap-0.5">
          <span>Check for updates automatically</span>
          <span className="text-xs font-normal text-muted-foreground">Once a day, in the background. Turn off to never contact GitHub on your own.</span>
        </Label>
        <Switch
          id="auto-update"
          checked={settings.data?.autoCheck ?? true}
          disabled={!settings.data}
          onCheckedChange={(autoCheck) => setSettings.mutate({ autoCheck })}
        />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button variant="outline" size="sm" onClick={() => check.refetch()} disabled={check.isFetching || !!progress}>
          {check.isFetching ? <Loader2 className="animate-spin" /> : <RefreshCw />} Check now
        </Button>
        <span className="text-xs text-muted-foreground">
          {check.isFetching
            ? "Checking…"
            : lastChecked
              ? `Last checked ${formatDistanceToNow(new Date(lastChecked), { addSuffix: true })}`
              : "Not checked yet"}
        </span>
      </div>

      {check.isError && (
        <p className="mt-3 text-sm text-destructive" role="alert">
          {updateErrorMessage(check.error)} Skele keeps working normally.
        </p>
      )}

      {check.isSuccess && !update && (
        <p className="mt-3 flex items-center gap-1.5 text-sm text-muted-foreground">
          <CheckCircle2 className="size-4 text-emerald-600" /> You have the latest version ({info.version}).
        </p>
      )}

      {update && (
        <div className="mt-4 rounded-lg border bg-muted/30 p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="font-medium">Skele {update.version} is available</p>
            <p className="text-xs text-muted-foreground">
              You have {update.currentVersion}
              {update.date ? ` · released ${formatDistanceToNow(new Date(update.date), { addSuffix: true })}` : ""}
            </p>
          </div>
          {update.notes && (
            <div className="mt-3 max-h-56 overflow-y-auto rounded-md border bg-background p-3 text-sm whitespace-pre-wrap scrollbar-thin">{update.notes}</div>
          )}

          {progress && (
            <div className="mt-3" aria-live="polite">
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full bg-primary transition-[width]"
                  style={{ width: progress.total ? `${Math.min(100, (progress.downloaded / progress.total) * 100)}%` : "30%" }}
                />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Downloading{progress.total ? ` ${Math.round((progress.downloaded / progress.total) * 100)}%` : "…"}
              </p>
            </div>
          )}

          {installError && (
            <p className="mt-3 text-sm text-destructive" role="alert">
              {installError} Your current version is unchanged.
            </p>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            {installed ? (
              <Button size="sm" onClick={() => restartApp().catch((e) => toast.error(errorMessage(e)))}>
                <RotateCcw /> Restart to finish
              </Button>
            ) : canInstall ? (
              <Button size="sm" onClick={install} disabled={!!progress}>
                {progress ? <Loader2 className="animate-spin" /> : <Download />} {installError ? "Try again" : "Download and install"}
              </Button>
            ) : null}
            {releases && (
              <Button size="sm" variant="outline" onClick={() => openExternal(releases)}>
                <ExternalLink /> {canInstall ? "Release page" : "Download from GitHub"}
              </Button>
            )}
            {!installed && !progress && settings.data?.skippedVersion !== update.version && (
              <Button size="sm" variant="ghost" onClick={() => setSettings.mutate({ skippedVersion: update.version })}>
                Skip this version
              </Button>
            )}
          </div>
        </div>
      )}
    </SettingsCard>
  );
}
