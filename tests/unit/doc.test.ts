import { describe, expect, it } from "vitest";
import { extractText, isSafeUrl, sanitizeDoc } from "@/features/editor/doc";

describe("isSafeUrl", () => {
  it("accepts http(s), mailto and app paths", () => {
    expect(isSafeUrl("https://example.com")).toBe(true);
    expect(isSafeUrl("mailto:a@b.c")).toBe(true);
    expect(isSafeUrl("/api/files/abc")).toBe(true);
  });
  it("rejects scripts and protocol-relative URLs", () => {
    expect(isSafeUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeUrl(" JaVaScRiPt:alert(1)")).toBe(false);
    expect(isSafeUrl("data:text/html,hi")).toBe(false);
    expect(isSafeUrl("//evil.com")).toBe(false);
  });
});

describe("sanitizeDoc", () => {
  it("strips unsafe link marks and image sources", () => {
    const doc = sanitizeDoc({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "x", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] }],
        },
        { type: "image", attrs: { src: "javascript:alert(1)" } },
      ],
    });
    expect(doc.content?.[0].content?.[0].marks).toBeUndefined();
    expect(doc.content?.[1].attrs?.src).toBeNull();
  });
  it("falls back to an empty doc for malformed input", () => {
    expect(sanitizeDoc("nope")).toEqual({ type: "doc", content: [] });
    expect(sanitizeDoc({ type: "paragraph" })).toEqual({ type: "doc", content: [] });
  });
  it("drops non-object children", () => {
    const doc = sanitizeDoc({ type: "doc", content: [null, 5, { type: "paragraph" }] });
    expect(doc.content).toEqual([{ type: "paragraph" }]);
  });
});

describe("extractText", () => {
  it("joins block text with newlines", () => {
    const text = extractText({
      type: "doc",
      content: [
        { type: "heading", content: [{ type: "text", text: "Title" }] },
        { type: "paragraph", content: [{ type: "text", text: "Hello " }, { type: "text", text: "world" }] },
      ],
    });
    expect(text).toBe("Title\nHello world");
  });
});

describe("sanitizeDoc colours", () => {
  it("keeps allow-listed colours and drops arbitrary CSS", () => {
    const doc = sanitizeDoc({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "a", marks: [{ type: "textStyle", attrs: { color: "var(--tc-red)" } }] },
            { type: "text", text: "b", marks: [{ type: "highlight", attrs: { color: "red; background:url(//x)" } }] },
          ],
        },
      ],
    });
    const [a, b] = doc.content![0].content!;
    expect(a.marks?.[0].attrs?.color).toBe("var(--tc-red)");
    expect(b.marks?.[0].attrs?.color).toBeNull();
  });
});
