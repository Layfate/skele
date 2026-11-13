import { describe, expect, it } from "vitest";
import { validateValue, type Property } from "@/features/databases/properties";
import { applyView, groupRecords, parseViewConfig, type RecordLike } from "@/features/databases/query";

const status: Property = {
  id: "status",
  name: "Status",
  type: "STATUS",
  rank: "a0",
  config: {
    options: [
      { id: "todo", name: "Todo", color: "gray" },
      { id: "doing", name: "Doing", color: "blue" },
      { id: "done", name: "Done", color: "green" },
    ],
  },
};
const tags: Property = {
  id: "tags",
  name: "Tags",
  type: "MULTI_SELECT",
  rank: "a1",
  config: { options: [{ id: "x", name: "X", color: "red" }, { id: "y", name: "Y", color: "blue" }] },
};
const points: Property = { id: "points", name: "Points", type: "NUMBER", rank: "a2", config: {} };
const due: Property = { id: "due", name: "Due", type: "DATE", rank: "a3", config: {} };

const rec = (id: string, title: string, values: Record<string, unknown>, rank = id): RecordLike => ({
  id,
  title,
  values,
  rank,
  createdAt: "2026-01-01T00:00:00Z",
});

describe("validateValue", () => {
  it("accepts valid values per type", () => {
    expect(validateValue(status, "doing")).toEqual({ ok: true, value: "doing" });
    expect(validateValue(tags, ["x", "x", "y"])).toEqual({ ok: true, value: ["x", "y"] });
    expect(validateValue(points, 3.5)).toEqual({ ok: true, value: 3.5 });
    expect(validateValue(due, "2026-05-01")).toEqual({ ok: true, value: "2026-05-01" });
    expect(validateValue({ type: "URL", config: {} }, "example.com")).toEqual({ ok: true, value: "https://example.com" });
    expect(validateValue({ type: "CHECKBOX", config: {} }, true)).toEqual({ ok: true, value: true });
  });
  it("treats empty input as clearing the value", () => {
    expect(validateValue(points, null)).toEqual({ ok: true, value: null });
    expect(validateValue(points, "")).toEqual({ ok: true, value: null });
  });
  it("rejects invalid values", () => {
    expect(validateValue(status, "nope").ok).toBe(false);
    expect(validateValue(tags, ["x", "zzz"]).ok).toBe(false);
    expect(validateValue(points, "12").ok).toBe(false);
    expect(validateValue(points, Number.NaN).ok).toBe(false);
    expect(validateValue(due, "tomorrow").ok).toBe(false);
    expect(validateValue({ type: "URL", config: {} }, "javascript:alert(1)").ok).toBe(false);
    expect(validateValue({ type: "EMAIL", config: {} }, "not-an-email").ok).toBe(false);
    expect(validateValue({ type: "PERSON", config: {} }, "u2", new Set(["u1"])).ok).toBe(false);
  });
});

describe("applyView", () => {
  const records = [
    rec("a", "Alpha", { status: "done", points: 5, tags: ["x"] }),
    rec("b", "Beta", { status: "todo", points: 1 }),
    rec("c", "Gamma", { status: "doing", tags: ["x", "y"], due: "2026-03-01" }),
  ];
  const props = [status, tags, points, due];

  it("filters by select, number and multi-select", () => {
    const cfg = (filters: object[]) => parseViewConfig({ filters });
    expect(applyView(records, props, cfg([{ propertyId: "status", op: "is", value: "todo" }])).map((r) => r.id)).toEqual(["b"]);
    expect(applyView(records, props, cfg([{ propertyId: "points", op: "gt", value: 2 }])).map((r) => r.id)).toEqual(["a"]);
    expect(applyView(records, props, cfg([{ propertyId: "tags", op: "contains", value: "y" }])).map((r) => r.id)).toEqual(["c"]);
    expect(applyView(records, props, cfg([{ propertyId: "due", op: "isEmpty" }])).map((r) => r.id)).toEqual(["a", "b"]);
    expect(applyView(records, props, cfg([{ propertyId: "title", op: "contains", value: "MM" }])).map((r) => r.id)).toEqual(["c"]);
  });

  it("ignores filters on deleted properties", () => {
    const cfg = parseViewConfig({ filters: [{ propertyId: "gone", op: "is", value: 1 }] });
    expect(applyView(records, props, cfg)).toHaveLength(3);
  });

  it("sorts by option order and keeps empty values last", () => {
    const bySelect = parseViewConfig({ sorts: [{ propertyId: "status", dir: "asc" }] });
    expect(applyView(records, props, bySelect).map((r) => r.id)).toEqual(["b", "c", "a"]);
    const byPoints = parseViewConfig({ sorts: [{ propertyId: "points", dir: "desc" }] });
    expect(applyView(records, props, byPoints).map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("falls back to an empty config for malformed input", () => {
    expect(parseViewConfig({ filters: "nope" })).toEqual(parseViewConfig({}));
  });
});

describe("groupRecords", () => {
  it("groups by status with a trailing no-value group", () => {
    const groups = groupRecords([rec("a", "A", { status: "done" }), rec("b", "B", {})], status);
    expect(groups.map((g) => [g.key, g.records.length])).toEqual([
      ["todo", 0],
      ["doing", 0],
      ["done", 1],
      ["__none", 1],
    ]);
  });
  it("puts multi-select records in every matching group", () => {
    const groups = groupRecords([rec("a", "A", { tags: ["x", "y"] })], tags);
    expect(groups.filter((g) => g.records.length).map((g) => g.key)).toEqual(["x", "y"]);
  });
});
