"use client";

import { useState, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowUp,
  AtSign,
  Calendar,
  CheckSquare,
  CircleDot,
  EyeOff,
  Hash,
  Link2,
  List,
  ListChecks,
  Plus,
  Trash2,
  Type,
  User,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { COLOR_NAMES, colorHex } from "@/lib/colors";
import { PROPERTY_TYPE_LABEL, PROPERTY_TYPES, hasOptions, type Property, type PropertyType } from "../properties";
import { useDb } from "./database-context";
import { newOption } from "./property-cell";

export const PROPERTY_ICON: Record<PropertyType, LucideIcon> = {
  TEXT: Type,
  NUMBER: Hash,
  SELECT: CircleDot,
  MULTI_SELECT: List,
  STATUS: ListChecks,
  CHECKBOX: CheckSquare,
  DATE: Calendar,
  URL: Link2,
  EMAIL: AtSign,
  PERSON: User,
};

export function AddPropertyMenu({ children, onCreated }: { children: ReactNode; onCreated?: (p: Property) => void }) {
  const { m } = useDb();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48">
        <DropdownMenuLabel className="text-xs text-muted-foreground">Property type</DropdownMenuLabel>
        {PROPERTY_TYPES.map((t) => {
          const Icon = PROPERTY_ICON[t];
          return (
            <DropdownMenuItem
              key={t}
              onSelect={() => m.createProperty.mutate({ name: PROPERTY_TYPE_LABEL[t], type: t }, { onSuccess: onCreated })}
            >
              <Icon /> {PROPERTY_TYPE_LABEL[t]}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Column header with rename / type / options / sort / hide / delete. */
export function PropertyHeader({ prop, className }: { prop: Property; className?: string }) {
  const { m, view, editable } = useDb();
  const Icon = PROPERTY_ICON[prop.type];
  const [name, setName] = useState(prop.name);
  const [optionsOpen, setOptionsOpen] = useState(false);

  const label = (
    <span className="flex min-w-0 items-center gap-1.5">
      <Icon className="size-3.5 shrink-0" />
      <span className="truncate">{prop.name}</span>
    </span>
  );
  if (!editable) return <div className={className}>{label}</div>;

  const sortBy = (dir: "asc" | "desc") =>
    m.updateView.mutate({ id: view.id, config: { sorts: [{ propertyId: prop.id, dir }] } });

  return (
    <>
      <DropdownMenu onOpenChange={(o) => o && setName(prop.name)}>
        <DropdownMenuTrigger asChild>
          <button type="button" className={className}>
            {label}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <div className="p-1">
            <input
              aria-label="Property name"
              value={name}
              maxLength={100}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter" && name.trim()) m.updateProperty.mutate({ id: prop.id, name: name.trim() });
              }}
              onBlur={() => name.trim() && name.trim() !== prop.name && m.updateProperty.mutate({ id: prop.id, name: name.trim() })}
              className="h-8 w-full rounded-md border bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Icon /> Type: {PROPERTY_TYPE_LABEL[prop.type]}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {PROPERTY_TYPES.map((t) => {
                const TIcon = PROPERTY_ICON[t];
                return (
                  <DropdownMenuItem
                    key={t}
                    disabled={t === prop.type}
                    onSelect={() => {
                      if (confirm(`Change "${prop.name}" to ${PROPERTY_TYPE_LABEL[t]}? Existing values in this column will be cleared.`)) {
                        m.updateProperty.mutate({ id: prop.id, type: t });
                      }
                    }}
                  >
                    <TIcon /> {PROPERTY_TYPE_LABEL[t]}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          {hasOptions(prop.type) && (
            <DropdownMenuItem onSelect={() => setTimeout(() => setOptionsOpen(true))}>
              <List /> Edit options
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => sortBy("asc")}>
            <ArrowUp /> Sort ascending
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => sortBy("desc")}>
            <ArrowDown /> Sort descending
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => m.updateView.mutate({ id: view.id, config: { hidden: [...view.config.hidden, prop.id] } })}
          >
            <EyeOff /> Hide in view
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onSelect={() => confirm(`Delete the "${prop.name}" property and all its values?`) && m.deleteProperty.mutate(prop.id)}
          >
            <Trash2 /> Delete property
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {optionsOpen && <OptionsEditor prop={prop} open={optionsOpen} onOpenChange={setOptionsOpen} />}
    </>
  );
}

function OptionsEditor({ prop, open, onOpenChange }: { prop: Property; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { m } = useDb();
  const [options, setOptions] = useState(prop.config.options ?? []);
  const [draft, setDraft] = useState("");
  const save = (next: typeof options) => {
    setOptions(next);
    m.updateProperty.mutate({ id: prop.id, config: { ...prop.config, options: next } });
  };
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <span className="sr-only" />
      </PopoverTrigger>
      <PopoverContent className="w-72" align="start">
        <p className="mb-2 text-sm font-medium">Options for {prop.name}</p>
        <div className="max-h-64 space-y-1 overflow-y-auto">
          {options.map((o, i) => (
            <div key={o.id} className="flex items-center gap-1.5">
              <select
                aria-label="Colour"
                value={o.color}
                onChange={(e) => save(options.map((x, idx) => (idx === i ? { ...x, color: e.target.value } : x)))}
                className="size-7 shrink-0 cursor-pointer appearance-none rounded-md border text-transparent"
                style={{ background: colorHex(o.color) }}
              >
                {COLOR_NAMES.map((c) => (
                  <option key={c} value={c} className="text-foreground">
                    {c}
                  </option>
                ))}
              </select>
              <input
                defaultValue={o.name}
                aria-label="Option name"
                maxLength={100}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v && v !== o.name) save(options.map((x, idx) => (idx === i ? { ...x, name: v } : x)));
                }}
                className="h-7 min-w-0 flex-1 rounded-md border bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
              {(prop.type !== "STATUS" || options.length > 1) && (
                <button
                  type="button"
                  aria-label={`Delete ${o.name}`}
                  onClick={() => save(options.filter((_, idx) => idx !== i))}
                  className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent"
                >
                  <X className="size-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
        <form
          className="mt-2 flex gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            if (!draft.trim()) return;
            save([...options, newOption(draft.trim(), options)]);
            setDraft("");
          }}
        >
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="New option"
            className="h-7 min-w-0 flex-1 rounded-md border bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
          <button type="submit" aria-label="Add option" className="flex size-7 items-center justify-center rounded-md border hover:bg-accent">
            <Plus className="size-3.5" />
          </button>
        </form>
      </PopoverContent>
    </Popover>
  );
}
