"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, ExternalLink, FilePlus2, Forward, ImageIcon, Loader2, Paperclip, Reply, ReplyAll } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { openExternal, isDesktop } from "@/lib/desktop";
import { errorText } from "@/lib/oauth";
import { gmailUrl, parseAddress, type Mail } from "../api";
import { useMail } from "../hooks";
import { emailDocument, forwarded, forwardSubject, fullDate, quoted, replyAllCc, replySubject } from "../text";
import type { ComposeInit } from "./compose-dialog";

/** Opens a link from an email: in the system browser on desktop, a new tab in a browser. */
function openLink(href: string) {
  if (isDesktop()) void openExternal(href);
  else window.open(href, "_blank", "noopener,noreferrer");
}

/** Where a mailto: link writes to. */
function mailtoInit(href: string): ComposeInit {
  const url = new URL(href);
  const p = url.searchParams;
  return { to: decodeURIComponent(url.pathname), cc: p.get("cc") ?? "", bcc: p.get("bcc") ?? "", subject: p.get("subject") ?? "", body: p.get("body") ?? "" };
}

/**
 * HTML email in a sandboxed iframe: no scripts or forms (no allow-scripts / allow-forms), and
 * a CSP that blocks remote content until "Show images". allow-same-origin only lets this page
 * size the frame and catch link clicks, which open outside Skele.
 */
function HtmlBody({ html, images, onMailto }: { html: string; images: boolean; onMailto: (init: ComposeInit) => void }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(200);
  const doc = emailDocument(html, { images });
  // The frame loads once per document, so the click handler reads the latest callback from here.
  const mailto = useRef(onMailto);
  useEffect(() => {
    mailto.current = onMailto;
  }, [onMailto]);

  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    let observer: ResizeObserver | undefined;
    const onLoad = () => {
      const d = el.contentDocument;
      if (!d) return;
      const fit = () => setHeight(Math.max(80, d.documentElement.scrollHeight));
      fit();
      observer?.disconnect();
      observer = new ResizeObserver(fit);
      observer.observe(d.body);
      d.addEventListener("click", (e) => {
        const a = (e.target as Element | null)?.closest?.("a[href]");
        if (!a) return;
        e.preventDefault();
        const href = a.getAttribute("href") ?? "";
        if (/^mailto:/i.test(href)) mailto.current(mailtoInit(href));
        else if (/^https?:/i.test(href)) openLink(href);
      });
    };
    el.addEventListener("load", onLoad);
    return () => {
      el.removeEventListener("load", onLoad);
      observer?.disconnect();
    };
  }, [doc]);

  return <iframe ref={frame} title="Email" sandbox="allow-same-origin" srcDoc={doc} className="w-full rounded-lg border bg-white" style={{ height }} />;
}

const URL_RE = /(https?:\/\/[^\s<>()"']+[^\s<>()"'.,;:!?])/g;

function TextBody({ text }: { text: string }) {
  const parts = text.split(URL_RE);
  return (
    <div className="text-sm leading-relaxed break-words whitespace-pre-wrap">
      {parts.map((p, i) =>
        i % 2 ? (
          <a key={i} href={p} target="_blank" rel="noopener noreferrer" className="text-brand underline">
            {p}
          </a>
        ) : (
          p
        ),
      )}
    </div>
  );
}

function Action({ label, icon, onClick, disabled }: { label: string; icon: ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={label} onClick={onClick} disabled={disabled}>
          {icon}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

const size = (n: number) => (n > 1_000_000 ? `${(n / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1000))} KB`);

export function MailView({
  id,
  account,
  onBack,
  onCompose,
  onSave,
  saving,
}: {
  id: string;
  account?: string;
  onBack: () => void;
  onCompose: (init: ComposeInit) => void;
  onSave: (mail: Mail) => void;
  saving: boolean;
}) {
  const mail = useMail(id);
  // Remote images are shown per message, after asking.
  const [imagesFor, setImagesFor] = useState<string | null>(null);
  const images = imagesFor === id;

  if (mail.isPending) {
    return (
      <div className="space-y-3 p-6">
        <Skeleton className="h-7 w-2/3" />
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-64" />
      </div>
    );
  }
  if (mail.error) return <p className="p-6 text-sm text-muted-foreground">{errorText(mail.error, "Couldn't open this email.")}</p>;
  const m = mail.data;
  const sender = parseAddress(m.from);
  const replyTo = m.replyTo || m.from;
  const reply = (all: boolean) =>
    onCompose({
      title: all ? "Reply all" : "Reply",
      to: replyTo,
      cc: all ? replyAllCc(m, account ?? "") : "",
      subject: replySubject(m.subject),
      body: quoted(m),
      threadId: m.threadId,
      inReplyTo: m.messageId,
      references: m.references,
      replyTop: true,
    });
  const hasRemote = /<img[^>]+src=["']?https?:/i.test(m.html) || /url\(\s*["']?https?:/i.test(m.html);

  return (
    <article className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-0.5 border-b px-2 py-1.5">
        <Button variant="ghost" size="icon" aria-label="Back to the list" className="md:hidden" onClick={onBack}>
          <ArrowLeft />
        </Button>
        <Action label="Reply" icon={<Reply />} onClick={() => reply(false)} />
        <Action label="Reply all" icon={<ReplyAll />} onClick={() => reply(true)} />
        <Action
          label="Forward"
          icon={<Forward />}
          onClick={() => onCompose({ title: "Forward", subject: forwardSubject(m.subject), body: forwarded(m), replyTop: true })}
        />
        <div className="mx-1 h-5 w-px bg-border" />
        <Action label="Save as a page" icon={saving ? <Loader2 className="animate-spin" /> : <FilePlus2 />} onClick={() => onSave(m)} disabled={saving} />
        <Action label="Open in Gmail" icon={<ExternalLink />} onClick={() => openLink(gmailUrl(m, account))} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-[clamp(1rem,3vw,2rem)] py-5 scrollbar-thin">
        <h1 className="text-xl font-semibold tracking-tight break-words">{m.subject || "(no subject)"}</h1>
        <div className="mt-3 flex flex-wrap items-baseline gap-x-2 text-sm">
          <span className="font-medium">{sender.name}</span>
          {sender.email !== sender.name && <span className="text-muted-foreground">&lt;{sender.email}&gt;</span>}
          <span className="ml-auto text-xs text-muted-foreground">{fullDate(m.date)}</span>
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground break-words">
          To {m.to}
          {m.cc ? ` · Cc ${m.cc}` : ""}
        </p>
        {m.attachments.length > 0 && (
          <ul className="mt-3 flex flex-wrap gap-1.5">
            {m.attachments.map((a, i) => (
              <li key={i} className="flex items-center gap-1 rounded-md border px-2 py-1 text-xs">
                <Paperclip className="size-3" /> {a.filename} <span className="text-muted-foreground">{size(a.size)}</span>
              </li>
            ))}
            <li className="self-center text-xs text-muted-foreground">Open in Gmail to download.</li>
          </ul>
        )}
        {m.html && hasRemote && !images && (
          <div className="mt-4 flex items-center gap-2 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
            <ImageIcon className="size-3.5" /> Images are hidden so the sender can&apos;t tell you opened this.
            <button type="button" className="ml-auto font-medium text-foreground underline" onClick={() => setImagesFor(id)}>
              Show images
            </button>
          </div>
        )}
        <div className="mt-4">{m.html ? <HtmlBody html={m.html} images={images} onMailto={onCompose} /> : <TextBody text={m.text || m.snippet} />}</div>
      </div>
    </article>
  );
}
