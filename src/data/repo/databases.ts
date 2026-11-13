import { extractText, sanitizeDoc } from "@/features/editor/doc";
import {
  defaultConfig,
  defaultStatusOptions,
  parseConfig,
  validateValue,
  type Property,
  type PropertyType,
} from "@/features/databases/properties";
import { parseViewConfig, type ViewConfig } from "@/features/databases/query";
import { rankAfter, rankBefore, rankBetween, ranksAfter } from "@/lib/rank";
import { badRequest, byRank, conflict, newId, notFound, now } from "../common";
import type { WorkspaceStore } from "../store";
import type { DbProperty, DbRecordRow, DbViewRow, DbViewType } from "../types";

const MAX_RECORDS = 10_000;
const EMPTY_DOC = { type: "doc", content: [] };

/** Creates the database behind a DATABASE page with a sensible starter schema. */
export async function createDatabaseForPage(s: WorkspaceStore, pageId: string) {
  const database = { id: newId(), pageId, createdAt: now() };
  await s.t("databases").put(database);
  const [r1, r2, r3] = ranksAfter(null, 3);
  const status: DbProperty = {
    id: newId(),
    databaseId: database.id,
    name: "Status",
    type: "STATUS",
    rank: r1,
    config: { options: defaultStatusOptions() },
  };
  await s.t("properties").bulkPut([
    status,
    { id: newId(), databaseId: database.id, name: "Tags", type: "MULTI_SELECT", rank: r2, config: { options: [] } },
    { id: newId(), databaseId: database.id, name: "Date", type: "DATE", rank: r3, config: {} },
  ]);
  const [v1, v2] = ranksAfter(null, 2);
  await s.t("views").bulkPut([
    { id: newId(), databaseId: database.id, name: "Table", type: "TABLE", rank: v1, config: parseViewConfig({}) },
    { id: newId(), databaseId: database.id, name: "Board", type: "BOARD", rank: v2, config: parseViewConfig({ groupBy: status.id }) },
  ]);
  await s.t("records").bulkPut(
    ranksAfter(null, 3).map((rank, i) => newRecord(database.id, rank, { values: i === 0 ? { [status.id]: "todo" } : {} })),
  );
  return database;
}

function newRecord(databaseId: string, rank: string, init: Partial<DbRecordRow> = {}): DbRecordRow {
  return {
    id: newId(),
    databaseId,
    title: "",
    icon: null,
    values: {},
    doc: EMPTY_DOC,
    text: "",
    version: 0,
    rank,
    createdAt: now(),
    updatedAt: now(),
    ...init,
  };
}

/** Copies a database's schema, views and records to another page (used by duplicate). */
export async function copyDatabase(s: WorkspaceStore, databaseId: string, toPageId: string) {
  const [props, views, records] = await Promise.all([
    s.t("properties").where("databaseId", databaseId),
    s.t("views").where("databaseId", databaseId),
    s.t("records").where("databaseId", databaseId),
  ]);
  const database = { id: newId(), pageId: toPageId, createdAt: now() };
  await s.t("databases").put(database);
  const propIds = new Map(props.map((p) => [p.id, newId()]));
  const remap = <T>(obj: T): T =>
    JSON.parse([...propIds].reduce((json, [from, to]) => json.split(from).join(to), JSON.stringify(obj ?? {})));
  await s.t("properties").bulkPut(props.map((p) => ({ ...p, id: propIds.get(p.id)!, databaseId: database.id })));
  await s.t("views").bulkPut(views.map((v) => ({ ...v, id: newId(), databaseId: database.id, config: remap(v.config) })));
  await s.t("records").bulkPut(
    records.map((r) => ({ ...r, id: newId(), databaseId: database.id, values: remap(r.values), version: 0, createdAt: now(), updatedAt: now() })),
  );
}

async function findDatabase(s: WorkspaceStore, databaseId: string, write: boolean) {
  const database = await s.t("databases").get(databaseId);
  if (!database) throw notFound("Database not found");
  if (write) {
    const page = await s.t("pages").get(database.pageId);
    if (page?.archivedAt) throw badRequest("Restore the page before editing it");
  }
  return database;
}

const toView = (v: DbViewRow) => ({ ...v, config: parseViewConfig(v.config) });

export async function getDatabaseByPage(s: WorkspaceStore, pageId: string) {
  const [database] = await s.t("databases").where("pageId", pageId);
  if (!database) throw notFound("Database not found");
  const [properties, views, records] = await Promise.all([
    s.t("properties").where("databaseId", database.id),
    s.t("views").where("databaseId", database.id),
    s.t("records").where("databaseId", database.id),
  ]);
  return {
    id: database.id,
    pageId,
    properties: properties.sort(byRank) as Property[],
    views: views.sort(byRank).map(toView),
    // The list view doesn't need record bodies.
    records: records.sort(byRank).map(({ doc: _doc, text: _text, ...r }) => r),
    truncated: false,
    canEdit: true,
  };
}

/** Validates a partial values object against the database's properties. */
async function validateValues(s: WorkspaceStore, databaseId: string, values: Record<string, unknown>) {
  const props = await s.t("properties").where("databaseId", databaseId);
  const byId = new Map(props.map((p) => [p.id, p]));
  const out: Record<string, unknown> = {};
  const errors: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    const prop = byId.get(key);
    if (!prop) {
      errors[key] = "Unknown property";
      continue;
    }
    const result = validateValue(prop, value);
    if (result.ok) out[key] = result.value;
    else errors[key] = result.error;
  }
  if (Object.keys(errors).length) throw badRequest("Some values are invalid", errors);
  return out;
}

function merge(current: Record<string, unknown>, patch: Record<string, unknown>) {
  const next = { ...current };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || (Array.isArray(v) && v.length === 0)) delete next[k];
    else next[k] = v;
  }
  return next;
}

// ───────────── Properties ─────────────

export async function createProperty(s: WorkspaceStore, databaseId: string, input: { name: string; type: PropertyType; config?: unknown }) {
  return s.transaction(async () => {
    await findDatabase(s, databaseId, true);
    const props = await s.t("properties").where("databaseId", databaseId);
    if (props.length >= 100) throw badRequest("A database can have at most 100 properties");
    let config;
    try {
      config = parseConfig(input.type, input.config ?? defaultConfig(input.type));
    } catch {
      throw badRequest("Invalid property configuration");
    }
    const prop: DbProperty = {
      id: newId(),
      databaseId,
      name: input.name.trim().slice(0, 100) || "Property",
      type: input.type,
      config,
      rank: rankAfter(props.sort(byRank).at(-1)?.rank),
    };
    await s.t("properties").put(prop);
    return prop as Property;
  });
}

export async function updateProperty(
  s: WorkspaceStore,
  databaseId: string,
  propertyId: string,
  input: { name?: string; type?: PropertyType; config?: unknown; beforeId?: string | null; afterId?: string | null },
) {
  return s.transaction(async () => {
    await findDatabase(s, databaseId, true);
    const prop = await s.t("properties").get(propertyId);
    if (!prop || prop.databaseId !== databaseId) throw notFound("Property not found");
    const type = input.type ?? prop.type;
    const typeChanged = type !== prop.type;
    let config = prop.config;
    if (input.config !== undefined || typeChanged) {
      try {
        config = parseConfig(type, input.config ?? (typeChanged ? defaultConfig(type) : prop.config));
      } catch {
        throw badRequest("Invalid property configuration");
      }
    }
    let rank = prop.rank;
    if (input.beforeId !== undefined || input.afterId !== undefined) {
      const near = async (id?: string | null) => (id ? ((await s.t("properties").get(id))?.rank ?? null) : null);
      rank = rankBetween(await near(input.beforeId), await near(input.afterId));
    }
    const updated: DbProperty = { ...prop, name: input.name?.trim().slice(0, 100) || prop.name, type, config, rank };
    await s.t("properties").put(updated);

    const records = await s.t("records").where("databaseId", databaseId);
    const changed: DbRecordRow[] = [];
    if (typeChanged) {
      // Values of the old type don't carry over safely; clear them.
      for (const r of records) {
        if (propertyId in r.values) {
          const values = { ...r.values };
          delete values[propertyId];
          changed.push({ ...r, values });
        }
      }
    } else if (input.config !== undefined && (type === "SELECT" || type === "STATUS" || type === "MULTI_SELECT")) {
      // Drop references to options that were removed.
      const kept = new Set((config.options ?? []).map((o) => o.id));
      for (const r of records) {
        const v = r.values[propertyId];
        if (v === undefined) continue;
        const values = { ...r.values };
        if (Array.isArray(v)) {
          const next = v.filter((x) => kept.has(x as string));
          if (next.length === v.length) continue;
          if (next.length) values[propertyId] = next;
          else delete values[propertyId];
        } else if (!kept.has(v as string)) delete values[propertyId];
        else continue;
        changed.push({ ...r, values });
      }
    }
    await s.t("records").bulkPut(changed);
    return updated as Property;
  });
}

export async function deleteProperty(s: WorkspaceStore, databaseId: string, propertyId: string) {
  await s.transaction(async () => {
    await findDatabase(s, databaseId, true);
    const prop = await s.t("properties").get(propertyId);
    if (!prop || prop.databaseId !== databaseId) throw notFound("Property not found");
    await s.t("properties").delete(propertyId);
    const records = await s.t("records").where("databaseId", databaseId);
    await s.t("records").bulkPut(
      records
        .filter((r) => propertyId in r.values)
        .map((r) => {
          const values = { ...r.values };
          delete values[propertyId];
          return { ...r, values };
        }),
    );
  });
}

// ───────────── Records ─────────────

const listRecord = ({ doc: _doc, text: _text, ...r }: DbRecordRow) => r;

export async function createRecord(
  s: WorkspaceStore,
  databaseId: string,
  input: { title?: string; values?: Record<string, unknown>; afterId?: string | null; atStart?: boolean },
) {
  return s.transaction(async () => {
    await findDatabase(s, databaseId, true);
    const values = input.values ? merge({}, await validateValues(s, databaseId, input.values)) : {};
    const records = (await s.t("records").where("databaseId", databaseId)).sort(byRank);
    if (records.length >= MAX_RECORDS) throw badRequest(`A database can hold at most ${MAX_RECORDS} records`);
    let rank: string;
    if (input.afterId) {
      const i = records.findIndex((r) => r.id === input.afterId);
      rank = rankBetween(records[i]?.rank, records[i + 1]?.rank);
    } else if (input.atStart) rank = rankBefore(records[0]?.rank);
    else rank = rankAfter(records.at(-1)?.rank);
    const record = newRecord(databaseId, rank, { title: (input.title ?? "").slice(0, 500), values });
    await s.t("records").put(record);
    return listRecord(record);
  });
}

async function findRecord(s: WorkspaceStore, databaseId: string, recordId: string) {
  const record = await s.t("records").get(recordId);
  if (!record || record.databaseId !== databaseId) throw notFound("Record not found");
  return record;
}

export async function updateRecord(
  s: WorkspaceStore,
  databaseId: string,
  recordId: string,
  input: { title?: string; icon?: string | null; values?: Record<string, unknown> },
) {
  return s.transaction(async () => {
    await findDatabase(s, databaseId, true);
    const record = await findRecord(s, databaseId, recordId);
    const patch = input.values ? await validateValues(s, databaseId, input.values) : null;
    const updated: DbRecordRow = {
      ...record,
      title: input.title !== undefined ? input.title.slice(0, 500) : record.title,
      icon: input.icon !== undefined ? input.icon : record.icon,
      values: patch ? merge(record.values, patch) : record.values,
      updatedAt: now(),
    };
    await s.t("records").put(updated);
    return listRecord(updated);
  });
}

export async function moveRecord(
  s: WorkspaceStore,
  databaseId: string,
  recordId: string,
  input: { beforeId?: string | null; afterId?: string | null; values?: Record<string, unknown> },
) {
  return s.transaction(async () => {
    await findDatabase(s, databaseId, true);
    const record = await findRecord(s, databaseId, recordId);
    const patch = input.values ? await validateValues(s, databaseId, input.values) : null;
    const near = async (id?: string | null) =>
      id && id !== recordId ? ((await s.t("records").get(id))?.rank ?? null) : null;
    const [before, after] = await Promise.all([near(input.beforeId), near(input.afterId)]);
    const updated: DbRecordRow = {
      ...record,
      rank: before || after ? rankBetween(before, after) : record.rank,
      values: patch ? merge(record.values, patch) : record.values,
      updatedAt: now(),
    };
    await s.t("records").put(updated);
    return listRecord(updated);
  });
}

export async function deleteRecords(s: WorkspaceStore, databaseId: string, ids: string[]) {
  return s.transaction(async () => {
    await findDatabase(s, databaseId, true);
    const rows = (await s.t("records").bulkGet(ids)).filter((r): r is DbRecordRow => !!r && r.databaseId === databaseId);
    await s.t("records").bulkDelete(rows.map((r) => r.id));
    return { count: rows.length };
  });
}

export async function getRecord(s: WorkspaceStore, databaseId: string, recordId: string) {
  const database = await findDatabase(s, databaseId, false);
  const record = await findRecord(s, databaseId, recordId);
  const page = await s.t("pages").get(database.pageId);
  return { ...record, canEdit: !page?.archivedAt };
}

export async function saveRecordContent(
  s: WorkspaceStore,
  databaseId: string,
  recordId: string,
  input: { doc: unknown; version: number },
) {
  const doc = sanitizeDoc(input.doc);
  return s.transaction(async () => {
    await findDatabase(s, databaseId, true);
    const record = await findRecord(s, databaseId, recordId);
    if (record.version !== input.version) throw conflict("This record was changed somewhere else", { version: record.version });
    await s.t("records").put({ ...record, doc, text: extractText(doc), version: record.version + 1, updatedAt: now() });
    return { version: record.version + 1 };
  });
}

// ───────────── Views ─────────────

export async function createView(
  s: WorkspaceStore,
  databaseId: string,
  input: { name: string; type: DbViewType; config?: Partial<ViewConfig> },
) {
  return s.transaction(async () => {
    await findDatabase(s, databaseId, true);
    const views = (await s.t("views").where("databaseId", databaseId)).sort(byRank);
    if (views.length >= 30) throw badRequest("A database can have at most 30 views");
    const view: DbViewRow = {
      id: newId(),
      databaseId,
      name: input.name.trim().slice(0, 60) || "View",
      type: input.type,
      config: parseViewConfig(input.config ?? {}),
      rank: rankAfter(views.at(-1)?.rank),
    };
    await s.t("views").put(view);
    return toView(view);
  });
}

export async function updateView(
  s: WorkspaceStore,
  databaseId: string,
  viewId: string,
  input: { name?: string; type?: DbViewType; config?: Partial<ViewConfig> },
) {
  return s.transaction(async () => {
    const view = await s.t("views").get(viewId);
    if (!view || view.databaseId !== databaseId) throw notFound("View not found");
    const updated: DbViewRow = {
      ...view,
      name: input.name?.trim().slice(0, 60) || view.name,
      type: input.type ?? view.type,
      config: input.config ? parseViewConfig({ ...parseViewConfig(view.config), ...input.config }) : view.config,
    };
    await s.t("views").put(updated);
    return toView(updated);
  });
}

export async function deleteView(s: WorkspaceStore, databaseId: string, viewId: string) {
  await s.transaction(async () => {
    const views = await s.t("views").where("databaseId", databaseId);
    if (!views.some((v) => v.id === viewId)) throw notFound("View not found");
    if (views.length <= 1) throw badRequest("A database needs at least one view");
    await s.t("views").delete(viewId);
  });
}

/** All database pages in the workspace (for the Databases screen). */
export async function listDatabases(s: WorkspaceStore) {
  const [databases, pages, records] = await Promise.all([s.t("databases").all(), s.t("pages").all(), s.t("records").all()]);
  const byPage = new Map(pages.map((p) => [p.id, p]));
  const counts = new Map<string, number>();
  for (const r of records) counts.set(r.databaseId, (counts.get(r.databaseId) ?? 0) + 1);
  return databases
    .map((d) => ({ ...d, page: byPage.get(d.pageId)!, recordCount: counts.get(d.id) ?? 0 }))
    .filter((d) => d.page && !d.page.archivedAt)
    .sort((a, b) => b.page.updatedAt.localeCompare(a.page.updatedAt));
}
