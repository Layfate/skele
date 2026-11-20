"use client";

import { useState } from "react";
import { Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { modKey } from "@/components/common";
import { checkAddresses, type Draft } from "../api";
import { useSendMail } from "../hooks";

export type ComposeInit = Partial<Draft> & { title?: string; /** Put the cursor at the top of the body (replies). */ replyTop?: boolean };

/** Writes and sends one email (new, reply or forward). Plain text. */
export function ComposeDialog({ init, from, onClose }: { init: ComposeInit; from?: string; onClose: () => void }) {
  const [to, setTo] = useState(init.to ?? "");
  const [cc, setCc] = useState(init.cc ?? "");
  const [bcc, setBcc] = useState(init.bcc ?? "");
  const [showCc, setShowCc] = useState(!!(init.cc || init.bcc));
  const [subject, setSubject] = useState(init.subject ?? "");
  const [body, setBody] = useState(init.body ?? "");
  const [problem, setProblem] = useState<string | null>(null);
  const send = useSendMail();
  const dirty = body !== (init.body ?? "") || subject !== (init.subject ?? "") || to !== (init.to ?? "");

  const submit = () => {
    if (!to.trim()) return setProblem("Add at least one recipient.");
    for (const [label, list] of [
      ["To", to],
      ["Cc", cc],
      ["Bcc", bcc],
    ] as const) {
      const bad = list.trim() ? checkAddresses(list) : null;
      if (bad) return setProblem(`“${bad}” in ${label} doesn't look like an email address.`);
    }
    if (!subject.trim() && !window.confirm("Send without a subject?")) return;
    setProblem(null);
    send.mutate(
      { to, cc, bcc, subject, body, threadId: init.threadId, inReplyTo: init.inReplyTo, references: init.references },
      { onSuccess: onClose },
    );
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (open || send.isPending) return;
        if (dirty && !window.confirm("Discard this email?")) return;
        onClose();
      }}
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{init.title ?? "New email"}</DialogTitle>
          <DialogDescription>{from ? `From ${from}. ` : ""}Sent through your Gmail account, as plain text.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              submit();
            }
          }}
        >
          <div className="flex items-end gap-2">
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="mail-to">To</Label>
              <Input id="mail-to" value={to} onChange={(e) => setTo(e.target.value)} placeholder="name@example.com, …" autoFocus={!to} autoComplete="off" />
            </div>
            {!showCc && (
              <Button type="button" variant="ghost" size="sm" onClick={() => setShowCc(true)}>
                Cc / Bcc
              </Button>
            )}
          </div>
          {showCc && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="mail-cc">Cc</Label>
                <Input id="mail-cc" value={cc} onChange={(e) => setCc(e.target.value)} autoComplete="off" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="mail-bcc">Bcc</Label>
                <Input id="mail-bcc" value={bcc} onChange={(e) => setBcc(e.target.value)} autoComplete="off" />
              </div>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="mail-subject">Subject</Label>
            <Input id="mail-subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mail-body">Message</Label>
            <Textarea
              id="mail-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="min-h-64 font-sans"
              autoFocus={!!to}
              onFocus={(e) => {
                if (init.replyTop) e.currentTarget.setSelectionRange(0, 0);
              }}
            />
          </div>
          {problem && (
            <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm">
              {problem}
            </p>
          )}
          <DialogFooter className="items-center">
            <span className="mr-auto text-xs text-muted-foreground">{modKey()} Enter to send</span>
            <Button type="submit" disabled={send.isPending}>
              {send.isPending ? <Loader2 className="animate-spin" /> : <Send />} Send
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
