// Minimal Gmail API client (official REST endpoints): list, read and send messages. Read-only
// plus send: Skele never changes, labels or deletes mail.

import { base64url, errorText } from "@/lib/oauth";
import { accessToken } from "./auth";

const API = "https://gmail.googleapis.com/gmail/v1/users/me";

export type GmailErrorKind = "not-connected" | "rate-limited" | "forbidden" | "not-found" | "unknown";

export class GmailError extends Error {
  constructor(
    public kind: GmailErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "GmailError";
  }
}

export async function gmailFetch<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  let token: string | null;
  try {
    token = await accessToken(!retry);
  } catch (e) {
    throw new GmailError("unknown", errorText(e, "Couldn't reach Google."));
  }
  if (!token) throw new GmailError("not-connected", "Gmail isn't connected. Connect it in Settings → Integrations.");
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, ...(init.body ? { "Content-Type": "application/json" } : {}), ...init.headers },
    });
  } catch {
    throw new GmailError("unknown", "Couldn't reach Gmail. Check your internet connection.");
  }
  if (res.status === 401 && retry) return gmailFetch<T>(path, init, false);
  const data = await res.json().catch(() => null);
  if (res.ok) return data as T;
  const message: string = data?.error?.message || res.statusText || `HTTP ${res.status}`;
  if (res.status === 401) throw new GmailError("not-connected", "Gmail sign-in is no longer valid. Connect Gmail again in Settings → Integrations.");
  if (res.status === 429) throw new GmailError("rate-limited", "Gmail is busy. Try again in a moment.");
  if (res.status === 404) throw new GmailError("not-found", "That email doesn't exist any more.");
  if (res.status === 403 && /has not been used|is disabled/i.test(message)) {
    throw new GmailError("forbidden", "The Gmail API is turned off for your Google Cloud project. Enable it (APIs & Services → Library → Gmail API), wait a minute, then try again.");
  }
  if (res.status === 403 && /insufficient/i.test(message)) {
    throw new GmailError("forbidden", "Skele doesn't have permission for this. Disconnect Gmail and connect again, leaving every box ticked.");
  }
  throw new GmailError(res.status === 403 ? "forbidden" : "unknown", message);
}

// --- Message shapes ---------------------------------------------------------------------

type Header = { name: string; value: string };
export type MessagePart = {
  partId?: string;
  mimeType: string;
  filename?: string;
  headers?: Header[];
  body?: { size: number; data?: string; attachmentId?: string };
  parts?: MessagePart[];
};
export type RawMessage = {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: MessagePart;
};

/** One row of a message list. */
export type MailSummary = {
  id: string;
  threadId: string;
  from: string;
  to: string;
  subject: string;
  date: number;
  snippet: string;
  unread: boolean;
  starred: boolean;
  hasAttachment: boolean;
};

export type Attachment = { filename: string; mimeType: string; size: number };

/** A whole message, decoded. */
export type Mail = MailSummary & {
  cc: string;
  replyTo: string;
  messageId: string;
  references: string;
  text: string;
  html: string;
  attachments: Attachment[];
};

export const header = (part: MessagePart | undefined, name: string) =>
  part?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";

/** Decodes Gmail's base64url body data as UTF-8. */
export function decodeBody(data: string): string {
  const b64 = data.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder("utf-8").decode(bytes);
}

/** Walks the MIME tree: the first text/plain and text/html bodies, and the attachments. */
export function bodies(root: MessagePart | undefined) {
  let text = "";
  let html = "";
  const attachments: Attachment[] = [];
  const walk = (part: MessagePart) => {
    if (part.filename && (part.body?.attachmentId || part.body?.data)) {
      attachments.push({ filename: part.filename, mimeType: part.mimeType, size: part.body?.size ?? 0 });
      return;
    }
    if (part.mimeType === "text/plain" && !text && part.body?.data) text = decodeBody(part.body.data);
    else if (part.mimeType === "text/html" && !html && part.body?.data) html = decodeBody(part.body.data);
    part.parts?.forEach(walk);
  };
  if (root) walk(root);
  return { text, html, attachments };
}

const hasAttachment = (part: MessagePart | undefined): boolean => !!part && (!!(part.filename && part.body?.attachmentId) || !!part.parts?.some(hasAttachment));

export function toSummary(m: RawMessage): MailSummary {
  const labels = m.labelIds ?? [];
  const date = Number(m.internalDate) || Date.parse(header(m.payload, "Date")) || 0;
  return {
    id: m.id,
    threadId: m.threadId,
    from: header(m.payload, "From"),
    to: header(m.payload, "To"),
    subject: header(m.payload, "Subject"),
    date,
    snippet: decodeEntities(m.snippet ?? ""),
    unread: labels.includes("UNREAD"),
    starred: labels.includes("STARRED"),
    hasAttachment: hasAttachment(m.payload),
  };
}

export function toMail(m: RawMessage): Mail {
  const { text, html, attachments } = bodies(m.payload);
  return {
    ...toSummary(m),
    hasAttachment: attachments.length > 0,
    cc: header(m.payload, "Cc"),
    replyTo: header(m.payload, "Reply-To"),
    messageId: header(m.payload, "Message-ID") || header(m.payload, "Message-Id"),
    references: header(m.payload, "References"),
    text,
    html,
    attachments,
  };
}

/** Gmail snippets come HTML-escaped. */
export function decodeEntities(s: string) {
  return s.replace(/&(#\d+|#x[\da-f]+|amp|lt|gt|quot|apos|nbsp);/gi, (all, e: string) => {
    const k = e.toLowerCase();
    if (k[0] === "#") return String.fromCodePoint(k[1] === "x" ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10));
    return ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " } as Record<string, string>)[k] ?? all;
  });
}

/** "Ada Lovelace <ada@example.com>" → { name: "Ada Lovelace", email: "ada@example.com" }. */
export function parseAddress(value: string): { name: string; email: string } {
  const m = value.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1].trim() || m[2].trim(), email: m[2].trim() };
  return { name: value.trim(), email: value.trim() };
}

// --- Folders and lists ------------------------------------------------------------------

export type Folder = "inbox" | "starred" | "sent" | "all";
export const FOLDERS: { id: Folder; label: string; labelIds?: string[]; q?: string }[] = [
  { id: "inbox", label: "Inbox", labelIds: ["INBOX"] },
  { id: "starred", label: "Starred", labelIds: ["STARRED"] },
  { id: "sent", label: "Sent", labelIds: ["SENT"] },
  { id: "all", label: "All mail", q: "-in:spam -in:trash" },
];

const METADATA = ["From", "To", "Subject", "Date"].map((h) => `metadataHeaders=${h}`).join("&");

export type MailPage = { messages: MailSummary[]; nextPageToken?: string; estimate: number };

/** One page of messages in a folder, or matching a Gmail search ("from:ada has:attachment"). */
export async function listMail(opts: { folder?: Folder; query?: string; pageToken?: string; max?: number }): Promise<MailPage> {
  const folder = FOLDERS.find((f) => f.id === (opts.folder ?? "inbox"))!;
  const params = new URLSearchParams({ maxResults: String(opts.max ?? 25) });
  const q = [opts.query?.trim(), opts.query?.trim() ? "" : folder.q].filter(Boolean).join(" ");
  if (q) params.set("q", q);
  // A search looks through all mail, like Gmail's own search box.
  if (!opts.query?.trim()) for (const l of folder.labelIds ?? []) params.append("labelIds", l);
  if (opts.pageToken) params.set("pageToken", opts.pageToken);
  const list = await gmailFetch<{ messages?: { id: string }[]; nextPageToken?: string; resultSizeEstimate?: number }>(`/messages?${params}`);
  const messages = await Promise.all((list.messages ?? []).map((m) => gmailFetch<RawMessage>(`/messages/${m.id}?format=metadata&${METADATA}`)));
  return { messages: messages.map(toSummary), nextPageToken: list.nextPageToken, estimate: list.resultSizeEstimate ?? 0 };
}

export async function getMail(id: string): Promise<Mail> {
  return toMail(await gmailFetch<RawMessage>(`/messages/${encodeURIComponent(id)}?format=full`));
}

export async function profile() {
  return gmailFetch<{ emailAddress: string; messagesTotal: number; threadsTotal: number }>("/profile");
}

export async function unreadInbox(): Promise<number> {
  const label = await gmailFetch<{ messagesUnread?: number }>("/labels/INBOX");
  return label.messagesUnread ?? 0;
}

// --- Sending ----------------------------------------------------------------------------

export type Draft = {
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  body: string;
  /** Replying: the thread, and the original's Message-ID / References headers. */
  threadId?: string;
  inReplyTo?: string;
  references?: string;
};

const utf8b64 = (s: string) => {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
};

/** RFC 2047 encoding for header values that aren't plain ASCII. */
export function encodeHeader(value: string) {
  return /^[\x00-\x7f]*$/.test(value) ? value : `=?UTF-8?B?${utf8b64(value)}?=`;
}

/** Headers can't contain line breaks (they would start new headers). */
const oneLine = (s: string) => s.replace(/[\r\n]+/g, " ").trim();

/** Comma-separated addresses, each "Name <email>" or "email". Null when any looks wrong. */
export function checkAddresses(list: string): string | null {
  const parts = list.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
  const bad = parts.find((p) => !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(parseAddress(p).email));
  return bad ?? null;
}

/** Encodes "Name <email>" lists, with non-ASCII names RFC 2047-encoded. */
function addressHeader(list: string) {
  return list
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((p) => {
      const { name, email } = parseAddress(p);
      return name && name !== email ? `${encodeHeader(name.replace(/"/g, ""))} <${email}>` : email;
    })
    .join(", ");
}

/** The RFC 5322 message Gmail sends: plain text, UTF-8, base64 body. */
export function buildMime(d: Draft): string {
  const lines = [`To: ${addressHeader(oneLine(d.to))}`];
  if (d.cc?.trim()) lines.push(`Cc: ${addressHeader(oneLine(d.cc))}`);
  if (d.bcc?.trim()) lines.push(`Bcc: ${addressHeader(oneLine(d.bcc))}`);
  lines.push(`Subject: ${encodeHeader(oneLine(d.subject))}`);
  if (d.inReplyTo) {
    lines.push(`In-Reply-To: ${oneLine(d.inReplyTo)}`);
    lines.push(`References: ${oneLine([d.references, d.inReplyTo].filter(Boolean).join(" "))}`);
  }
  lines.push("MIME-Version: 1.0", "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64", "");
  const body = utf8b64(d.body.replace(/\r?\n/g, "\r\n"))
    .match(/.{1,76}/g)
    ?.join("\r\n");
  return lines.join("\r\n") + "\r\n" + (body ?? "");
}

export async function sendMail(d: Draft) {
  const raw = base64url(new TextEncoder().encode(buildMime(d)));
  return gmailFetch<{ id: string; threadId: string }>("/messages/send", {
    method: "POST",
    body: JSON.stringify(d.threadId ? { raw, threadId: d.threadId } : { raw }),
  });
}

/** A link that opens the message in Gmail on the web, in the connected account. */
export const gmailUrl = (m: Pick<MailSummary, "threadId">, account?: string) =>
  `https://mail.google.com/mail/${account ? `?authuser=${encodeURIComponent(account)}` : "u/0/"}#all/${m.threadId}`;
