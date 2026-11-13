import { describe, expect, it } from "vitest";
import { rankAfter, rankBefore, rankBetween, ranksAfter } from "@/lib/rank";

describe("rank", () => {
  it("orders keys lexicographically", () => {
    const a = rankAfter(null);
    const b = rankAfter(a);
    const mid = rankBetween(a, b);
    expect(a < mid && mid < b).toBe(true);
    expect(rankBefore(a) < a).toBe(true);
  });
  it("generates n increasing keys", () => {
    const keys = ranksAfter(null, 5);
    expect([...keys].sort()).toEqual(keys);
    expect(new Set(keys).size).toBe(5);
  });
  it("tolerates inverted neighbours", () => {
    const a = rankAfter(null);
    const b = rankAfter(a);
    expect(() => rankBetween(b, a)).not.toThrow();
  });
});
