import { describe, expect, it } from "vitest";
import { groupTasks, sortTasks, type TaskLike } from "@/features/projects/task-view-logic";
import { progress } from "@/features/projects/schemas";
import { canChangeRole, can } from "@/features/workspaces/permissions";

const t = (id: string, patch: Partial<TaskLike> = {}): TaskLike => ({
  id,
  title: id,
  status: "NOT_STARTED",
  priority: "MEDIUM",
  dueDate: null,
  rank: id,
  createdAt: "2026-01-01T00:00:00Z",
  assignee: null,
  ...patch,
});

describe("task views", () => {
  it("sorts by due date with undated tasks last", () => {
    const list = [t("a"), t("b", { dueDate: "2026-02-01" }), t("c", { dueDate: "2026-01-15" })];
    expect(sortTasks(list, "due").map((x) => x.id)).toEqual(["c", "b", "a"]);
  });
  it("sorts by priority (urgent first)", () => {
    const list = [t("a", { priority: "LOW" }), t("b", { priority: "URGENT" }), t("c", { priority: "HIGH" })];
    expect(sortTasks(list, "priority").map((x) => x.id)).toEqual(["b", "c", "a"]);
  });
  it("groups by status in workflow order", () => {
    const groups = groupTasks([t("a", { status: "COMPLETED" }), t("b")], "status");
    expect(groups.map((g) => g.key)).toEqual(["NOT_STARTED", "IN_PROGRESS", "ON_HOLD", "COMPLETED", "CANCELLED"]);
    expect(groups[0].tasks.map((x) => x.id)).toEqual(["b"]);
  });
  it("groups by assignee with unassigned last", () => {
    const groups = groupTasks([t("a"), t("b", { assignee: "Uma" })], "assignee");
    expect(groups.map((g) => g.label)).toEqual(["Uma", "Unassigned"]);
  });
});

describe("progress", () => {
  it("excludes cancelled tasks from the denominator", () => {
    expect(progress({ total: 4, completed: 1, cancelled: 2 })).toBe(0.5);
    expect(progress({ total: 0, completed: 0, cancelled: 0 })).toBeNull();
    expect(progress({ total: 1, completed: 0, cancelled: 1 })).toBeNull();
  });
});

describe("permissions", () => {
  it("matches the role matrix", () => {
    expect(can.edit("GUEST")).toBe(false);
    expect(can.edit("MEMBER")).toBe(true);
    expect(can.purge("MEMBER")).toBe(false);
    expect(can.manageMembers("ADMIN")).toBe(true);
    expect(can.deleteWorkspace("ADMIN")).toBe(false);
  });
  it("prevents admins from touching owners", () => {
    expect(canChangeRole("ADMIN", "OWNER", "MEMBER")).toBe(false);
    expect(canChangeRole("ADMIN", "MEMBER", "OWNER")).toBe(false);
    expect(canChangeRole("ADMIN", "MEMBER", "GUEST")).toBe(true);
    expect(canChangeRole("OWNER", "ADMIN", "OWNER")).toBe(true);
    expect(canChangeRole("MEMBER", "GUEST", "MEMBER")).toBe(false);
  });
});
