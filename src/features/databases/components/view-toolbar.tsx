"use client";

import type { ReactNode } from "react";
import { Eye, EyeOff, Plus, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { groupableTypes, OP_LABEL, opNeedsValue, opsFor, TITLE_ID, type Filter, type FilterOp, type Sort } from "../query";
import { PROPERTY_TYPE_LABEL, type Property } from "../properties";
import { useDb } from "./database-context";
import { AddPropertyMenu } from "./property-header";

const selectClass =
  "h-8 rounded-md border bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring disabled:opacity-60";

function useViewConfig() {
  const { view, m, editable } = useDb();
  const set = (config: Partial<typeof view.config>) => m.updateView.mutate({ id: view.id, config });
  return { config: view.config, set, editable };
}

type Field = { id: string; name: string; type: Property["type"] | "TITLE"; prop?: Property };

function useFields(): Field[] {
  const { data } = useDb();
  return [{ id: TITLE_ID, name: "Name", type: "TITLE" as const }, ...data.properties.map((p) => ({ id: p.id, name: p.name, type: p.type, prop: p }))];
}

export function FilterPopover({ children }: { children: ReactNode }) {
  const { config, set, editable } = useViewConfig();
  const fields = useFields();
  const filters = config.filters;
  const update = (i: number, patch: Partial<Filter>) => set({ filters: filters.map((f, idx) => (idx === i ? { ...f, ...patch } : f)) });

  return (
    <Popover>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="end" className="w-[440px] max-w-[calc(100vw-2rem)]">
        {filters.length === 0 && <p className="mb-2 text-sm text-muted-foreground">No filters applied to this view.</p>}
        <div className="space-y-2">
          {filters.map((f, i) => {
            const field = fields.find((x) => x.id === f.propertyId);
            const ops = field ? opsFor(field.type) : [];
            return (
              <div key={i} className="flex items-center gap-1.5">
                <select
                  aria-label="Property"
                  disabled={!editable}
                  className={cn(selectClass, "w-32")}
                  value={f.propertyId}
                  onChange={(e) => {
                    const nf = fields.find((x) => x.id === e.target.value)!;
                    update(i, { propertyId: nf.id, op: opsFor(nf.type)[0], value: undefined });
                  }}
                >
                  {fields.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Condition"
                  disabled={!editable}
                  className={cn(selectClass, "w-32")}
                  value={f.op}
                  onChange={(e) => update(i, { op: e.target.value as FilterOp })}
                >
                  {ops.map((op) => (
                    <option key={op} value={op}>
                      {OP_LABEL[op]}
                    </option>
                  ))}
                </select>
                {opNeedsValue(f.op) && field ? (
                  <FilterValue field={field} value={f.value} disabled={!editable} onChange={(value) => update(i, { value })} />
                ) : (
                  <span className="flex-1" />
                )}
                {editable && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Remove filter"
                    onClick={() => set({ filters: filters.filter((_, idx) => idx !== i) })}
                  >
                    <X />
                  </Button>
                )}
              </div>
            );
          })}
        </div>
        {editable && (
          <Button
            variant="ghost"
            size="sm"
            className="mt-2 text-muted-foreground"
            onClick={() => set({ filters: [...filters, { propertyId: TITLE_ID, op: "contains", value: "" }] })}
          >
            <Plus /> Add filter
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}

function FilterValue({ field, value, onChange, disabled }: { field: Field; value: unknown; onChange: (v: unknown) => void; disabled: boolean }) {
  const { members } = useDb();
  const cls = cn(selectClass, "min-w-0 flex-1");
  if (field.prop && (field.type === "SELECT" || field.type === "STATUS" || field.type === "MULTI_SELECT")) {
    return (
      <select aria-label="Value" disabled={disabled} className={cls} value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)}>
        <option value="">Select…</option>
        {(field.prop.config.options ?? []).map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    );
  }
  if (field.type === "PERSON") {
    return (
      <select aria-label="Value" disabled={disabled} className={cls} value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)}>
        <option value="">Select…</option>
        {members.map((mb) => (
          <option key={mb.id} value={mb.id}>
            {mb.name}
          </option>
        ))}
      </select>
    );
  }
  return (
    <input
      aria-label="Value"
      disabled={disabled}
      type={field.type === "DATE" ? "date" : field.type === "NUMBER" ? "number" : "text"}
      className={cn(cls, "px-2")}
      defaultValue={(value as string) ?? ""}
      onBlur={(e) => onChange(field.type === "NUMBER" ? Number(e.target.value) : e.target.value)}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      placeholder="Value"
    />
  );
}

export function SortPopover({ children }: { children: ReactNode }) {
  const { config, set, editable } = useViewConfig();
  const fields = useFields();
  const sorts = config.sorts;
  const update = (i: number, patch: Partial<Sort>) => set({ sorts: sorts.map((s, idx) => (idx === i ? { ...s, ...patch } : s)) });
  const unused = fields.filter((f) => !sorts.some((s) => s.propertyId === f.id));

  return (
    <Popover>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="end" className="w-[340px]">
        {sorts.length === 0 && <p className="mb-2 text-sm text-muted-foreground">Records use their manual order.</p>}
        <div className="space-y-2">
          {sorts.map((s, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <select
                aria-label="Sort by"
                disabled={!editable}
                className={cn(selectClass, "flex-1")}
                value={s.propertyId}
                onChange={(e) => update(i, { propertyId: e.target.value })}
              >
                {fields.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
              <select
                aria-label="Direction"
                disabled={!editable}
                className={cn(selectClass, "w-28")}
                value={s.dir}
                onChange={(e) => update(i, { dir: e.target.value as Sort["dir"] })}
              >
                <option value="asc">Ascending</option>
                <option value="desc">Descending</option>
              </select>
              {editable && (
                <Button variant="ghost" size="icon-sm" aria-label="Remove sort" onClick={() => set({ sorts: sorts.filter((_, idx) => idx !== i) })}>
                  <X />
                </Button>
              )}
            </div>
          ))}
        </div>
        {editable && unused.length > 0 && sorts.length < 5 && (
          <Button
            variant="ghost"
            size="sm"
            className="mt-2 text-muted-foreground"
            onClick={() => set({ sorts: [...sorts, { propertyId: unused[0].id, dir: "asc" }] })}
          >
            <Plus /> Add sort
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}

export function ViewSettingsPopover({ children }: { children: ReactNode }) {
  const { data, view, editable } = useDb();
  const { config, set } = useViewConfig();
  const groupable = data.properties.filter((p) => groupableTypes.includes(p.type));
  const dates = data.properties.filter((p) => p.type === "DATE");

  return (
    <Popover>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="end" className="w-72">
        {view.type === "BOARD" && (
          <div className="mb-3 space-y-1.5">
            <Label className="text-xs text-muted-foreground">Group by</Label>
            <select
              disabled={!editable}
              className={cn(selectClass, "w-full")}
              value={config.groupBy ?? ""}
              onChange={(e) => set({ groupBy: e.target.value || null })}
            >
              <option value="">None</option>
              {groupable.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        )}
        {view.type === "CALENDAR" && (
          <div className="mb-3 space-y-1.5">
            <Label className="text-xs text-muted-foreground">Show by date</Label>
            <select
              disabled={!editable}
              className={cn(selectClass, "w-full")}
              value={config.dateProperty ?? ""}
              onChange={(e) => set({ dateProperty: e.target.value || null })}
            >
              <option value="">Choose a date property</option>
              {dates.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <p className="mb-1 text-xs text-muted-foreground">Properties</p>
        <div className="max-h-64 space-y-px overflow-y-auto">
          {data.properties.map((p) => {
            const hidden = config.hidden.includes(p.id);
            return (
              <button
                key={p.id}
                type="button"
                disabled={!editable}
                onClick={() => set({ hidden: hidden ? config.hidden.filter((h) => h !== p.id) : [...config.hidden, p.id] })}
                className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-accent disabled:hover:bg-transparent"
              >
                <span className={cn("flex-1 truncate", hidden && "text-muted-foreground")}>{p.name}</span>
                <span className="text-xs text-muted-foreground">{PROPERTY_TYPE_LABEL[p.type]}</span>
                {hidden ? <EyeOff className="size-3.5 text-muted-foreground" /> : <Eye className="size-3.5" />}
              </button>
            );
          })}
        </div>
        {editable && (
          <div className="mt-2 border-t pt-2">
            <AddPropertyMenu>
              <Button variant="ghost" size="sm" className="w-full justify-start text-muted-foreground">
                <Plus /> New property
              </Button>
            </AddPropertyMenu>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
