"use client";

import { CalendarDays, Plus } from "lucide-react";
import { EmptyState, PageIcon } from "@/components/common";
import { MonthCalendar } from "@/components/month-calendar";
import type { DbRecord } from "../hooks";
import { useDb } from "./database-context";
import { PropertyValue } from "./property-cell";

function Values({ record, max }: { record: DbRecord; max?: number }) {
  const { visible, members } = useDb();
  const shown = visible
    .filter((p) => p.type !== "CHECKBOX" && record.values[p.id] != null && record.values[p.id] !== "" && !(Array.isArray(record.values[p.id]) && !(record.values[p.id] as unknown[]).length))
    .slice(0, max);
  return (
    <>
      {shown.map((p) => (
        <span key={p.id} className="flex min-w-0 items-center text-[13px] text-muted-foreground">
          <PropertyValue prop={p} value={record.values[p.id]} members={members} />
        </span>
      ))}
    </>
  );
}

function NewButton({ label = "New" }: { label?: string }) {
  const { editable, m, openRecord } = useDb();
  if (!editable) return null;
  return (
    <button
      type="button"
      onClick={() => m.createRecord.mutate({}, { onSuccess: (r) => openRecord(r.id) })}
      className="flex h-9 w-full items-center gap-2 rounded-md px-2 text-sm text-muted-foreground hover:bg-accent/50"
    >
      <Plus className="size-4" /> {label}
    </button>
  );
}

export function ListView({ records }: { records: DbRecord[] }) {
  const { openRecord } = useDb();
  return (
    <div>
      <ul className="divide-y">
        {records.map((r) => (
          <li key={r.id}>
            <button
              type="button"
              onClick={() => openRecord(r.id)}
              className="flex min-h-10 w-full items-center gap-3 rounded-md px-2 py-1.5 text-left hover:bg-accent/50"
            >
              <PageIcon icon={r.icon} className="size-4 text-[15px]" />
              <span className="min-w-0 flex-1 truncate font-medium">{r.title || <span className="text-muted-foreground">Untitled</span>}</span>
              <span className="hidden max-w-[55%] items-center gap-3 overflow-hidden sm:flex">
                <Values record={r} max={4} />
              </span>
            </button>
          </li>
        ))}
      </ul>
      {records.length === 0 && <p className="px-2 py-6 text-sm text-muted-foreground">No records match this view.</p>}
      <NewButton />
    </div>
  );
}

export function GalleryView({ records }: { records: DbRecord[] }) {
  const { openRecord } = useDb();
  return (
    <div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
        {records.map((r) => (
          <button
            type="button"
            key={r.id}
            onClick={() => openRecord(r.id)}
            className="flex min-h-36 flex-col overflow-hidden rounded-lg border bg-card text-left shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-shadow hover:shadow-md"
          >
            <div className="flex h-20 items-center justify-center bg-muted/50 text-3xl">{r.icon ?? ""}</div>
            <div className="flex flex-1 flex-col gap-1 p-3">
              <span className="font-medium">{r.title || <span className="text-muted-foreground">Untitled</span>}</span>
              <Values record={r} max={3} />
            </div>
          </button>
        ))}
      </div>
      <div className="mt-2">
        <NewButton />
      </div>
    </div>
  );
}

export function CalendarView({ records }: { records: DbRecord[] }) {
  const { data, view, editable, m, openRecord } = useDb();
  const dateProp = data.properties.find((p) => p.id === view.config.dateProperty && p.type === "DATE");
  if (!dateProp) {
    const candidate = data.properties.find((p) => p.type === "DATE");
    return (
      <EmptyState
        icon={CalendarDays}
        title="Pick a date property"
        description="Calendars place records on the date from one of their date properties."
        action={
          editable ? (
            candidate ? (
              <button
                type="button"
                className="text-sm font-medium text-brand hover:underline"
                onClick={() => m.updateView.mutate({ id: view.id, config: { dateProperty: candidate.id } })}
              >
                Use “{candidate.name}”
              </button>
            ) : (
              <button
                type="button"
                className="text-sm font-medium text-brand hover:underline"
                onClick={() =>
                  m.createProperty.mutate(
                    { name: "Date", type: "DATE" },
                    { onSuccess: (p) => m.updateView.mutate({ id: view.id, config: { dateProperty: p.id } }) },
                  )
                }
              >
                Add a date property
              </button>
            )
          ) : null
        }
      />
    );
  }
  const items = records
    .filter((r) => typeof r.values[dateProp.id] === "string")
    .map((r) => ({ ...r, date: r.values[dateProp.id] as string }));
  const undated = records.length - items.length;
  return (
    <MonthCalendar
      items={items}
      editable={editable}
      onMove={(id, date) => m.updateRecord.mutate({ id, values: { [dateProp.id]: date } })}
      onAdd={(date) => m.createRecord.mutate({ values: { [dateProp.id]: date } }, { onSuccess: (r) => openRecord(r.id) })}
      renderItem={(r) => (
        <button
          type="button"
          onClick={() => openRecord(r.id)}
          className="flex w-full items-center gap-1 truncate rounded border bg-card px-1.5 py-0.5 text-left text-xs shadow-sm hover:bg-accent"
        >
          {r.icon && <span>{r.icon}</span>}
          <span className="truncate">{r.title || "Untitled"}</span>
        </button>
      )}
      footer={
        undated > 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">
            {undated} {undated === 1 ? "record has" : "records have"} no {dateProp.name.toLowerCase()} and {undated === 1 ? "is" : "are"} not shown.
          </p>
        ) : null
      }
    />
  );
}
