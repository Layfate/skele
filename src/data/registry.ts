// Workspace registry + app-wide preferences. Lives in its own database so workspace exports
// never contain preferences or integration tokens.

import { badRequest, newId, notFound, now } from "./common";
import { storageEngine } from "./engine";
import type { WorkspaceStore } from "./store";
import type { WorkspaceMeta } from "./types";

const stores = new Map<string, WorkspaceStore>();
const registryDb = () => storageEngine().registry();

/** The storage engine for a workspace (cached; one connection per workspace). */
export function workspaceStore(id: string): WorkspaceStore {
  let s = stores.get(id);
  if (!s) {
    s = storageEngine().workspace(id);
    stores.set(id, s);
  }
  return s;
}

export async function listWorkspaces(): Promise<WorkspaceMeta[]> {
  const rows = await registryDb().workspaces.all();
  return rows.sort((a, b) => (b.lastOpenedAt ?? b.createdAt).localeCompare(a.lastOpenedAt ?? a.createdAt));
}

export async function getWorkspace(id: string): Promise<WorkspaceMeta> {
  const ws = await registryDb().workspaces.get(id);
  if (!ws) throw notFound("Workspace not found");
  return ws;
}

export async function registerWorkspace(input: { id?: string; name: string; icon?: string | null; color?: string }) {
  const name = input.name.trim();
  if (!name) throw badRequest("Name is required");
  if (name.length > 80) throw badRequest("Name is too long");
  const ws: WorkspaceMeta = {
    id: input.id ?? newId(),
    name,
    icon: input.icon ?? null,
    color: input.color ?? "indigo",
    createdAt: now(),
    updatedAt: now(),
    lastOpenedAt: null,
  };
  if (await registryDb().workspaces.get(ws.id)) throw badRequest("A workspace with this id already exists");
  await registryDb().workspaces.put(ws);
  return ws;
}

export async function updateWorkspace(id: string, patch: Partial<Pick<WorkspaceMeta, "name" | "icon" | "color">>) {
  if (patch.name !== undefined) {
    patch.name = patch.name.trim();
    if (!patch.name) throw badRequest("Name is required");
  }
  const updated = await registryDb().workspaces.update(id, { ...patch, updatedAt: now() });
  if (!updated) throw notFound("Workspace not found");
  return getWorkspace(id);
}

export async function deleteWorkspace(id: string) {
  const store = workspaceStore(id);
  stores.delete(id);
  await store.destroy();
  await registryDb().workspaces.delete(id);
  if ((await getCurrentWorkspaceId()) === id) await registryDb().meta.delete("currentWorkspace");
}

export async function markOpened(id: string) {
  await registryDb().workspaces.update(id, { lastOpenedAt: now() });
  await registryDb().meta.put({ key: "currentWorkspace", value: id });
}

export async function getCurrentWorkspaceId(): Promise<string | null> {
  const row = await registryDb().meta.get("currentWorkspace");
  const id = (row?.value as string | undefined) ?? null;
  if (id && (await registryDb().workspaces.get(id))) return id;
  const [first] = await listWorkspaces();
  return first?.id ?? null;
}

// ── Preferences ────────────────────────────────────────────────────────────────

export type Preferences = {
  /** Optional name for greetings and comment authorship (never leaves the device). */
  displayName: string;
  theme: "light" | "dark" | "system";
  accent: string;
  fontSize: "small" | "default" | "large";
  density: "compact" | "comfortable";
  dashboard: { order?: string[]; hidden?: string[] };
  recentSearches: string[];
  /** Overrides for customisable shortcuts: action id → key combo ("mod+k"). */
  shortcuts: Record<string, string>;
};

export const DEFAULT_PREFERENCES: Preferences = {
  displayName: "",
  theme: "system",
  accent: "indigo",
  fontSize: "default",
  density: "comfortable",
  dashboard: {},
  recentSearches: [],
  shortcuts: {},
};

export async function getPreferences(): Promise<Preferences> {
  const row = await registryDb().meta.get("preferences");
  return { ...DEFAULT_PREFERENCES, ...((row?.value as Partial<Preferences>) ?? {}) };
}

export async function updatePreferences(patch: Partial<Preferences>): Promise<Preferences> {
  const next = { ...(await getPreferences()), ...patch };
  await registryDb().meta.put({ key: "preferences", value: next });
  return next;
}

/** Small key/value storage outside any workspace (integration tokens, flags). */
export const appMeta = {
  get: async <T>(key: string) => (await registryDb().meta.get(key))?.value as T | undefined,
  set: async (key: string, value: unknown) => {
    await registryDb().meta.put({ key, value });
  },
  delete: async (key: string) => {
    await registryDb().meta.delete(key);
  },
};
