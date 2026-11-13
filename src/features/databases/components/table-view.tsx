"use client";

import { useState } from "react";
import { Maximize2, Plus, Trash2 } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { PageIcon } from "@/components/common";
import { cn } from "@/lib/utils";
import type { DbRecord } from "../hooks";
import { useDb } from "./database-context";
import { PropertyCell } from "./property-cell";
import { AddPropertyMenu, PropertyHeader } from "./property-header";

const TITLE_WIDTH = 280;
const DEFAULT_WIDTH = 180;

export function TableView({ records }: { records: DbRecord[] }) {
  const { visible, view, editable, m, members, setValue, createOption } = useDb();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const widthOf = (id: string) => view.config.widths[id] ?? DEFAULT_WIDTH;
  const template = `${editable ? "32px " : ""}${TITLE_WIDTH}px ${visible.map((p) => `${widthOf(p.id)}px`).join(" ")} ${editable ? "44px" : ""} minmax(0,1fr)`;

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div>
      {selected.size > 0 && (
        <div className="mb-2 flex items-center gap-2 rounded-md border bg-card px-3 py-1.5 text-sm">
          <span>{selected.size} selected</span>
          <Button
            variant="destructive"
            size="xs"
            onClick={() => {
              m.deleteRecords.mutate([...selected]);
              setSelected(new Set());
            }}
          >
            <Trash2 /> Delete
          </Button>
          <Button variant="ghost" size="xs" onClick={() => setSelected(new Set())}>
            Clear
          </Button>
        </div>
      )}
      <div className="overflow-x-auto scrollbar-thin" role="table" aria-label="Records">
        <div className="min-w-max">
          <div role="row" className="grid border-b text-[13px] text-muted-foreground" style={{ gridTemplateColumns: template }}>
            {editable && (
              <div className="flex items-center justify-center">
                <Checkbox
                  aria-label="Select all"
                  checked={records.length > 0 && selected.size === records.length}
                  onCheckedChange={(v) => setSelected(v ? new Set(records.map((r) => r.id)) : new Set())}
                />
              </div>
            )}
            <div role="columnheader" className="flex h-9 items-center px-2 font-medium">
              Name
            </div>
            {visible.map((p) => (
              <div role="columnheader" key={p.id} className="border-l">
                <PropertyHeader prop={p} className="flex h-9 w-full items-center px-2 font-medium hover:bg-accent/60" />
              </div>
            ))}
            {editable && (
              <div className="border-l">
                <AddPropertyMenu>
                  <button type="button" aria-label="Add property" className="flex h-9 w-full items-center justify-center hover:bg-accent/60">
                    <Plus className="size-4" />
                  </button>
                </AddPropertyMenu>
              </div>
            )}
            <div />
          </div>

          {records.map((r) => (
            <div
              role="row"
              key={r.id}
              className={cn("group/row grid border-b hover:bg-accent/30", selected.has(r.id) && "bg-brand-soft/60")}
              style={{ gridTemplateColumns: template }}
            >
              {editable && (
                <div className="flex items-center justify-center">
                  <Checkbox
                    aria-label="Select record"
                    checked={selected.has(r.id)}
                    onCheckedChange={() => toggle(r.id)}
                    className={cn("opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100", selected.has(r.id) && "opacity-100")}
                  />
                </div>
              )}
              <TitleCell record={r} />
              {visible.map((p) => (
                <div role="cell" key={p.id} className="min-w-0 border-l">
                  <PropertyCell
                    prop={p}
                    value={r.values[p.id]}
                    editable={editable}
                    members={members}
                    onChange={(v) => setValue(r.id, p.id, v)}
                    onCreateOption={(name) => createOption(p, name)}
                    className="min-h-9"
                  />
                </div>
              ))}
              {editable && <div className="border-l" />}
              <div />
            </div>
          ))}
          {editable && (
            <button
              type="button"
              onClick={() => m.createRecord.mutate({})}
              aria-label="Add a record"
              className="flex h-9 w-full items-center gap-2 px-2 text-sm text-muted-foreground hover:bg-accent/40"
            >
              <Plus className="size-4" /> New
            </button>
          )}
          {!editable && records.length === 0 && <p className="px-2 py-6 text-sm text-muted-foreground">No records.</p>}
        </div>
      </div>
      <p className="mt-2 px-2 text-xs text-muted-foreground">
        {records.length} {records.length === 1 ? "record" : "records"}
      </p>
    </div>
  );
}

function TitleCell({ record }: { record: DbRecord }) {
  const { editable, m, openRecord } = useDb();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(record.title);

  return (
    <div role="cell" className="relative flex min-h-9 min-w-0 items-center gap-1.5 px-2">
      <PageIcon icon={record.icon} className="size-4 text-[15px]" />
      {editing ? (
        <input
          autoFocus
          value={value}
          maxLength={500}
          aria-label="Name"
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => {
            setEditing(false);
            if (value !== record.title) m.updateRecord.mutate({ id: record.id, title: value });
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") {
              setValue(record.title);
              setEditing(false);
            }
          }}
          className="h-7 min-w-0 flex-1 rounded border bg-background px-1.5 text-sm font-medium outline-none focus:ring-2 focus:ring-ring"
        />
      ) : (
        <button
          type="button"
          onClick={() => (editable ? (setValue(record.title), setEditing(true)) : openRecord(record.id))}
          className="min-w-0 flex-1 truncate text-left text-sm font-medium"
        >
          {record.title || <span className="text-muted-foreground/70">Untitled</span>}
        </button>
      )}
      {!editing && (
        <button
          type="button"
          onClick={() => openRecord(record.id)}
          className="flex h-6 shrink-0 items-center gap-1 rounded border bg-background px-1.5 text-[11px] font-medium text-muted-foreground opacity-0 shadow-sm group-hover/row:opacity-100 hover:text-foreground focus-visible:opacity-100"
        >
          <Maximize2 className="size-3" /> Open
        </button>
      )}
    </div>
  );
}
