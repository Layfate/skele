// Gmail tools for the API models (Claude API, OpenAI API, OpenRouter), when Gmail is connected
// and Settings → Integrations → Gmail → "Let the AI read your mail" is on. Read-only: the AI
// can search and read messages, never send, change or delete them.

import type { ApiTool } from "@/features/ai/tools";
import { getMail, listMail } from "./api";
import { aiAccess, isConnected } from "./auth";
import { fullDate, mailBody } from "./text";

/** Most characters of one email body sent to a model. */
const MAX_BODY = 40_000;

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function gmailToolsEnabled() {
  try {
    return (await aiAccess()) && (await isConnected());
  } catch {
    return false;
  }
}

export function gmailTools(): ApiTool[] {
  return [
    {
      name: "gmail_search",
      description:
        "Search the user's Gmail with Gmail search syntax (for example: from:ada@example.com, subject:invoice, is:unread, newer_than:7d, has:attachment, in:inbox, or plain words). An empty query lists the latest inbox messages. Returns id, date, sender, subject and a snippet for each message; use gmail_read with an id for the full text.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Gmail search query. Empty for the latest inbox messages." },
          max: { type: "integer", description: "How many messages to return (1–25, default 10)." },
        },
        required: [],
        additionalProperties: false,
      },
      run: async (args) => {
        try {
          const query = String(args.query ?? "").trim();
          const max = Math.min(25, Math.max(1, Number(args.max) || 10));
          const page = await listMail({ folder: "inbox", query, max });
          if (!page.messages.length) return { text: query ? `No emails match “${query}”.` : "The inbox is empty." };
          const lines = page.messages.map(
            (m) => `- id: ${m.id} | ${fullDate(m.date)} | from: ${m.from} | subject: ${m.subject || "(no subject)"}${m.unread ? " | unread" : ""}\n  ${m.snippet}`,
          );
          return { text: `${page.messages.length} email(s)${page.nextPageToken ? " (more exist; refine the query to narrow down)" : ""}:\n${lines.join("\n")}` };
        } catch (e) {
          return { text: errText(e), isError: true };
        }
      },
      label: (a) => (String(a.query ?? "").trim() ? `Searched Gmail for “${String(a.query).trim()}”` : "Looked at the Gmail inbox"),
    },
    {
      name: "gmail_read",
      description: "Read one email in full (headers and body text) by the id gmail_search returned.",
      parameters: {
        type: "object",
        properties: { id: { type: "string", description: "The message id from gmail_search." } },
        required: ["id"],
        additionalProperties: false,
      },
      run: async (args) => {
        try {
          const m = await getMail(String(args.id));
          let body = mailBody(m);
          if (body.length > MAX_BODY) body = `${body.slice(0, MAX_BODY)}\n\n[… cut off: the email is longer]`;
          const head = [
            `From: ${m.from}`,
            `To: ${m.to}`,
            m.cc ? `Cc: ${m.cc}` : "",
            `Date: ${fullDate(m.date)}`,
            `Subject: ${m.subject || "(no subject)"}`,
            m.attachments.length ? `Attachments: ${m.attachments.map((a) => a.filename).join(", ")}` : "",
          ].filter(Boolean);
          return { text: `${head.join("\n")}\n\n${body}` };
        } catch (e) {
          return { text: errText(e), isError: true };
        }
      },
      label: () => "Read an email",
    },
  ];
}
