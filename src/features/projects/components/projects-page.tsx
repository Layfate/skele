"use client";

import { routes } from "@/lib/routes";
import { format, parseISO } from "date-fns";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Archive, FolderKanban, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, IconTile } from "@/components/common";
import { cn } from "@/lib/utils";
import { Topbar } from "@/features/shell/topbar";
import { useWorkspaceCtx } from "@/features/shell/workspace-context";
import { useProjects, type ProjectItem } from "../hooks";
import { PROJECT_STATUS_LABEL, progress, type ProjectStatus } from "../schemas";
import { NewProjectDialog } from "./project-dialog";
import { ProgressBar } from "./task-fields";

export function ProjectsPage() {
  const { workspaceId, canEdit } = useWorkspaceCtx();
  const params = useSearchParams();
  const router = useRouter();
  const [showArchived, setShowArchived] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const projects = useProjects(workspaceId, showArchived);
  // `?new=1` (from the command palette / dashboard) opens the dialog directly.
  const newOpen = dialogOpen || (params.get("new") === "1" && canEdit);
  const setNewOpen = (open: boolean) => {
    setDialogOpen(open);
    if (!open && params.get("new")) router.replace(routes.projects);
  };

  const list = projects.data ?? [];

  return (
    <>
      <Topbar
        crumbs={[{ label: "Projects" }]}
        actions={
          <>
            <Button variant="ghost" size="sm" className={cn("text-muted-foreground", showArchived && "text-foreground")} onClick={() => setShowArchived(!showArchived)}>
              <Archive /> {showArchived ? "Hide archived" : "Show archived"}
            </Button>
            {canEdit && (
              <Button size="sm" onClick={() => setNewOpen(true)}>
                <Plus /> New project
              </Button>
            )}
          </>
        }
      />
      <div className="flex-1 overflow-y-auto px-[clamp(1.25rem,5vw,4rem)] pt-8 pb-16 scrollbar-thin">
        <div className="mx-auto max-w-5xl">
          <h1 className="mb-6 text-3xl font-bold tracking-tight">Projects</h1>
          {projects.isPending ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-36 rounded-xl" />
              ))}
            </div>
          ) : list.length === 0 ? (
            <EmptyState
              icon={FolderKanban}
              title="No projects yet"
              description="Create a project to plan work, assign tasks and track progress."
              action={canEdit && <Button onClick={() => setNewOpen(true)}>Create your first project</Button>}
            />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {list.map((p) => (
                <ProjectCard key={p.id} project={p} />
              ))}
            </div>
          )}
        </div>
      </div>
      <NewProjectDialog open={newOpen} onOpenChange={setNewOpen} />
    </>
  );
}

export function ProjectStatusBadge({ status }: { status: ProjectStatus }) {
  const tone: Record<ProjectStatus, string> = {
    PLANNED: "bg-muted text-muted-foreground",
    ACTIVE: "bg-brand-soft text-brand",
    ON_HOLD: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
    COMPLETED: "bg-green-500/15 text-green-700 dark:text-green-400",
    CANCELLED: "bg-muted text-muted-foreground line-through",
  };
  return <span className={cn("inline-flex h-5 items-center rounded-full px-2 text-[11.5px] font-medium", tone[status])}>{PROJECT_STATUS_LABEL[status]}</span>;
}

function ProjectCard({ project }: { project: ProjectItem }) {
  const pct = progress(project.counts);
  return (
    <Link
      href={routes.project(project.id)}
      className={cn(
        "flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-shadow hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        project.archivedAt && "opacity-60",
      )}
    >
      <div className="flex items-start gap-3">
        <IconTile icon={project.icon} name={project.name} color={project.color} className="size-9 text-lg" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{project.name}</p>
          <p className="line-clamp-2 text-sm text-muted-foreground">{project.description || "No description"}</p>
        </div>
      </div>
      <ProgressBar value={pct} />
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <ProjectStatusBadge status={project.status} />
        <span>
          {project.counts.completed}/{project.counts.total - project.counts.cancelled} tasks
        </span>
        {project.targetDate && <span className="ml-auto">Due {format(parseISO(project.targetDate), "MMM d")}</span>}
      </div>
    </Link>
  );
}
