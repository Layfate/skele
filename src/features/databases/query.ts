// Pure filter / sort / group logic for database views (unit-tested; runs on the client).
import { z } from "zod";
import type { Property, PropertyType, RecordValues } from "./properties";

export const filterOps = [
  "contains",
  "notContains",
  "is",
  "isNot",
  "isEmpty",
  "isNotEmpty",
  "gt",
  "lt",
  "gte",
  "lte",
  "before",
  "after",
  "checked",
  "unchecked",
] as const;
export type FilterOp = (typeof filterOps)[number];

export const viewConfigSchema = z.object({
  filters: z
    .array(z.object({ propertyId: z.string().max(64), op: z.enum(filterOps), value: z.unknown().optional() }))
    .max(20)
    .default([]),
  sorts: z.array(z.object({ propertyId: z.string().max(64), dir: z.enum(["asc", "desc"]) })).max(5).default([]),
  groupBy: z.string().max(64).nullish(),
  dateProperty: z.string().max(64).nullish(),
  hidden: z.array(z.string().max(64)).max(200).default([]),
  /** Column widths for the table view. */
  widths: z.record(z.string(), z.number().min(60).max(800)).default({}),
});
export type ViewConfig = z.infer<typeof viewConfigSchema>;
export type Filter = ViewConfig["filters"][number];
export type Sort = ViewConfig["sorts"][number];

export const parseViewConfig = (raw: unknown): ViewConfig => {
  const parsed = viewConfigSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : viewConfigSchema.parse({});
};

export type RecordLike = { id: string; title: string; values: RecordValues; rank: string; createdAt: string };

/** Pseudo-property id for the built-in title column. */
export const TITLE_ID = "title";

export function opsFor(type: PropertyType | "TITLE"): FilterOp[] {
  switch (type) {
    case "TITLE":
    case "TEXT":
    case "URL":
    case "EMAIL":
      return ["contains", "notContains", "is", "isEmpty", "isNotEmpty"];
    case "NUMBER":
      return ["is", "isNot", "gt", "lt", "gte", "lte", "isEmpty", "isNotEmpty"];
    case "SELECT":
    case "STATUS":
    case "PERSON":
      return ["is", "isNot", "isEmpty", "isNotEmpty"];
    case "MULTI_SELECT":
      return ["contains", "notContains", "isEmpty", "isNotEmpty"];
    case "CHECKBOX":
      return ["checked", "unchecked"];
    case "DATE":
      return ["is", "before", "after", "isEmpty", "isNotEmpty"];
  }
}

export const OP_LABEL: Record<FilterOp, string> = {
  contains: "contains",
  notContains: "does not contain",
  is: "is",
  isNot: "is not",
  isEmpty: "is empty",
  isNotEmpty: "is not empty",
  gt: ">",
  lt: "<",
  gte: "≥",
  lte: "≤",
  before: "is before",
  after: "is after",
  checked: "is checked",
  unchecked: "is unchecked",
};

export const opNeedsValue = (op: FilterOp) => !["isEmpty", "isNotEmpty", "checked", "unchecked"].includes(op);

function valueOf(record: RecordLike, propertyId: string): unknown {
  return propertyId === TITLE_ID ? record.title : record.values[propertyId];
}

const isEmpty = (v: unknown) => v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);
const day = (v: unknown) => (typeof v === "string" ? v.slice(0, 10) : "");

export function matchesFilter(record: RecordLike, filter: Filter, prop: Property | "TITLE" | undefined): boolean {
  if (!prop) return true; // filter on a deleted property: ignore
  const type = prop === "TITLE" ? "TITLE" : prop.type;
  const v = valueOf(record, filter.propertyId);
  const target = filter.value;
  switch (filter.op) {
    case "isEmpty":
      return type === "CHECKBOX" ? v !== true : isEmpty(v);
    case "isNotEmpty":
      return !isEmpty(v);
    case "checked":
      return v === true;
    case "unchecked":
      return v !== true;
    case "contains":
    case "notContains": {
      let hit: boolean;
      if (Array.isArray(v)) hit = v.includes(target);
      else hit = String(v ?? "").toLowerCase().includes(String(target ?? "").toLowerCase());
      return filter.op === "contains" ? hit : !hit;
    }
    case "is":
      if (type === "DATE") return day(v) === day(target);
      if (type === "NUMBER") return v === Number(target);
      if (typeof v === "string" && typeof target === "string" && (type === "TEXT" || type === "TITLE" || type === "URL" || type === "EMAIL")) {
        return v.toLowerCase() === target.toLowerCase();
      }
      return v === target;
    case "isNot":
      if (type === "NUMBER") return v !== Number(target);
      return v !== target;
    case "gt":
      return typeof v === "number" && v > Number(target);
    case "lt":
      return typeof v === "number" && v < Number(target);
    case "gte":
      return typeof v === "number" && v >= Number(target);
    case "lte":
      return typeof v === "number" && v <= Number(target);
    case "before":
      return !isEmpty(v) && day(v) < day(target);
    case "after":
      return !isEmpty(v) && day(v) > day(target);
  }
}

function compare(a: unknown, b: unknown, prop: Property | "TITLE" | undefined): number {
  // Empty values always sort last.
  if (isEmpty(a) && isEmpty(b)) return 0;
  if (isEmpty(a)) return 1;
  if (isEmpty(b)) return -1;
  if (prop && prop !== "TITLE" && (prop.type === "SELECT" || prop.type === "STATUS")) {
    const order = (prop.config.options ?? []).map((o) => o.id);
    return order.indexOf(a as string) - order.indexOf(b as string);
  }
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" && typeof b === "boolean") return Number(b) - Number(a);
  if (Array.isArray(a) && Array.isArray(b)) return a.length - b.length;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}

export function applyView<T extends RecordLike>(records: T[], properties: Property[], config: ViewConfig): T[] {
  const byId = new Map(properties.map((p) => [p.id, p]));
  const resolve = (id: string): Property | "TITLE" | undefined => (id === TITLE_ID ? "TITLE" : byId.get(id));
  const filtered = records.filter((r) => config.filters.every((f) => matchesFilter(r, f, resolve(f.propertyId))));
  const sorts = config.sorts.filter((s) => resolve(s.propertyId));
  return [...filtered].sort((a, b) => {
    for (const s of sorts) {
      const prop = resolve(s.propertyId);
      const c = compare(valueOf(a, s.propertyId), valueOf(b, s.propertyId), prop);
      // Keep empties last regardless of direction.
      if (c !== 0) {
        const aEmpty = isEmpty(valueOf(a, s.propertyId));
        const bEmpty = isEmpty(valueOf(b, s.propertyId));
        if (aEmpty !== bEmpty) return c;
        return s.dir === "asc" ? c : -c;
      }
    }
    return a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0;
  });
}

export type Group<T> = { key: string; label: string; color: string | null; records: T[] };

/** Group by a select/status/checkbox/person property. Unset values go to a trailing "No value" group. */
export function groupRecords<T extends RecordLike>(
  records: T[],
  prop: Property | undefined,
  people?: Map<string, string>,
): Group<T>[] {
  if (!prop) return [{ key: "all", label: "All", color: null, records }];
  const groups = new Map<string, Group<T>>();
  if (prop.type === "SELECT" || prop.type === "STATUS" || prop.type === "MULTI_SELECT") {
    for (const o of prop.config.options ?? []) groups.set(o.id, { key: o.id, label: o.name, color: o.color, records: [] });
  } else if (prop.type === "CHECKBOX") {
    groups.set("true", { key: "true", label: "Checked", color: null, records: [] });
    groups.set("false", { key: "false", label: "Unchecked", color: null, records: [] });
  }
  const none: Group<T> = { key: "__none", label: `No ${prop.name.toLowerCase()}`, color: null, records: [] };
  for (const r of records) {
    const v = r.values[prop.id];
    const keys =
      prop.type === "CHECKBOX"
        ? [String(v === true)]
        : Array.isArray(v)
          ? (v as string[])
          : isEmpty(v)
            ? []
            : [String(v)];
    if (!keys.length) none.records.push(r);
    for (const key of keys) {
      if (!groups.has(key)) {
        groups.set(key, { key, label: people?.get(key) ?? key, color: null, records: [] });
      }
      groups.get(key)!.records.push(r);
    }
  }
  const out = [...groups.values()];
  if (prop.type !== "CHECKBOX") out.push(none);
  return out;
}

export const groupableTypes: PropertyType[] = ["SELECT", "STATUS", "MULTI_SELECT", "CHECKBOX", "PERSON"];
