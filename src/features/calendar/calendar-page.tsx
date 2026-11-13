"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { CircleCheck, Circle, FileText, Table2 } from "lucide-react";
import { toast } from "sonner";
import { MonthCalendar } from "@/components/month-calendar";
import { routes } from "@/lib/routes";
import { cn } from "@/lib/utils";
import { errorMessage } from "@/lib/errors";
import { calendarEntries, type CalendarEntry } from "@/data/repo/calendar";
import { updateRecord } from "@/data/repo/databases";
import { createTask, updateTask } from "@/data/repo/projects";
import { Topbar } from "@/features/shell/topbar";
import { useWorkspaceCtx } from "@/features/shell/workspace-context";

const KINDS = [
  { id: "task", label: "Tasks" },
  { id: "record", label: "Database dates" },
  { id: "note", label: "Daily notes" },
] as const;

export function CalendarPage() {
  const { workspaceId, store } = useWorkspaceCtx();
  const router = useRouter();
  const qc = useQueryClient();
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const entries = useQuery({ queryKey: ["calendar", workspaceId], queryFn: () => calendarEntries(store) });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["calendar", workspaceId] });
    qc.invalidateQueries({ queryKey: ["tasks", workspaceId] });
    qc.invalidateQueries({ queryKey: ["database", workspaceId] });
    qc.invalidateQueries({ queryKey: ["dashboard", workspaceId] });
  };

  const move = async (id: string, date: string) => {
    const entry = entries.data?.find((e) => e.id === id);
    if (!entry) return;
    try {
      if (entry.kind === "task") await updateTask(store, id.slice(2), { dueDate: date });
      else if (entry.kind === "record") {
        const db = (await store.t("records").get(entry.recordId!))?.databaseId;
        if (db) await updateRecord(store, db, entry.recordId!, { values: { [entry.propertyId!]: date } });
      } else return toast.info("Daily notes keep their date.");
      refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const open = (e: CalendarEntry) => {
    if (e.kind === "task") router.push(routes.task(e.id.slice(2)));
    else if (e.kind === "record") router.push(routes.record(e.pageId!, e.recordId!));
    else router.push(routes.page(e.pageId!));
  };

  const items = (entries.data ?? []).filter((e) => !hidden.has(e.kind));

  return (
    <>
      <Topbar crumbs={[{ label: "Calendar" }]} />
      <div className="flex-1 overflow-y-auto px-[clamp(1rem,3vw,2.5rem)] pt-6 pb-16 scrollbar-thin">
        <div className="mx-auto max-w-6xl">
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <h1 className="mr-auto text-2xl font-bold tracking-tight">Calendar</h1>
            {KINDS.map((k) => (
              <label key={k.id} className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <input
                  type="checkbox"
                  checked={!hidden.has(k.id)}
                  onChange={() =>
                    setHidden((h) => {
                      const next = new Set(h);
                      if (next.has(k.id)) next.delete(k.id);
                      else next.add(k.id);
                      return next;
                    })
                  }
                  className="accent-[var(--brand)]"
                />
                {k.label}
              </label>
            ))}
          </div>
          <MonthCalendar
            items={items}
            editable
            onMove={move}
            onAdd={async (date) => {
              const title = prompt(`New task due ${date}`)?.trim();
              if (!title) return;
              await createTask(store, { title, dueDate: date });
              refresh();
            }}
            renderItem={(e) => (
              <button
                type="button"
                onClick={() => open(e)}
                title={e.context ? `${e.title} — ${e.context}` : e.title}
                className={cn(
                  "flex w-full items-center gap-1 truncate rounded border bg-card px-1.5 py-0.5 text-left text-xs shadow-sm hover:bg-accent",
                  e.done && "text-muted-foreground line-through",
                  e.kind === "note" && "border-dashed",
                )}
              >
                {e.kind === "task" ? (
                  e.done ? <CircleCheck className="size-3 shrink-0 text-green-600" /> : <Circle className="size-3 shrink-0 text-muted-foreground" />
                ) : e.kind === "record" ? (
                  e.icon ? <span>{e.icon}</span> : <Table2 className="size-3 shrink-0 text-muted-foreground" />
                ) : (
                  <FileText className="size-3 shrink-0 text-muted-foreground" />
                )}
                <span className="truncate">{e.title}</span>
              </button>
            )}
          />
          <p className="mt-2 text-xs text-muted-foreground">Drag tasks and database entries to reschedule them. Use the + on a day to add a task.</p>
        </div>
      </div>
    </>
  );
}
