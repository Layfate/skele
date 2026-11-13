"use client";

import {
  DndContext,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns";
import { useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type CalendarItem = { id: string; date: string };

/**
 * Month grid. Items are bucketed by `date` (yyyy-MM-dd prefix). Items can be dragged to
 * another day (`onMove`), and days have a quick-add button (`onAdd`).
 */
export function MonthCalendar<T extends CalendarItem>({
  items,
  renderItem,
  onMove,
  onAdd,
  editable,
  footer,
}: {
  items: T[];
  renderItem: (item: T) => ReactNode;
  onMove?: (id: string, date: string) => void;
  onAdd?: (date: string) => void;
  editable: boolean;
  footer?: ReactNode;
}) {
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const days = eachDayOfInterval({
    start: startOfWeek(startOfMonth(month), { weekStartsOn: 1 }),
    end: endOfWeek(endOfMonth(month), { weekStartsOn: 1 }),
  });
  const byDay = new Map<string, T[]>();
  for (const item of items) {
    const key = item.date.slice(0, 10);
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key)!.push(item);
  }

  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || !onMove) return;
    const date = String(e.over.id).replace("day:", "");
    const id = String(e.active.id).replace("item:", "");
    const item = items.find((i) => i.id === id);
    if (item && item.date.slice(0, 10) !== date) onMove(id, date);
  };

  return (
    <div>
      <div className="mb-2 flex items-center gap-1">
        <h3 className="mr-auto text-base font-semibold">{format(month, "MMMM yyyy")}</h3>
        <Button variant="ghost" size="sm" onClick={() => setMonth(startOfMonth(new Date()))}>
          Today
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label="Previous month" onClick={() => setMonth((m) => subMonths(m, 1))}>
          <ChevronLeft />
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label="Next month" onClick={() => setMonth((m) => addMonths(m, 1))}>
          <ChevronRight />
        </Button>
      </div>
      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <div className="overflow-x-auto">
          <div className="grid min-w-[700px] grid-cols-7 overflow-hidden rounded-lg border">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
              <div key={d} className="border-b bg-muted/40 px-2 py-1.5 text-xs font-medium text-muted-foreground">
                {d}
              </div>
            ))}
            {days.map((day, i) => {
              const key = format(day, "yyyy-MM-dd");
              return (
                <Day
                  key={key}
                  dateKey={key}
                  label={format(day, "d")}
                  muted={!isSameMonth(day, month)}
                  today={isToday(day)}
                  lastCol={i % 7 === 6}
                  onAdd={editable && onAdd ? () => onAdd(key) : undefined}
                >
                  {(byDay.get(key) ?? []).map((item) => (
                    <DraggableItem key={item.id} id={item.id} disabled={!editable || !onMove}>
                      {renderItem(item)}
                    </DraggableItem>
                  ))}
                </Day>
              );
            })}
          </div>
        </div>
      </DndContext>
      {footer}
    </div>
  );
}

function Day({
  dateKey,
  label,
  muted,
  today,
  lastCol,
  onAdd,
  children,
}: {
  dateKey: string;
  label: string;
  muted: boolean;
  today: boolean;
  lastCol: boolean;
  onAdd?: () => void;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `day:${dateKey}` });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "group/day min-h-28 border-b p-1",
        !lastCol && "border-r",
        muted && "bg-muted/25",
        isOver && "bg-brand-soft",
      )}
    >
      <div className="mb-1 flex items-center justify-between px-1">
        <span
          className={cn(
            "flex size-6 items-center justify-center rounded-full text-xs",
            muted && "text-muted-foreground/60",
            today && "bg-brand font-semibold text-brand-foreground",
          )}
        >
          {label}
        </span>
        {onAdd && (
          <button
            type="button"
            aria-label={`Add on ${dateKey}`}
            onClick={onAdd}
            className="flex size-5 items-center justify-center rounded text-muted-foreground opacity-0 group-hover/day:opacity-100 hover:bg-accent focus-visible:opacity-100"
          >
            <Plus className="size-3.5" />
          </button>
        )}
      </div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function DraggableItem({ id, disabled, children }: { id: string; disabled: boolean; children: ReactNode }) {
  const { setNodeRef, listeners, attributes, transform, isDragging } = useDraggable({ id: `item:${id}`, disabled });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      role="presentation"
      tabIndex={-1}
      style={transform ? { transform: `translate(${transform.x}px, ${transform.y}px)`, zIndex: 20, position: "relative" } : undefined}
      className={cn(isDragging && "opacity-80 shadow-lg")}
    >
      {children}
    </div>
  );
}
