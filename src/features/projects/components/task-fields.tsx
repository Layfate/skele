"use client";

import { format, isBefore, isToday, isTomorrow, parseISO, startOfDay } from "date-fns";
import type { ReactNode } from "react";
import { useState } from "react";
import {
  Calendar as CalendarIcon,
  Check,
  Circle,
  CircleCheck,
  CircleDot,
  CirclePause,
  CircleX,
  Plus,
  SignalHigh,
  SignalLow,
  SignalMedium,
  TriangleAlert,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { colorHex } from "@/lib/colors";
import { cn } from "@/lib/utils";
import { PersonChip } from "@/features/databases/components/property-cell";
import {
  PRIORITY_LABEL,
  STATUS_LABEL,
  TASK_PRIORITIES,
  TASK_STATUSES,
  type TaskPriority,
  type TaskStatus,
} from "../schemas";
import { useCreateLabel, useLabels, usePeople } from "../hooks";

export const STATUS_ICON: Record<TaskStatus, { icon: LucideIcon; className: string }> = {
  NOT_STARTED: { icon: Circle, className: "text-muted-foreground" },
  IN_PROGRESS: { icon: CircleDot, className: "text-blue-500" },
  ON_HOLD: { icon: CirclePause, className: "text-amber-500" },
  COMPLETED: { icon: CircleCheck, className: "text-green-600" },
  CANCELLED: { icon: CircleX, className: "text-muted-foreground" },
};

export const PRIORITY_ICON: Record<TaskPriority, { icon: LucideIcon; className: string }> = {
  LOW: { icon: SignalLow, className: "text-muted-foreground" },
  MEDIUM: { icon: SignalMedium, className: "text-foreground/70" },
  HIGH: { icon: SignalHigh, className: "text-orange-500" },
  URGENT: { icon: TriangleAlert, className: "text-rose-500" },
};

export function StatusIcon({ status, className }: { status: TaskStatus; className?: string }) {
  const s = STATUS_ICON[status];
  return <s.icon className={cn("size-4 shrink-0", s.className, className)} aria-label={STATUS_LABEL[status]} />;
}

export function PriorityIcon({ priority, className }: { priority: TaskPriority; className?: string }) {
  const p = PRIORITY_ICON[priority];
  return <p.icon className={cn("size-4 shrink-0", p.className, className)} aria-label={`${PRIORITY_LABEL[priority]} priority`} />;
}

export function dueLabel(due: string | null) {
  if (!due) return null;
  const d = parseISO(due);
  const overdue = isBefore(d, startOfDay(new Date()));
  const text = isToday(d) ? "Today" : isTomorrow(d) ? "Tomorrow" : format(d, "MMM d");
  return { text, overdue, today: isToday(d) };
}

export function DueBadge({ due, className }: { due: string | null; className?: string }) {
  const label = dueLabel(due);
  if (!label) return null;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs whitespace-nowrap text-muted-foreground",
        label.overdue && "text-rose-500",
        label.today && "text-amber-600",
        className,
      )}
    >
      <CalendarIcon className="size-3" />
      {label.text}
    </span>
  );
}

function Picker({
  trigger,
  children,
  disabled,
  className,
}: {
  trigger: ReactNode;
  children: (close: () => void) => ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  if (disabled) return <>{trigger}</>;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="start" className={cn("w-56 p-0", className)} onClick={(e) => e.stopPropagation()}>
        {children(() => setOpen(false))}
      </PopoverContent>
    </Popover>
  );
}

const triggerClass =
  "inline-flex h-7 items-center gap-1.5 rounded-md px-1.5 text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function StatusPicker({
  value,
  onChange,
  disabled,
  showLabel,
}: {
  value: TaskStatus;
  onChange: (s: TaskStatus) => void;
  disabled?: boolean;
  showLabel?: boolean;
}) {
  return (
    <Picker
      disabled={disabled}
      trigger={
        <button type="button" className={triggerClass} aria-label={`Status: ${STATUS_LABEL[value]}`} onClick={(e) => e.stopPropagation()}>
          <StatusIcon status={value} />
          {showLabel && STATUS_LABEL[value]}
        </button>
      }
    >
      {(close) => (
        <Command>
          <CommandList>
            <CommandGroup>
              {TASK_STATUSES.map((s) => (
                <CommandItem key={s} onSelect={() => (onChange(s), close())}>
                  <StatusIcon status={s} /> {STATUS_LABEL[s]}
                  {s === value && <Check className="ml-auto" />}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      )}
    </Picker>
  );
}

export function PriorityPicker({
  value,
  onChange,
  disabled,
  showLabel,
}: {
  value: TaskPriority;
  onChange: (p: TaskPriority) => void;
  disabled?: boolean;
  showLabel?: boolean;
}) {
  return (
    <Picker
      disabled={disabled}
      trigger={
        <button type="button" className={triggerClass} aria-label={`Priority: ${PRIORITY_LABEL[value]}`} onClick={(e) => e.stopPropagation()}>
          <PriorityIcon priority={value} />
          {showLabel && PRIORITY_LABEL[value]}
        </button>
      }
    >
      {(close) => (
        <Command>
          <CommandList>
            <CommandGroup>
              {TASK_PRIORITIES.map((p) => (
                <CommandItem key={p} onSelect={() => (onChange(p), close())}>
                  <PriorityIcon priority={p} /> {PRIORITY_LABEL[p]}
                  {p === value && <Check className="ml-auto" />}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      )}
    </Picker>
  );
}

/** Pick a person by name: someone already used in this workspace, or type a new name. */
export function AssigneePicker({
  workspaceId,
  value,
  onChange,
  disabled,
  showLabel,
}: {
  workspaceId: string;
  value: string | null;
  onChange: (name: string | null) => void;
  disabled?: boolean;
  showLabel?: boolean;
}) {
  const people = usePeople(workspaceId);
  const [query, setQuery] = useState("");
  const typed = query.trim();
  const exists = people.data?.some((n) => n.toLowerCase() === typed.toLowerCase());
  return (
    <Picker
      disabled={disabled}
      trigger={
        <button type="button" className={triggerClass} aria-label={value ? `Assignee: ${value}` : "Assign"} onClick={(e) => e.stopPropagation()}>
          {value ? (
            showLabel ? (
              <PersonChip name={value} />
            ) : (
              <span className="flex size-5 items-center justify-center rounded-full bg-brand-soft text-[10px] font-semibold text-brand" title={value}>
                {value.charAt(0).toUpperCase()}
              </span>
            )
          ) : (
            <>
              <UserRound className="size-4 text-muted-foreground" />
              {showLabel && <span className="text-muted-foreground">Unassigned</span>}
            </>
          )}
        </button>
      }
    >
      {(close) => (
        <Command>
          <CommandInput placeholder="Type a name…" value={query} onValueChange={setQuery} />
          <CommandList>
            <CommandEmpty>Type a name to assign</CommandEmpty>
            <CommandGroup>
              {value && (
                <CommandItem value="__unassign" onSelect={() => (onChange(null), close())}>
                  <UserRound /> Unassigned
                </CommandItem>
              )}
              {people.data?.map((name) => (
                <CommandItem key={name} value={name} onSelect={() => (onChange(name), setQuery(""), close())}>
                  <PersonChip name={name} />
                  {name === value && <Check className="ml-auto" />}
                </CommandItem>
              ))}
              {typed && !exists && (
                <CommandItem value={`__new ${typed}`} onSelect={() => (onChange(typed.slice(0, 80)), setQuery(""), close())}>
                  <Plus /> Assign to “{typed}”
                </CommandItem>
              )}
            </CommandGroup>
          </CommandList>
        </Command>
      )}
    </Picker>
  );
}

export function DuePicker({
  value,
  onChange,
  disabled,
  showLabel,
}: {
  value: string | null;
  onChange: (iso: string | null) => void;
  disabled?: boolean;
  showLabel?: boolean;
}) {
  return (
    <Picker
      disabled={disabled}
      className="w-auto"
      trigger={
        <button type="button" className={triggerClass} aria-label="Due date" onClick={(e) => e.stopPropagation()}>
          {value ? (
            <DueBadge due={value} className="text-sm" />
          ) : (
            <>
              <CalendarIcon className="size-4 text-muted-foreground" />
              {showLabel && <span className="text-muted-foreground">No due date</span>}
            </>
          )}
        </button>
      }
    >
      {(close) => (
        <div>
          <Calendar
            mode="single"
            selected={value ? parseISO(value) : undefined}
            onSelect={(d) => {
              onChange(d ? format(d, "yyyy-MM-dd") : null);
              close();
            }}
          />
          {value && (
            <button
              type="button"
              onClick={() => (onChange(null), close())}
              className="w-full border-t px-3 py-2 text-left text-sm text-muted-foreground hover:bg-accent"
            >
              Clear due date
            </button>
          )}
        </div>
      )}
    </Picker>
  );
}

export function LabelChips({ labels }: { labels: { id: string; name: string; color: string }[] }) {
  return (
    <>
      {labels.map((l) => (
        <span
          key={l.id}
          className="inline-flex h-5 items-center gap-1 rounded-full border px-1.5 text-[11.5px] text-muted-foreground"
        >
          <span className="size-1.5 rounded-full" style={{ background: colorHex(l.color) }} />
          {l.name}
        </span>
      ))}
    </>
  );
}

export function LabelPicker({
  workspaceId,
  value,
  onChange,
  disabled,
}: {
  workspaceId: string;
  value: { id: string; name: string; color: string }[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
}) {
  const labels = useLabels(workspaceId);
  const create = useCreateLabel(workspaceId);
  const [query, setQuery] = useState("");
  const selected = new Set(value.map((l) => l.id));
  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange([...next]);
  };
  const exists = labels.data?.some((l) => l.name.toLowerCase() === query.trim().toLowerCase());
  return (
    <Picker
      disabled={disabled}
      trigger={
        <button type="button" className={cn(triggerClass, "flex-wrap")} aria-label="Labels" onClick={(e) => e.stopPropagation()}>
          {value.length ? <LabelChips labels={value} /> : <span className="text-muted-foreground">Add labels</span>}
        </button>
      }
    >
      {() => (
        <Command>
          <CommandInput placeholder="Search or create…" value={query} onValueChange={setQuery} />
          <CommandList>
            <CommandEmpty>No labels yet</CommandEmpty>
            <CommandGroup>
              {labels.data?.map((l) => (
                <CommandItem key={l.id} value={`${l.name} ${l.id}`} onSelect={() => toggle(l.id)}>
                  <span className="size-2 rounded-full" style={{ background: colorHex(l.color) }} />
                  {l.name}
                  {selected.has(l.id) && <Check className="ml-auto" />}
                </CommandItem>
              ))}
              {query.trim() && !exists && (
                <CommandItem
                  value={`__create ${query}`}
                  onSelect={() =>
                    create.mutate(
                      { name: query.trim(), color: ["indigo", "teal", "amber", "rose", "violet", "green"][(labels.data?.length ?? 0) % 6] },
                      {
                        onSuccess: (l) => {
                          onChange([...selected, l.id]);
                          setQuery("");
                        },
                      },
                    )
                  }
                >
                  <Plus /> Create “{query.trim()}”
                </CommandItem>
              )}
            </CommandGroup>
          </CommandList>
        </Command>
      )}
    </Picker>
  );
}

export function ProgressBar({ value, className }: { value: number | null; className?: string }) {
  const pct = Math.round((value ?? 0) * 100);
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div
        className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className="h-full rounded-full bg-brand transition-[width] duration-500" style={{ width: `${pct}%` }} />
      </div>
      <span className="w-9 text-right text-xs text-muted-foreground tabular-nums">{value === null ? "—" : `${pct}%`}</span>
    </div>
  );
}

