import { describe, expect, it } from "vitest";
import { autocorrectOptions, correction, DEFAULT_AUTOCORRECT, smartQuote } from "@/lib/autocorrect";

const o = DEFAULT_AUTOCORRECT;
/** The text after typing `trigger`, as the editor would produce it. */
const type = (before: string, trigger: string, opts = o) => {
  const fix = correction(before, trigger, opts);
  return fix ? before.slice(0, before.length - fix.length) + fix.text + trigger : before + trigger;
};

describe("autocorrect", () => {
  it("fixes typos and contractions, keeping capitalisation", () => {
    expect(type("I saw teh", " ")).toBe("I saw the ");
    expect(type("Teh", " ")).toBe("The ");
    expect(type("TEH", ",")).toBe("THE,");
    expect(type("you dont", " ")).toBe("you don't ");
    expect(type("i", " ")).toBe("I ");
    expect(type("so im", " ")).toBe("so I'm ");
    expect(type("i'm", " ")).toBe("I'm ");
    expect(type("recieve", "!")).toBe("receive!");
  });

  it("leaves real words, words inside paths or names, and i.e. alone", () => {
    for (const w of ["its", "were", "ill", "cant", "wont", "lets", "the", "hello"]) expect(correction(w, " ", o)).toBeNull();
    expect(correction("src/teh", " ", o)).toBeNull();
    expect(correction("@teh", " ", o)).toBeNull();
    expect(type("i", ".")).toBe("i.");
    expect(correction("teh", "a", o)).toBeNull();
  });

  it("turns symbols into typographic ones, but not Markdown shortcuts at a line's start", () => {
    expect(type("a ->", " ")).toBe("a → ");
    expect(type("a <->", " ")).toBe("a ↔ ");
    expect(type("wait...", " ")).toBe("wait… ");
    expect(type("x --", " ")).toBe("x — ");
    expect(type("Skele (c)", " ")).toBe("Skele © ");
    expect(correction("---", " ", o)).toBeNull();
    expect(correction("->", " ", o)).toBeNull();
    expect(correction("a ->", " ", { ...o, symbols: false })).toBeNull();
  });

  it("expands the user's own shortcuts first", () => {
    const opts = autocorrectOptions({ replacements: [{ from: "omw", to: "on my way" }, { from: "->", to: "⟶" }] });
    expect(type("brb omw", " ", opts)).toBe("brb on my way ");
    expect(type("a ->", " ", opts)).toBe("a ⟶ ");
    expect(correction("zomw", " ", opts)).toBeNull();
  });

  it("uses curly apostrophes with smart quotes, and curls quotes by position", () => {
    expect(type("dont", " ", { ...o, smartQuotes: true })).toBe("don’t ");
    expect(smartQuote("", '"')).toBe("“");
    expect(smartQuote("say ", '"')).toBe("“");
    expect(smartQuote("hi", '"')).toBe("”");
    expect(smartQuote("it", "'")).toBe("’");
    expect(smartQuote("(", "'")).toBe("‘");
  });

  it("does nothing when turned off, and fills in missing saved options", () => {
    expect(correction("teh", " ", { ...o, enabled: false })).toBeNull();
    expect(autocorrectOptions({ enabled: false })).toEqual({ ...DEFAULT_AUTOCORRECT, enabled: false });
    expect(autocorrectOptions(undefined)).toEqual(DEFAULT_AUTOCORRECT);
  });
});
