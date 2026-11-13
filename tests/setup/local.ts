import { registerWorkspace, workspaceStore } from "@/data/registry";
import { createStarterContent } from "@/data/repo/pages";

/** A fresh, isolated workspace (each has its own IndexedDB database). */
export async function newWorkspace(name = "Test workspace", starter = true) {
  const ws = await registerWorkspace({ name });
  const s = workspaceStore(ws.id);
  if (starter) await createStarterContent(s);
  return { ws, s };
}

export async function expectLocalError(promise: Promise<unknown>, code: string) {
  try {
    await promise;
  } catch (e) {
    if ((e as { code?: string }).code === code) return;
    throw e;
  }
  throw new Error(`Expected ${code} error`);
}
