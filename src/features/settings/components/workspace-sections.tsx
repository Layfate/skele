"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Download, FileText, History, Loader2, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { EmojiPicker } from "@/components/emoji-picker";
import { IconTile } from "@/components/common";
import { COLOR_NAMES, COLORS } from "@/lib/colors";
import { cn } from "@/lib/utils";
import { dateStamp, downloadBlob, safeFilename } from "@/lib/download";
import { errorMessage } from "@/lib/errors";
import { pickFile } from "@/features/editor/extensions/skele-storage";
import { formatBytes } from "@/features/editor/extensions/skele-storage";
import { useWorkspaceCtx } from "@/features/shell/workspace-context";
import { useDeleteFile, useFiles } from "@/features/files/hooks";
import { useDeleteWorkspace, useImportWorkspace, useUpdateWorkspace, useWorkspaces } from "@/features/workspaces/hooks";
import { exportWorkspaceArchive, restoreIntoWorkspace } from "@/data/backup";
import { exportMarkdownArchive } from "@/features/import-export/markdown-export";
import { importMarkdownFolder, pickMarkdownFolder } from "@/features/import-export/markdown-import";
import { listSnapshots, restoreSnapshot, takeSnapshot } from "@/data/snapshots";
import { getFile } from "@/data/repo/files";
import { usePreferences, useUpdatePreferences } from "../hooks";
import { SettingsCard } from "./settings-page";

export function WorkspaceSection() {
  const { workspace, workspaceId } = useWorkspaceCtx();
  const router = useRouter();
  const update = useUpdateWorkspace(workspaceId);
  const del = useDeleteWorkspace();
  const workspaces = useWorkspaces();
  const prefs = usePreferences();
  const updatePrefs = useUpdatePreferences();
  const [name, setName] = useState(workspace.name);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [confirmName, setConfirmName] = useState("");

  return (
    <>
      <SettingsCard title="Workspace">
        <div className="flex items-end gap-3">
          <Popover open={emojiOpen} onOpenChange={setEmojiOpen}>
            <PopoverTrigger asChild>
              <button type="button" aria-label="Workspace icon" className="rounded-lg p-1 hover:bg-accent">
                <IconTile icon={workspace.icon} name={workspace.name} color={workspace.color} className="size-11 text-xl" />
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <EmojiPicker
                onSelect={(icon) => (update.mutate({ icon }), setEmojiOpen(false))}
                onRemove={workspace.icon ? () => (update.mutate({ icon: null }), setEmojiOpen(false)) : undefined}
              />
            </PopoverContent>
          </Popover>
          <form
            className="flex flex-1 items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim()) update.mutate({ name: name.trim() }, { onSuccess: () => toast.success("Workspace renamed") });
            }}
          >
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="ws-name">Name</Label>
              <Input id="ws-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
            </div>
            <Button type="submit" disabled={!name.trim() || name.trim() === workspace.name}>
              Save
            </Button>
          </form>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {COLOR_NAMES.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={COLORS[c].label}
              aria-pressed={workspace.color === c}
              onClick={() => update.mutate({ color: c })}
              className={cn("size-6 rounded-full ring-offset-2 ring-offset-card", workspace.color === c && "ring-2 ring-foreground/60")}
              style={{ background: COLORS[c].hex }}
            />
          ))}
        </div>
      </SettingsCard>

      <SettingsCard title="Your name" description="Optional. Used for the greeting on Home and as the author of comments. Stays on this device.">
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            updatePrefs.mutate({ displayName: (displayName ?? "").trim().slice(0, 80) }, { onSuccess: () => toast.success("Saved") });
          }}
        >
          <Input
            aria-label="Your name"
            placeholder="e.g. Alex"
            value={displayName ?? prefs.data?.displayName ?? ""}
            maxLength={80}
            onChange={(e) => setDisplayName(e.target.value)}
          />
          <Button type="submit" disabled={displayName === null}>
            Save
          </Button>
        </form>
      </SettingsCard>

      <SettingsCard title="Delete workspace" description="Permanently deletes every page, database, project, task and attachment in this workspace from this device." danger>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="destructive">Delete workspace</Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete {workspace.name}?</AlertDialogTitle>
              <AlertDialogDescription>
                This can&apos;t be undone. Export a backup first if you might need it. Type the workspace name to confirm.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <Input value={confirmName} onChange={(e) => setConfirmName(e.target.value)} placeholder={workspace.name} aria-label="Workspace name" />
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                disabled={confirmName !== workspace.name}
                onClick={() =>
                  del.mutate(workspaceId, {
                    onSuccess: () => router.replace((workspaces.data?.length ?? 0) > 1 ? "/" : "/welcome"),
                  })
                }
              >
                Delete forever
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </SettingsCard>
    </>
  );
}

export function BackupSection() {
  const { workspace, store, workspaceId } = useWorkspaceCtx();
  const qc = useQueryClient();
  const importWs = useImportWorkspace();
  const router = useRouter();
  const snapshots = useQuery({ queryKey: ["snapshots", workspaceId], queryFn: () => listSnapshots(workspaceId) });

  const exportArchive = useMutation({
    mutationFn: async () => {
      const blob = await exportWorkspaceArchive(store, workspace);
      await downloadBlob(blob, `${safeFilename(workspace.name)} ${dateStamp()}.skele`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const exportMarkdown = useMutation({
    mutationFn: async () => {
      const { blob, lossyPages } = await exportMarkdownArchive(store, workspace.name);
      await downloadBlob(blob, `${safeFilename(workspace.name)} ${dateStamp()} (Markdown).zip`);
      return lossyPages;
    },
    onSuccess: (lossy) => {
      if (lossy.length) toast.info(`${lossy.length} page(s) use formatting Markdown can't show — see README.md in the zip.`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const importMarkdown = useMutation({
    mutationFn: async () => {
      const files = await pickMarkdownFolder();
      if (!files?.length) return null;
      return importMarkdownFolder(files, { workspaceId, parentTitle: `Imported notes ${dateStamp()}` });
    },
    onSuccess: (result) => {
      if (!result) return;
      qc.invalidateQueries();
      toast.success(`Imported ${result.pages} pages and ${result.files} attachments`);
      if (result.skipped.length) toast.warning(`Skipped ${result.skipped.length}: ${result.skipped.slice(0, 3).join("; ")}`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const restore = useMutation({
    mutationFn: async (file: File) => {
      await takeSnapshot(store, "before restore");
      return restoreIntoWorkspace(store, new Uint8Array(await file.arrayBuffer()));
    },
    onSuccess: ({ counts, problems }) => {
      qc.invalidateQueries();
      toast.success(`Restored ${counts.pages} pages and ${counts.tasks} tasks`);
      if (problems.length) toast.warning(`${problems.length} attachment(s) were skipped: ${problems.slice(0, 2).join("; ")}`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const snapshotNow = useMutation({
    mutationFn: () => takeSnapshot(store, "manual"),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["snapshots", workspaceId] });
      toast.success("Recovery point created");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const rollback = useMutation({
    mutationFn: (id: string) => restoreSnapshot(store, id),
    onSuccess: () => {
      qc.invalidateQueries();
      toast.success("Workspace rolled back");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <>
      <SettingsCard
        title="Back up this workspace"
        description="Download everything — pages, databases, projects, tasks and attachments — as one .skele file. Keep it anywhere."
      >
        <Button onClick={() => exportArchive.mutate()} disabled={exportArchive.isPending}>
          {exportArchive.isPending ? <Loader2 className="animate-spin" /> : <Download />} Export backup
        </Button>
      </SettingsCard>

      <SettingsCard title="Import" description="Open a .skele backup (or a .skele.json export from an older Skele) as a new workspace. Nothing existing is changed.">
        <Button
          variant="outline"
          disabled={importWs.isPending}
          onClick={async () => {
            const file = await pickFile(".skele,.json,application/zip,application/json");
            if (file) importWs.mutate(file, { onSuccess: () => router.push("/") });
          }}
        >
          {importWs.isPending ? <Loader2 className="animate-spin" /> : <Upload />} Import as new workspace
        </Button>
      </SettingsCard>

      <SettingsCard
        title="Markdown"
        description="Export notes as a folder of Markdown files (opens in Obsidian or any editor), or add a folder of .md files to this workspace. Use a .skele backup for a complete copy — databases aren't part of the Markdown export."
      >
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => exportMarkdown.mutate()} disabled={exportMarkdown.isPending}>
            {exportMarkdown.isPending ? <Loader2 className="animate-spin" /> : <FileText />} Export as Markdown
          </Button>
          <Button variant="outline" onClick={() => importMarkdown.mutate()} disabled={importMarkdown.isPending}>
            {importMarkdown.isPending ? <Loader2 className="animate-spin" /> : <Upload />} Import Markdown folder
          </Button>
        </div>
      </SettingsCard>

      <SettingsCard title="Restore from backup" description="Replace this workspace's content with a backup. A recovery point of the current state is taken first." danger>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="destructive" disabled={restore.isPending}>
              {restore.isPending && <Loader2 className="animate-spin" />} Restore…
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Replace “{workspace.name}” with a backup?</AlertDialogTitle>
              <AlertDialogDescription>
                Everything in this workspace is replaced by the backup&apos;s content. You can undo this from the recovery points below.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                onClick={async () => {
                  const file = await pickFile(".skele,.json,application/zip,application/json");
                  if (file) restore.mutate(file);
                }}
              >
                Choose backup file
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </SettingsCard>

      <SettingsCard
        title="Recovery points"
        description="Skele keeps automatic snapshots of this workspace while you work (attachments are kept in place). Roll back if something goes wrong."
      >
        {!snapshots.data ? (
          <Skeleton className="h-20" />
        ) : snapshots.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">No recovery points yet — the first one is taken a few minutes after you start editing.</p>
        ) : (
          <ul className="divide-y">
            {snapshots.data.map((snap) => (
              <li key={snap.id} className="flex items-center gap-3 py-2 text-sm">
                <History className="size-4 text-muted-foreground" />
                <span className="flex-1">
                  {formatDistanceToNow(new Date(snap.createdAt), { addSuffix: true })}
                  <span className="ml-2 text-xs text-muted-foreground">
                    {snap.reason} · {formatBytes(snap.size)}
                  </span>
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={rollback.isPending}
                  onClick={() => confirm("Roll this workspace back to this point? The current state is saved as a recovery point first.") && rollback.mutate(snap.id)}
                >
                  Roll back
                </Button>
              </li>
            ))}
          </ul>
        )}
        <Button variant="outline" size="sm" className="mt-3" onClick={() => snapshotNow.mutate()} disabled={snapshotNow.isPending}>
          Create recovery point now
        </Button>
      </SettingsCard>
    </>
  );
}

export function StorageSection() {
  const { workspaceId, store } = useWorkspaceCtx();
  const files = useFiles(workspaceId);
  const del = useDeleteFile(workspaceId);
  if (!files.data) return <Skeleton className="h-48" />;
  const { used, maxUpload, count } = files.data.usage;
  const open = async (id: string) => {
    const f = await getFile(store, id);
    const url = URL.createObjectURL(f.blob);
    window.open(url, "_blank", "noopener");
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };
  return (
    <>
      <SettingsCard title="Usage" description={`Attachments are stored on this device. Files can be up to ${formatBytes(maxUpload)} each.`}>
        <p className="text-sm">
          {formatBytes(used)} in {count} {count === 1 ? "file" : "files"}
        </p>
      </SettingsCard>
      <SettingsCard title="Files">
        {files.data.files.length === 0 ? (
          <p className="text-sm text-muted-foreground">No attachments yet. Drop an image or file into any page.</p>
        ) : (
          <ul className="divide-y">
            {files.data.files.map((f) => (
              <li key={f.id} className="flex items-center gap-3 py-2">
                <FileText className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <button type="button" onClick={() => open(f.id)} className="block max-w-full truncate text-left text-sm hover:underline">
                    {f.name}
                  </button>
                  <p className="truncate text-xs text-muted-foreground">
                    {formatBytes(f.size)} · {formatDistanceToNow(new Date(f.createdAt), { addSuffix: true })}
                    {f.page && ` · ${f.page.title || "Untitled"}`}
                  </p>
                </div>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Delete ${f.name}`}
                  onClick={() => confirm(`Delete ${f.name}? Pages that use it will show a missing file.`) && del.mutate(f.id)}
                >
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </SettingsCard>
    </>
  );
}

export function PrivacySection() {
  return (
    <>
      <SettingsCard title="Your data stays on this device">
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
          <li>Skele has no accounts and no Skele server. Workspaces are stored in this browser&apos;s (or the desktop app&apos;s) local database.</li>
          <li>Skele makes no network requests for your notes, tasks or files on its own, and has no telemetry.</li>
          <li>
            The only internet features are optional: integrations (like Spotify), which connect only after you turn them on; AI chat, which
            sends your messages and any pages you attach to Anthropic or OpenAI only when you send a message; and the desktop app&apos;s update
            check against GitHub Releases, which you can turn off in “Desktop app”.
          </li>
          <li>Clearing this browser&apos;s site data deletes your workspaces — export backups regularly from “Data &amp; backup”.</li>
        </ul>
      </SettingsCard>
    </>
  );
}
