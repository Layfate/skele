"use client";

import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { useMemo, useState } from "react";
import { Columns3, Plus } from "lucide-react";
import { EmptyState, PageIcon } from "@/components/common";
import { cn } from "@/lib/utils";
import type { DbRecord } from "../hooks";
import { groupableTypes, groupRecords } from "../query";
import type { Property } from "../properties";
import { useDb } from "./database-context";
import { OptionPill, PropertyValue, StatusPill } from "./property-cell";

/** The value to write when a card lands in a group. */
function valueForGroup(prop: Property, key: string, current: unknown, fromKey: string): unknown {
  if (key === "__none") return prop.type === "MULTI_SELECT" ? [] : null;
  if (prop.type === "CHECKBOX") return key === "true";
  if (prop.type === "MULTI_SELECT") {
    const list = Array.isArray(current) ? (current as string[]).filter((k) => k !== fromKey) : [];
    return [...new Set([...list, key])];
  }
  return key;
}

export function BoardView({ records }: { records: DbRecord[] }) {
  const { data, view, editable, m, members } = useDb();
  const groupProp = data.properties.find((p) => p.id === view.config.groupBy && groupableTypes.includes(p.type));
  const people = useMemo(() => new Map(members.map((x) => [x.id, x.name])), [members]);
  const groups = useMemo(() => groupRecords(records, groupProp, people), [records, groupProp, people]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  if (!groupProp) {
    const candidate = data.properties.find((p) => groupableTypes.includes(p.type));
    return (
      <EmptyState
        icon={Columns3}
        title="Choose how to group this board"
        description="Boards group records by a select, status, checkbox or person property."
        action={
          editable && candidate ? (
            <button
              type="button"
              className="text-sm font-medium text-brand hover:underline"
              onClick={() => m.updateView.mutate({ id: view.id, config: { groupBy: candidate.id } })}
            >
              Group by {candidate.name}
            </button>
          ) : null
        }
      />
    );
  }

  const onDragEnd = (e: DragEndEvent) => {
    setActiveId(null);
    if (!e.over) return;
    const [fromKey, recordId] = String(e.active.id).split("|");
    const overId = String(e.over.id);
    let toKey: string;
    let beforeCardId: string | null = null;
    if (overId.startsWith("col:")) toKey = overId.slice(4);
    else {
      [toKey, beforeCardId] = overId.split("|");
      if (beforeCardId === recordId) return;
    }
    const record = records.find((r) => r.id === recordId);
    if (!record) return;
    const target = groups.find((g) => g.key === toKey)?.records.filter((r) => r.id !== recordId) ?? [];
    let beforeId: string | null;
    let afterId: string | null;
    if (beforeCardId) {
      const idx = target.findIndex((r) => r.id === beforeCardId);
      beforeId = target[idx - 1]?.id ?? null;
      afterId = beforeCardId;
    } else {
      beforeId = target.at(-1)?.id ?? null;
      afterId = null;
    }
    const values = toKey !== fromKey ? { [groupProp.id]: valueForGroup(groupProp, toKey, record.values[groupProp.id], fromKey) } : undefined;
    m.moveRecord.mutate({ id: recordId, beforeId, afterId, values });
  };

  const active = activeId ? records.find((r) => r.id === activeId.split("|")[1]) : null;

  return (
    <DndContext
      sensors={sensors}
      onDragStart={(e) => setActiveId(String(e.active.id))}
      onDragEnd={onDragEnd}
      onDragCancel={() => setActiveId(null)}
    >
      <div className="flex gap-3 overflow-x-auto pb-4 scrollbar-thin">
        {groups.map((g) => (
          <Column key={g.key} groupKey={g.key} count={g.records.length} header={<GroupLabel prop={groupProp} group={g} />}>
            {g.records.map((r) => (
              <Card key={r.id} record={r} groupKey={g.key} />
            ))}
            {editable && (
              <button
                type="button"
                onClick={() =>
                  m.createRecord.mutate({
                    values: g.key === "__none" ? {} : { [groupProp.id]: valueForGroup(groupProp, g.key, undefined, "") },
                  })
                }
                className="flex h-8 w-full items-center gap-1.5 rounded-md px-2 text-sm text-muted-foreground hover:bg-accent"
              >
                <Plus className="size-3.5" /> New
              </button>
            )}
          </Column>
        ))}
      </div>
      <DragOverlay dropAnimation={null}>{active && <CardBody record={active} dragging />}</DragOverlay>
    </DndContext>
  );
}

function GroupLabel({ prop, group }: { prop: Property; group: { key: string; label: string; color: string | null } }) {
  if (group.key === "__none") return <span className="text-sm text-muted-foreground">{group.label}</span>;
  const option = { id: group.key, name: group.label, color: group.color ?? "gray" };
  if (prop.type === "STATUS") return <StatusPill option={option} />;
  if (prop.type === "SELECT" || prop.type === "MULTI_SELECT") return <OptionPill option={option} />;
  return <span className="text-sm font-medium">{group.label}</span>;
}

function Column({ groupKey, count, header, children }: { groupKey: string; count: number; header: React.ReactNode; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: `col:${groupKey}` });
  return (
    <section
      ref={setNodeRef}
      aria-label={`Group ${groupKey}`}
      className={cn("flex w-72 shrink-0 flex-col rounded-lg bg-muted/40 p-1.5 transition-colors", isOver && "bg-brand-soft")}
    >
      <header className="mb-1.5 flex h-7 items-center gap-2 px-1.5">
        {header}
        <span className="text-xs text-muted-foreground">{count}</span>
      </header>
      <div className="flex min-h-10 flex-col gap-1.5">{children}</div>
    </section>
  );
}

function Card({ record, groupKey }: { record: DbRecord; groupKey: string }) {
  const { editable } = useDb();
  const id = `${groupKey}|${record.id}`;
  const drag = useDraggable({ id, disabled: !editable });
  const drop = useDroppable({ id });
  return (
    <div
      ref={(n) => {
        drag.setNodeRef(n);
        drop.setNodeRef(n);
      }}
      {...drag.attributes}
      {...drag.listeners}
      className={cn("relative", drag.isDragging && "opacity-30")}
    >
      {drop.isOver && !drag.isDragging && <span className="absolute -top-1 right-1 left-1 h-0.5 rounded bg-brand" />}
      <CardBody record={record} />
    </div>
  );
}

function CardBody({ record, dragging }: { record: DbRecord; dragging?: boolean }) {
  const { visible, view, members, openRecord } = useDb();
  const shown = visible.filter((p) => p.id !== view.config.groupBy && record.values[p.id] != null && record.values[p.id] !== "");
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => openRecord(record.id)}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && openRecord(record.id)}
      className={cn(
        "cursor-pointer rounded-md border bg-card p-2.5 text-sm shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-shadow hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        dragging && "rotate-1 shadow-lg",
      )}
    >
      <div className="flex items-start gap-1.5 font-medium">
        {record.icon && <PageIcon icon={record.icon} className="text-[15px]" />}
        <span className="min-w-0 break-words">{record.title || <span className="text-muted-foreground">Untitled</span>}</span>
      </div>
      {shown.length > 0 && (
        <div className="mt-1.5 flex flex-col gap-1 text-[13px] text-muted-foreground">
          {shown.map((p) =>
            p.type === "CHECKBOX" ? (
              <span key={p.id}>{record.values[p.id] ? `✓ ${p.name}` : null}</span>
            ) : (
              <div key={p.id} className="flex min-w-0">
                <PropertyValue prop={p} value={record.values[p.id]} members={members} />
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
}
