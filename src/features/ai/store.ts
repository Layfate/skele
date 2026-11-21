// Chats and AI settings live in the app registry (appMeta), outside any workspace database,
// so workspace exports and backups never contain them or the API keys. Each chat is one row
// ("ai:chat:<id>"); each workspace has a small index row for the chat list.

import { appMeta } from "@/data/registry";
import { newId, notFound, now } from "@/data/common";
import { DEFAULT_AI_SETTINGS, type AiSettings, type Chat, type ChatSummary, type Effort, type ProviderId } from "./types";

const chatKey = (id: string) => `ai:chat:${id}`;
const indexKey = (workspaceId: string) => `ai:chats:${workspaceId}`;
const SETTINGS_KEY = "ai:settings";

// Writes are serialised so concurrent saves (streaming reply + rename) never interleave.
let queue: Promise<unknown> = Promise.resolve();
export function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

export function summarize(chat: Chat): ChatSummary {
  const last = [...chat.messages].reverse().find((m) => m.content.trim());
  return {
    id: chat.id,
    title: chat.title,
    provider: chat.provider,
    pinned: chat.pinned,
    createdAt: chat.createdAt,
    updatedAt: chat.updatedAt,
    preview: (last?.content ?? "").replace(/\s+/g, " ").slice(0, 140),
  };
}

export async function listChats(workspaceId: string): Promise<ChatSummary[]> {
  const list = (await appMeta.get<ChatSummary[]>(indexKey(workspaceId))) ?? [];
  return [...list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getChat(id: string): Promise<Chat> {
  const chat = await appMeta.get<Chat>(chatKey(id));
  if (!chat) throw notFound("Chat not found");
  return chat;
}

async function writeChat(chat: Chat) {
  await appMeta.set(chatKey(chat.id), chat);
  const list = (await appMeta.get<ChatSummary[]>(indexKey(chat.workspaceId))) ?? [];
  await appMeta.set(indexKey(chat.workspaceId), [summarize(chat), ...list.filter((c) => c.id !== chat.id)]);
}

export type NewChat = { workspaceId: string; provider: ProviderId; model: string; effort?: Effort } & Partial<
  Pick<Chat, "mode" | "folder" | "shell" | "web" | "mcp" | "agentId">
>;

export function createChat(input: NewChat): Promise<Chat> {
  return serial(async () => {
    const { effort, ...rest } = input;
    const chat: Chat = {
      ...rest,
      id: newId(),
      title: "New chat",
      effort: effort ?? "medium",
      createdAt: now(),
      updatedAt: now(),
      messages: [],
    };
    await writeChat(chat);
    return chat;
  });
}

/** Read-modify-write of one chat. `touch` moves it to the top of the list. */
export function updateChat(id: string, fn: (chat: Chat) => Chat, touch = true): Promise<Chat> {
  return serial(async () => {
    const next = fn(await getChat(id));
    if (touch) next.updatedAt = now();
    await writeChat(next);
    return next;
  });
}

export function deleteChat(workspaceId: string, id: string): Promise<void> {
  return serial(async () => {
    await appMeta.delete(chatKey(id));
    const list = (await appMeta.get<ChatSummary[]>(indexKey(workspaceId))) ?? [];
    await appMeta.set(
      indexKey(workspaceId),
      list.filter((c) => c.id !== id),
    );
  });
}

/** Claude Code's latest plan-limit reading, saved whenever a reply carries one. */
export type SavedRateLimit = { info: Record<string, unknown>; at: string };
export const getClaudeUsage = () => appMeta.get<SavedRateLimit>("ai:usage:claude");
export const saveClaudeUsage = (info: Record<string, unknown>) => appMeta.set("ai:usage:claude", { info, at: now() } satisfies SavedRateLimit);

export async function getAiSettings(): Promise<AiSettings> {
  return { ...DEFAULT_AI_SETTINGS, ...((await appMeta.get<Partial<AiSettings>>(SETTINGS_KEY)) ?? {}) };
}

export function updateAiSettings(patch: Partial<AiSettings>): Promise<AiSettings> {
  return serial(async () => {
    const next = { ...(await getAiSettings()), ...patch };
    await appMeta.set(SETTINGS_KEY, next);
    return next;
  });
}
