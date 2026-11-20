// Emails as text: HTML bodies to Markdown (for pages and the AI), reply quoting, and the
// sandboxed document the mail view shows HTML email in.

import { gmailUrl, parseAddress, type Mail } from "./api";

const BLOCK = new Set(["p", "div", "section", "article", "header", "footer", "table", "tr", "center", "main", "aside", "form"]);
const SKIP = new Set(["script", "style", "head", "title", "meta", "link", "noscript", "template", "svg", "button", "input", "select", "textarea", "iframe", "object"]);

/**
 * HTML email to Markdown: paragraphs, headings, links, lists, emphasis, quotes and line
 * breaks. Layout tables collapse to their text; tracking pixels and images are dropped.
 */
export function htmlToMarkdown(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const out = walk(doc.body ?? doc.documentElement, { list: [] });
  return out
    .replace(/[ \t ]+\n/g, "\n")
    .replace(/\n[ \t ]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

type Ctx = { list: ("ul" | "ol")[]; pre?: boolean };

function walk(node: Node, ctx: Ctx): string {
  let s = "";
  node.childNodes.forEach((child) => {
    s += convert(child, ctx);
  });
  return s;
}

const inline = (s: string) => s.replace(/\s+/g, " ").trim();

/** "<b> Ada </b>" → " **Ada** ": Markdown markers must hug the text, so spaces move outside. */
function emphasis(text: string, mark: string) {
  const m = text.match(/^(\s*)([\s\S]*?)(\s*)$/)!;
  return m[2] ? `${m[1]}${mark}${m[2]}${mark}${m[3]}` : text;
}

function convert(node: Node, ctx: Ctx): string {
  if (node.nodeType === Node.TEXT_NODE) {
    const t = node.textContent ?? "";
    return ctx.pre ? t : t.replace(/\s+/g, " ");
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return "";
  const el = node as Element;
  const tag = el.tagName.toLowerCase();
  if (SKIP.has(tag)) return "";
  if ((el as HTMLElement).style?.display === "none") return "";
  switch (tag) {
    case "br":
      return "  \n";
    case "hr":
      return "\n\n---\n\n";
    case "h1":
    case "h2":
    case "h3":
    case "h4":
    case "h5":
    case "h6": {
      const text = inline(walk(el, ctx));
      return text ? `\n\n${"#".repeat(Math.min(Number(tag[1]) + 1, 6))} ${text}\n\n` : "";
    }
    case "strong":
    case "b":
      return emphasis(walk(el, ctx), "**");
    case "em":
    case "i":
      return emphasis(walk(el, ctx), "*");
    case "a": {
      const href = el.getAttribute("href") ?? "";
      const text = inline(walk(el, ctx));
      if (!text) return "";
      if (!/^(https?:|mailto:)/i.test(href) || text === href) return text;
      return `[${text.replace(/[[\]]/g, "")}](${href.replace(/\)/g, "%29").replace(/\s/g, "%20")})`;
    }
    case "img":
      return "";
    case "ul":
    case "ol":
      return `\n\n${walk(el, { ...ctx, list: [...ctx.list, tag] })}\n\n`;
    case "li": {
      const kind = ctx.list.at(-1) ?? "ul";
      const index = kind === "ol" ? [...(el.parentElement?.children ?? [])].filter((c) => c.tagName.toLowerCase() === "li").indexOf(el) + 1 : 0;
      const indent = "  ".repeat(Math.max(0, ctx.list.length - 1));
      const body = walk(el, ctx).trim().replace(/\n+/g, `\n${indent}  `);
      return `${indent}${kind === "ol" ? `${index}.` : "-"} ${body}\n`;
    }
    case "blockquote": {
      const body = walk(el, ctx).trim();
      return body ? `\n\n${body.split("\n").map((l) => `> ${l}`).join("\n")}\n\n` : "";
    }
    case "pre":
      return `\n\n\`\`\`\n${walk(el, { ...ctx, pre: true }).replace(/\n+$/, "")}\n\`\`\`\n\n`;
    case "td":
    case "th":
      return `${walk(el, ctx)} `;
    default: {
      const body = walk(el, ctx);
      return BLOCK.has(tag) ? `\n\n${body}\n\n` : body;
    }
  }
}

/** The readable body of a message as Markdown-ish text: the plain part, else the HTML converted. */
export function mailBody(m: Pick<Mail, "text" | "html" | "snippet">): string {
  if (m.text.trim()) return m.text.replace(/\r\n/g, "\n").trim();
  if (m.html.trim()) return htmlToMarkdown(m.html);
  return m.snippet;
}

export function formatDate(ms: number, now = new Date()) {
  const d = new Date(ms);
  if (!ms) return "";
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export const fullDate = (ms: number) => (ms ? new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "");

/** A message as a Skele page: title, then sender, date and a link back to Gmail, then the body. */
export function mailToPage(m: Mail, account?: string): { title: string; markdown: string } {
  const esc = (s: string) => s.replace(/([\\*_[\]<>])/g, "\\$1");
  const meta = [
    `**From:** ${esc(m.from)}`,
    `**To:** ${esc(m.to)}`,
    m.cc ? `**Cc:** ${esc(m.cc)}` : "",
    `**Date:** ${fullDate(m.date)}`,
    m.attachments.length ? `**Attachments:** ${esc(m.attachments.map((a) => a.filename).join(", "))}` : "",
    `[Open in Gmail](${gmailUrl(m, account)})`,
  ].filter(Boolean);
  return { title: (m.subject.trim() || "(no subject)").slice(0, 200), markdown: `${meta.join("  \n")}\n\n---\n\n${mailBody(m)}\n` };
}

/** "Re: …" without stacking prefixes. */
export const replySubject = (s: string) => (/^re:/i.test(s.trim()) ? s.trim() : `Re: ${s.trim()}`);
export const forwardSubject = (s: string) => (/^fwd?:/i.test(s.trim()) ? s.trim() : `Fwd: ${s.trim()}`);

/** The original message, quoted under a reply. */
export function quoted(m: Mail) {
  const who = parseAddress(m.from).name || m.from;
  const body = mailBody(m)
    .split("\n")
    .map((l) => `> ${l}`)
    .join("\n");
  return `\n\nOn ${fullDate(m.date)}, ${who} wrote:\n${body}`;
}

export function forwarded(m: Mail) {
  const head = [`From: ${m.from}`, `Date: ${fullDate(m.date)}`, `Subject: ${m.subject}`, `To: ${m.to}`];
  if (m.cc) head.push(`Cc: ${m.cc}`);
  return `\n\n---------- Forwarded message ---------\n${head.join("\n")}\n\n${mailBody(m)}`;
}

/** Everyone else on the thread, for Reply all (without your own address). */
export function replyAllCc(m: Mail, me: string) {
  const mine = me.toLowerCase();
  const sender = parseAddress(m.replyTo || m.from).email.toLowerCase();
  return [m.to, m.cc]
    .join(",")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s && ![mine, sender].includes(parseAddress(s).email.toLowerCase()))
    .join(", ");
}

/**
 * The HTML email as a standalone document for a sandboxed iframe: no scripts, links open
 * outside, and remote images only when the user asks (they can tell the sender you read it).
 */
export function emailDocument(html: string, opts: { images: boolean }) {
  const csp = `default-src 'none'; style-src 'unsafe-inline'${opts.images ? " https: http:" : ""}; img-src data: cid:${opts.images ? " https: http:" : ""}; font-src data:${opts.images ? " https:" : ""}`;
  // Most HTML email is designed for a white page, so it stays white in dark mode too.
  const base = `<meta http-equiv="Content-Security-Policy" content="${csp}"><base target="_blank"><style>html,body{margin:0;padding:0;background:#fff;color:#222;font:14px/1.5 system-ui,sans-serif;overflow-wrap:anywhere}body{padding:16px}img{max-width:100%;height:auto}table{max-width:100%}</style>`;
  return `<!doctype html><html><head><meta charset="utf-8">${base}</head><body>${html}</body></html>`;
}
