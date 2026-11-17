"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { ArrowRight, Compass, FileDown, FolderOpen, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { IconTile } from "@/components/common";
import { Logo } from "@/components/logo";
import { useIsDesktop } from "@/hooks/use-is-desktop";
import { routes } from "@/lib/routes";
import { errorMessage } from "@/lib/errors";
import { pickFile } from "@/features/editor/extensions/skele-storage";
import { importMarkdownFolder, pickMarkdownFolder } from "@/features/import-export/markdown-import";
import { useCreateWorkspace, useImportWorkspace, useOpenWorkspace, useWorkspaces } from "../hooks";

/** First-run screen. No account, no email — everything is created on this device. */
export function WelcomePage() {
  const router = useRouter();
  const desktop = useIsDesktop();
  const workspaces = useWorkspaces();
  const create = useCreateWorkspace();
  const importWs = useImportWorkspace();
  const open = useOpenWorkspace();
  const [name, setName] = useState("");
  const [importingNotes, setImportingNotes] = useState(false);
  const goHome = () => router.replace(routes.home);
  const existing = workspaces.data ?? [];

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-sidebar">
      <header className="px-6 py-5">
        <Logo />
      </header>
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 pt-[6vh] pb-16">
        <h1 className="text-3xl font-bold tracking-tight">Welcome to Skele</h1>
        <p className="mt-2 max-w-xl text-muted-foreground">
          Notes, tasks, projects and databases in one calm place. No account needed — everything you create stays on this device.
        </p>

        <div className="mt-8 grid gap-3 sm:grid-cols-2">
          <Card icon={<Plus />} title="Create a workspace" description="Start fresh with a short getting-started page.">
            <form
              className="mt-3 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                create.mutate({ name: name.trim() || "My workspace", icon: "🦴" }, { onSuccess: goHome });
              }}
            >
              <Input aria-label="Workspace name" placeholder="My workspace" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
              <Button type="submit" disabled={create.isPending}>
                {create.isPending ? <Loader2 className="animate-spin" /> : <ArrowRight />}
                <span className="sr-only">Create</span>
              </Button>
            </form>
          </Card>

          <Card icon={<Compass />} title="Explore a sample workspace" description="Notes with links, a database, a project with tasks — ready to poke at.">
            <Button variant="outline" className="mt-3" disabled={create.isPending} onClick={() => create.mutate({ name: "Sample", sample: true }, { onSuccess: goHome })}>
              Open the sample
            </Button>
          </Card>

          <Card icon={<FolderOpen />} title="Open a backup" description="A .skele backup or a .skele.json export from an older version of Skele.">
            <Button
              variant="outline"
              className="mt-3"
              disabled={importWs.isPending}
              onClick={async () => {
                const file = await pickFile(".skele,.json,application/zip,application/json");
                if (file) importWs.mutate(file, { onSuccess: goHome });
              }}
            >
              {importWs.isPending && <Loader2 className="animate-spin" />} Choose file…
            </Button>
          </Card>

          <Card icon={<FileDown />} title="Import Markdown notes" description="A folder of .md files — for example an Obsidian vault. Folders become nested pages.">
            <Button
              variant="outline"
              className="mt-3"
              disabled={importingNotes}
              onClick={async () => {
                const files = await pickMarkdownFolder();
                if (!files?.length) return;
                setImportingNotes(true);
                try {
                  const result = await importMarkdownFolder(files, { newWorkspaceName: files[0].webkitRelativePath.split("/")[0] || "Imported notes" });
                  await open.mutateAsync(result.workspaceId);
                  toast.success(`Imported ${result.pages} notes${result.files ? ` and ${result.files} attachments` : ""}`);
                  if (result.skipped.length) toast.warning(`${result.skipped.length} file(s) skipped`);
                  goHome();
                } catch (e) {
                  toast.error(errorMessage(e));
                } finally {
                  setImportingNotes(false);
                }
              }}
            >
              {importingNotes && <Loader2 className="animate-spin" />} Choose folder…
            </Button>
          </Card>
        </div>

        {existing.length > 0 && (
          <section className="mt-10">
            <h2 className="mb-2 text-sm font-medium text-muted-foreground">Workspaces on this device</h2>
            <ul className="divide-y rounded-xl border bg-card">
              {existing.map((w) => (
                <li key={w.id}>
                  <button
                    type="button"
                    onClick={() => open.mutate(w.id, { onSuccess: goHome })}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-accent/50"
                  >
                    <IconTile icon={w.icon} name={w.name} color={w.color} />
                    <span className="flex-1 truncate font-medium">{w.name}</span>
                    <ArrowRight className="size-4 text-muted-foreground" />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <p className="mt-10 text-xs text-muted-foreground">
          Your workspaces live in this {desktop ? "app" : "browser"}&apos;s local
          storage. Export backups from Settings → Data &amp; backup to keep a copy elsewhere.
        </p>
      </main>
    </div>
  );
}

function Card({ icon, title, description, children }: { icon: ReactNode; title: string; description: string; children: ReactNode }) {
  return (
    <section className="flex flex-col rounded-xl border bg-card p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
      <div className="mb-2 flex size-9 items-center justify-center rounded-lg bg-brand-soft text-brand [&_svg]:size-4.5">{icon}</div>
      <h2 className="font-semibold">{title}</h2>
      <p className="mt-1 flex-1 text-sm text-muted-foreground">{description}</p>
      {children}
    </section>
  );
}
