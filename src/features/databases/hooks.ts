"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { errorMessage } from "@/lib/errors";
import { rankBetween } from "@/lib/rank";
import { workspaceStore } from "@/data/registry";
import * as repo from "@/data/repo/databases";
import type {
  CreatePropertyInput,
  CreateRecordInput,
  CreateViewInput,
  MoveRecordInput,
  UpdatePropertyInput,
  UpdateRecordInput,
  UpdateViewInput,
} from "./schemas";
import type { Property } from "./properties";

export type DatabaseData = Awaited<ReturnType<typeof repo.getDatabaseByPage>>;
export type DbRecord = DatabaseData["records"][number];
export type DbView = DatabaseData["views"][number];
export type RecordDetail = Awaited<ReturnType<typeof repo.getRecord>>;

export const dbKeys = {
  byPage: (ws: string, pageId: string) => ["database", ws, pageId] as const,
  record: (ws: string, dbId: string, recordId: string) => ["record", ws, dbId, recordId] as const,
};

export function useDatabase(ws: string, pageId: string) {
  return useQuery({
    queryKey: dbKeys.byPage(ws, pageId),
    queryFn: () => repo.getDatabaseByPage(workspaceStore(ws), pageId),
  });
}

export function useRecord(ws: string, dbId: string, recordId: string | null) {
  return useQuery({
    queryKey: dbKeys.record(ws, dbId, recordId ?? ""),
    queryFn: () => repo.getRecord(workspaceStore(ws), dbId, recordId!),
    enabled: !!recordId,
    refetchOnWindowFocus: false,
  });
}

const sortByRank = <T extends { rank: string }>(list: T[]) =>
  [...list].sort((a, b) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0));

function mergeValues(current: Record<string, unknown>, patch?: Record<string, unknown>) {
  if (!patch) return current;
  const next = { ...current };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === undefined || v === "") delete next[k];
    else next[k] = v;
  }
  return next;
}

/** All database mutations, optimistic against the cached database query. */
export function useDatabaseMutations(ws: string, pageId: string, dbId: string) {
  const qc = useQueryClient();
  const key = dbKeys.byPage(ws, pageId);
  const s = workspaceStore(ws);

  const optimistic = async (fn: (d: DatabaseData) => DatabaseData) => {
    await qc.cancelQueries({ queryKey: key });
    const prev = qc.getQueryData<DatabaseData>(key);
    if (prev) qc.setQueryData<DatabaseData>(key, fn(prev));
    return { prev };
  };
  const rollback = (e: unknown, _v: unknown, ctx?: { prev?: DatabaseData }) => {
    if (ctx?.prev) qc.setQueryData(key, ctx.prev);
    toast.error(errorMessage(e));
  };
  const refresh = () => qc.invalidateQueries({ queryKey: key });

  const createRecordM = useMutation({
    mutationFn: (input: CreateRecordInput) => repo.createRecord(s, dbId, input),
    onSuccess: (record) => {
      qc.setQueryData<DatabaseData>(key, (d) => (d ? { ...d, records: sortByRank([...d.records, record]) } : d));
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const updateRecordM = useMutation({
    mutationFn: ({ id, ...input }: UpdateRecordInput & { id: string }) => repo.updateRecord(s, dbId, id, input),
    onMutate: ({ id, values, ...rest }) =>
      optimistic((d) => ({
        ...d,
        records: d.records.map((r) =>
          r.id === id ? ({ ...r, ...rest, values: mergeValues(r.values, values) } as DbRecord) : r,
        ),
      })),
    onError: rollback,
    onSuccess: (_d, { id }) => qc.invalidateQueries({ queryKey: dbKeys.record(ws, dbId, id) }),
  });

  const moveRecordM = useMutation({
    mutationFn: ({ id, ...input }: MoveRecordInput & { id: string }) => repo.moveRecord(s, dbId, id, input),
    onMutate: ({ id, beforeId, afterId, values }) =>
      optimistic((d) => {
        const rankOf = (rid?: string | null) => d.records.find((r) => r.id === rid)?.rank ?? null;
        const before = rankOf(beforeId);
        const after = rankOf(afterId);
        return {
          ...d,
          records: sortByRank(
            d.records.map((r) =>
              r.id === id
                ? {
                    ...r,
                    rank: before || after ? rankBetween(before, after) : r.rank,
                    values: mergeValues(r.values, values),
                  }
                : r,
            ),
          ),
        };
      }),
    onError: rollback,
  });

  const deleteRecordsM = useMutation({
    mutationFn: (ids: string[]) => repo.deleteRecords(s, dbId, ids),
    onMutate: (ids) => optimistic((d) => ({ ...d, records: d.records.filter((r) => !ids.includes(r.id)) })),
    onError: rollback,
  });

  const createPropertyM = useMutation({
    mutationFn: (input: CreatePropertyInput) => repo.createProperty(s, dbId, input),
    onSuccess: (prop) =>
      qc.setQueryData<DatabaseData>(key, (d) => (d ? { ...d, properties: [...d.properties, prop] } : d)),
    onError: (e) => toast.error(errorMessage(e)),
  });

  const updatePropertyM = useMutation({
    mutationFn: ({ id, ...input }: UpdatePropertyInput & { id: string }) => repo.updateProperty(s, dbId, id, input),
    onMutate: ({ id, name, config, type }) =>
      optimistic((d) => ({
        ...d,
        properties: d.properties.map((p) =>
          p.id === id
            ? { ...p, name: name ?? p.name, type: type ?? p.type, config: (config as Property["config"]) ?? p.config }
            : p,
        ),
      })),
    onError: rollback,
    onSettled: (_d, _e, input) => {
      // Type/option changes can rewrite record values server-side.
      if (input.type || input.config || input.beforeId !== undefined || input.afterId !== undefined) refresh();
    },
  });

  const deletePropertyM = useMutation({
    mutationFn: (id: string) => repo.deleteProperty(s, dbId, id),
    onMutate: (id) =>
      optimistic((d) => ({
        ...d,
        properties: d.properties.filter((p) => p.id !== id),
        records: d.records.map((r) => {
          const values = { ...r.values };
          delete values[id];
          return { ...r, values };
        }),
      })),
    onError: rollback,
  });

  const createViewM = useMutation({
    mutationFn: (input: CreateViewInput) => repo.createView(s, dbId, input),
    onSuccess: (view) => qc.setQueryData<DatabaseData>(key, (d) => (d ? { ...d, views: [...d.views, view] } : d)),
    onError: (e) => toast.error(errorMessage(e)),
  });

  const updateViewM = useMutation({
    mutationFn: ({ id, ...input }: UpdateViewInput & { id: string }) => repo.updateView(s, dbId, id, input),
    onMutate: ({ id, config, ...rest }) =>
      optimistic((d) => ({
        ...d,
        views: d.views.map((v) => (v.id === id ? ({ ...v, ...rest, config: { ...v.config, ...config } } as DbView) : v)),
      })),
    onError: rollback,
  });

  const deleteViewM = useMutation({
    mutationFn: (id: string) => repo.deleteView(s, dbId, id),
    onMutate: (id) => optimistic((d) => ({ ...d, views: d.views.filter((v) => v.id !== id) })),
    onError: rollback,
  });

  return {
    createRecord: createRecordM,
    updateRecord: updateRecordM,
    moveRecord: moveRecordM,
    deleteRecords: deleteRecordsM,
    createProperty: createPropertyM,
    updateProperty: updatePropertyM,
    deleteProperty: deletePropertyM,
    createView: createViewM,
    updateView: updateViewM,
    deleteView: deleteViewM,
  };
}
