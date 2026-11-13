"use client";

import { routes } from "@/lib/routes";
import { formatDistanceToNow } from "date-fns";
import Link from "next/link";
import { useRef, useState } from "react";
import { CornerLeftUp, FilePlus2, FileText, FolderKanban, MoreHorizontal, Send, Trash2 } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ColorDot } from "@/components/common";
import { usePreferences } from "@/features/settings/hooks";
import { useCreatePage, usePages } from "@/features/pages/hooks";
import { cn } from "@/lib/utils";
import { useWorkspaceCtx } from "@/features/shell/workspace-context";
import {
  useAddComment,
  useCreateTask,
  useDeleteComment,
  useDeleteTask,
  useProjects,
  useTask,
  useUpdateTask,
  type TaskDetail,
} from "../hooks";
import type { UpdateTaskInput } from "../schemas";
import { AssigneePicker, DuePicker, LabelPicker, PriorityPicker, StatusIcon, StatusPicker } from "./task-fields";

export function TaskSheet({
  taskId,
  onClose,
  onOpen,
}: {
  taskId: string | null;
  onClose: () => void;
  onOpen: (id: string) => void;
}) {
  const { workspaceId } = useWorkspaceCtx();
  const task = useTask(workspaceId, taskId);
  return (
    <Sheet open={!!taskId} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="gap-0 overflow-y-auto p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-[600px]">
        <SheetTitle className="sr-only">Task details</SheetTitle>
        <SheetDescription className="sr-only">View and edit the task</SheetDescription>
        {task.error ? (
          <p className="p-10 text-muted-foreground">This task no longer exists.</p>
        ) : task.data && task.data.id === taskId ? (
          <TaskBody key={task.data.id} task={task.data} onClose={onClose} onOpen={onOpen} />
        ) : (
          <div className="space-y-4 p-10">
            <Skeleton className="h-8 w-2/3" />
            <Skeleton className="h-5 w-1/2" />
            <Skeleton className="h-24 w-full" />
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function TaskBody({ task, onClose, onOpen }: { task: TaskDetail; onClose: () => void; onOpen: (id: string) => void }) {
  const { workspaceId } = useWorkspaceCtx();
  const editable = task.canEdit;
  const update = useUpdateTask(workspaceId);
  const del = useDeleteTask(workspaceId);
  const projects = useProjects(workspaceId);
  const pages = usePages(workspaceId);
  const createNote = useCreatePage(workspaceId);
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description);
  const descTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [savedTitle, setSavedTitle] = useState(task.title);
  if (savedTitle !== task.title) {
    setSavedTitle(task.title);
    setTitle(task.title);
  }

  const set = (input: UpdateTaskInput) => update.mutate({ id: task.id, ...input });

  return (
    <div className="px-6 pt-12 pb-10 sm:px-10">
      <div className="absolute top-3 right-12">
        {editable && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Task actions">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => {
                  del.mutate(task.id);
                  onClose();
                }}
              >
                <Trash2 /> Delete task
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {task.parent && (
        <button
          type="button"
          onClick={() => onOpen(task.parent!.id)}
          className="mb-2 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <CornerLeftUp className="size-3" /> {task.parent.title}
        </button>
      )}
      <textarea
        rows={1}
        value={title}
        readOnly={!editable}
        aria-label="Task title"
        maxLength={500}
        onChange={(e) => setTitle(e.target.value.replace(/\n/g, ""))}
        onBlur={() => title.trim() && title.trim() !== task.title && set({ title: title.trim() })}
        onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), (e.target as HTMLTextAreaElement).blur())}
        className="field-sizing-content w-full resize-none bg-transparent text-2xl font-bold tracking-tight outline-none"
      />

      <dl className="mt-4 grid grid-cols-[110px_minmax(0,1fr)] items-center gap-x-2 gap-y-1 text-sm">
        <dt className="text-muted-foreground">Status</dt>
        <dd>
          <StatusPicker value={task.status} disabled={!editable} showLabel onChange={(status) => set({ status })} />
        </dd>
        <dt className="text-muted-foreground">Priority</dt>
        <dd>
          <PriorityPicker value={task.priority} disabled={!editable} showLabel onChange={(priority) => set({ priority })} />
        </dd>
        <dt className="text-muted-foreground">Assignee</dt>
        <dd>
          <AssigneePicker workspaceId={workspaceId} value={task.assignee} disabled={!editable} showLabel onChange={(assignee) => set({ assignee })} />
        </dd>
        <dt className="text-muted-foreground">Due</dt>
        <dd>
          <DuePicker value={task.dueDate} disabled={!editable} showLabel onChange={(dueDate) => set({ dueDate })} />
        </dd>
        <dt className="text-muted-foreground">Labels</dt>
        <dd>
          <LabelPicker workspaceId={workspaceId} value={task.labels} disabled={!editable} onChange={(labelIds) => set({ labelIds })} />
        </dd>
        <dt className="text-muted-foreground">Project</dt>
        <dd className="min-w-0">
          {editable && !task.parentId ? (
            <select
              aria-label="Project"
              value={task.projectId ?? ""}
              onChange={(e) => set({ projectId: e.target.value || null })}
              className="h-7 max-w-full rounded-md bg-transparent px-1 text-sm hover:bg-accent"
            >
              <option value="">No project</option>
              {projects.data?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          ) : task.project ? (
            <Link href={routes.project(task.project.id)} className="inline-flex items-center gap-1.5 px-1.5 hover:underline">
              {task.project.icon ?? <ColorDot color={task.project.color} />} {task.project.name}
            </Link>
          ) : (
            <span className="px-1.5 text-muted-foreground">No project</span>
          )}
        </dd>
        <dt className="text-muted-foreground">Note</dt>
        <dd className="flex min-w-0 items-center gap-1">
          {editable ? (
            <select
              aria-label="Linked note"
              value={task.page?.id ?? ""}
              onChange={(e) => set({ pageId: e.target.value || null })}
              className="h-7 max-w-full min-w-0 rounded-md bg-transparent px-1 text-sm hover:bg-accent"
            >
              <option value="">No note</option>
              {pages.data?.pages
                .filter((p) => p.kind === "DOCUMENT" && !p.isTemplate)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.icon ? `${p.icon} ` : ""}
                    {p.title || "Untitled"}
                  </option>
                ))}
            </select>
          ) : (
            !task.page && <span className="px-1.5 text-muted-foreground">No note</span>
          )}
          {task.page ? (
            <Button variant="ghost" size="sm" asChild>
              <Link href={routes.page(task.page.id)}>
                <FileText /> Open
              </Link>
            </Button>
          ) : (
            editable && (
              <Button
                variant="ghost"
                size="sm"
                disabled={createNote.isPending}
                onClick={() =>
                  createNote.mutate(
                    { title: task.title, navigate: false },
                    { onSuccess: (page) => set({ pageId: page.id }) },
                  )
                }
              >
                <FilePlus2 /> New note
              </Button>
            )
          )}
        </dd>
      </dl>

      <div className="mt-6">
        <h3 className="mb-1.5 text-xs font-medium text-muted-foreground">Description</h3>
        <textarea
          value={description}
          readOnly={!editable}
          placeholder={editable ? "Add a description…" : "No description"}
          maxLength={20_000}
          onChange={(e) => {
            setDescription(e.target.value);
            if (descTimer.current) clearTimeout(descTimer.current);
            const v = e.target.value;
            descTimer.current = setTimeout(() => set({ description: v }), 600);
          }}
          className="field-sizing-content min-h-20 w-full resize-none rounded-md border border-transparent bg-transparent p-2 text-sm outline-none hover:border-border focus:border-border focus:ring-2 focus:ring-ring"
        />
      </div>

      {!task.parentId && <Subtasks task={task} onOpen={onOpen} editable={editable} />}
      <Comments task={task} editable={editable} />
    </div>
  );
}

function Subtasks({ task, onOpen, editable }: { task: TaskDetail; onOpen: (id: string) => void; editable: boolean }) {
  const { workspaceId } = useWorkspaceCtx();
  const create = useCreateTask(workspaceId);
  const update = useUpdateTask(workspaceId);
  const [title, setTitle] = useState("");
  const done = task.subtasks.filter((s) => s.status === "COMPLETED").length;
  return (
    <div className="mt-6">
      <h3 className="mb-1.5 flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <FolderKanban className="size-3.5" /> Subtasks
        {task.subtasks.length > 0 && (
          <span>
            {done}/{task.subtasks.length}
          </span>
        )}
      </h3>
      <ul className="space-y-px">
        {task.subtasks.map((s) => (
          <li key={s.id} className="flex items-center gap-1 rounded-md px-1 hover:bg-accent/50">
            <button
              type="button"
              disabled={!editable}
              aria-label={s.status === "COMPLETED" ? "Mark not done" : "Mark done"}
              onClick={() => update.mutate({ id: s.id, status: s.status === "COMPLETED" ? "NOT_STARTED" : "COMPLETED" })}
              className="flex size-7 items-center justify-center"
            >
              <StatusIcon status={s.status} />
            </button>
            <button
              type="button"
              onClick={() => onOpen(s.id)}
              className={cn("flex-1 truncate py-1.5 text-left text-sm", s.status === "COMPLETED" && "text-muted-foreground line-through")}
            >
              {s.title}
            </button>
          </li>
        ))}
      </ul>
      {editable && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!title.trim()) return;
            create.mutate({ title: title.trim(), parentId: task.id });
            setTitle("");
          }}
        >
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="+ Add subtask"
            aria-label="New subtask"
            className="h-8 w-full rounded-md bg-transparent px-2 text-sm outline-none placeholder:text-muted-foreground hover:bg-accent/40 focus:bg-accent/40"
          />
        </form>
      )}
    </div>
  );
}

function Comments({ task, editable }: { task: TaskDetail; editable: boolean }) {
  const { workspaceId, canPurge } = useWorkspaceCtx();
  const prefs = usePreferences();
  const add = useAddComment(workspaceId, task.id, prefs.data?.displayName.trim() || "Me");
  const remove = useDeleteComment(workspaceId, task.id);
  const [body, setBody] = useState("");
  return (
    <div className="mt-8 border-t pt-5">
      <h3 className="mb-3 text-xs font-medium text-muted-foreground">Comments</h3>
      <ul className="space-y-4">
        {task.comments.map((c) => (
          <li key={c.id} className="group flex gap-2.5">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-soft text-xs font-semibold text-brand">
              {(c.author?.name ?? "?").charAt(0).toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm">
                <span className="font-medium">{c.author?.name ?? "Former member"}</span>{" "}
                <span className="text-xs text-muted-foreground">{formatDistanceToNow(new Date(c.createdAt), { addSuffix: true })}</span>
              </p>
              <p className="mt-0.5 text-sm whitespace-pre-wrap">{c.body}</p>
            </div>
            {canPurge && (
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="Delete comment"
                className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                onClick={() => remove.mutate(c.id)}
              >
                <Trash2 />
              </Button>
            )}
          </li>
        ))}
      </ul>
      {editable && (
        <form
          className="mt-4 flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!body.trim()) return;
            add.mutate(body.trim(), { onSuccess: () => setBody("") });
          }}
        >
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) (e.currentTarget.form as HTMLFormElement).requestSubmit();
            }}
            placeholder="Write a comment…"
            aria-label="Comment"
            maxLength={5000}
            className="field-sizing-content max-h-40 min-h-9 flex-1 resize-none rounded-md border bg-background px-2.5 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
          <Button type="submit" size="icon" aria-label="Send comment" disabled={!body.trim() || add.isPending}>
            <Send />
          </Button>
        </form>
      )}
    </div>
  );
}
