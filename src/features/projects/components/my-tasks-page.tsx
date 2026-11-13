"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { Topbar } from "@/features/shell/topbar";
import { TaskWorkspace } from "./task-workspace";

const SCOPES = [
  { id: "all", label: "All tasks", query: {} },
  { id: "inbox", label: "Inbox (no project)", query: { inbox: true } },
] as const;

export function MyTasksPage() {
  const [scope, setScope] = useState<(typeof SCOPES)[number]["id"]>("all");
  const current = SCOPES.find((s) => s.id === scope)!;
  return (
    <>
      <Topbar crumbs={[{ label: "My tasks" }]} />
      <div className="flex-1 overflow-y-auto px-[clamp(1.25rem,4vw,3rem)] pt-6 pb-16 scrollbar-thin">
        <div className="mx-auto max-w-5xl">
          <div className="mb-4 flex flex-wrap items-end gap-4">
            <h1 className="text-2xl font-bold tracking-tight">My tasks</h1>
            <div className="mb-0.5 flex rounded-md bg-muted p-0.5 text-sm" role="tablist">
              {SCOPES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  role="tab"
                  aria-selected={scope === s.id}
                  onClick={() => setScope(s.id)}
                  className={cn("h-7 rounded px-2.5 text-muted-foreground", scope === s.id && "bg-background text-foreground shadow-sm")}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
          <TaskWorkspace key={scope} query={current.query} defaults={{}} prefsKey={`my-tasks:${scope}`} showProject />
        </div>
      </div>
    </>
  );
}
