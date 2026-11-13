// Behaviour specific to the desktop SQLite adapter (transactions, binary data). The general
// repository suites also run against it (see the "sqlite" project in vitest.config.mts).
import { describe, expect, it } from "vitest";
import { SqliteWorkspaceStore } from "@/data/adapters/sqlite";
import type { FileRow, Task } from "@/data/types";
import { createSqliteBackend } from "../setup/sqlite-backend";

function setup() {
  const backend = createSqliteBackend();
  const s = new SqliteWorkspaceStore(backend.invoke, "w1");
  return { backend, s };
}

const task = (id: string, projectId: string | null = null) =>
  ({ id, projectId, parentId: null, title: id, status: "NOT_STARTED", rank: "a" }) as unknown as Task;

const file = (id: string, text: string): FileRow => ({
  id,
  name: `${id}.txt`,
  mimeType: "text/plain",
  size: text.length,
  pageId: "p1",
  blob: new Blob([text], { type: "text/plain" }),
  createdAt: new Date().toISOString(),
});

describe("SQLite adapter", () => {
  it("commits a transaction atomically and rolls back on error", async () => {
    const { s } = setup();
    await s.transaction(async () => {
      await s.t("tasks").put(task("a", "p"));
      // Reads inside the transaction see its own pending writes.
      expect((await s.t("tasks").get("a"))?.title).toBe("a");
      expect(await s.t("tasks").where("projectId", "p")).toHaveLength(1);
      expect(await s.t("tasks").count()).toBe(1);
    });
    await expect(
      s.transaction(async () => {
        await s.t("tasks").put(task("b"));
        await s.t("tasks").delete("a");
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect((await s.t("tasks").all()).map((t) => t.id)).toEqual(["a"]);
  });

  it("joins nested transactions and orders rows by key", async () => {
    const { s } = setup();
    await s.transaction(async () => {
      await s.t("tasks").bulkPut([task("c"), task("a")]);
      await s.transaction(async () => {
        await s.t("tasks").put(task("b"));
      });
      expect((await s.t("tasks").all()).map((t) => t.id)).toEqual(["a", "b", "c"]);
    });
    expect((await s.t("tasks").all()).map((t) => t.id)).toEqual(["a", "b", "c"]);
  });

  it("update merges and reports missing rows", async () => {
    const { s } = setup();
    await s.t("tasks").put(task("a", "p1"));
    expect(await s.t("tasks").update("a", { projectId: "p2" })).toBe(true);
    expect(await s.t("tasks").update("zzz", { projectId: "p2" })).toBe(false);
    expect(await s.t("tasks").where("projectId", "p1")).toHaveLength(0);
    expect((await s.t("tasks").where("projectId", "p2"))[0].title).toBe("a");
  });

  it("stores attachment bytes outside the JSON rows", async () => {
    const { s, backend } = setup();
    await s.t("files").put(file("f1", "hello"));
    expect(backend.blobCount("ws:w1")).toBe(1);
    const row = await s.t("files").get("f1");
    expect(await row!.blob.text()).toBe("hello");
    expect(row!.blob.type).toBe("text/plain");
    const listed = await s.t("files").all({ skipBlobs: true });
    expect(listed[0].name).toBe("f1.txt");
    expect(listed[0].blob).toBeUndefined();

    // Clear, then re-add in one transaction: the new bytes survive the clear.
    await s.transaction(async () => {
      await s.t("files").clear();
      await s.t("files").put(file("f2", "world"));
    });
    expect(backend.blobCount("ws:w1")).toBe(1);
    expect(await (await s.t("files").get("f2"))!.blob.text()).toBe("world");
    await s.t("files").delete("f2");
    expect(backend.blobCount("ws:w1")).toBe(0);
  });

  it("rejects unindexed lookups and works after destroy only with a new store", async () => {
    const { s, backend } = setup();
    await expect(s.t("tasks").where("title", "x")).rejects.toThrow("not indexed");
    await s.t("tasks").put(task("a"));
    await s.destroy();
    expect(backend.isOpen("ws:w1")).toBe(false);
    await expect(s.t("tasks").all()).rejects.toThrow("deleted");
    const again = new SqliteWorkspaceStore(backend.invoke, "w1");
    expect(await again.t("tasks").count()).toBe(0);
  });
});
