"use client";

import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { ExternalLink, Loader2, Mail } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { SettingsCard } from "@/features/settings/components/settings-page";
import { Toggle } from "@/features/ai/components/settings/providers";
import { isDesktop } from "@/lib/desktop";
import { errorText } from "@/lib/oauth";
import { routes } from "@/lib/routes";
import {
  beginConnect,
  cancelConnect,
  disconnect,
  GmailAuthError,
  originProblem,
  redirectUri,
  setClient,
  type DesktopSignIn,
} from "../auth";
import {
  gmailKeys,
  useGmailAiAccess,
  useGmailProfile,
  useGmailStatus,
  useSetGmailAiAccess,
} from "../hooks";

const ext = "inline-flex items-center gap-0.5 text-foreground underline";

export function GmailSettings() {
  const qc = useQueryClient();
  const status = useGmailStatus();
  const connected = !!status.data?.connected;
  const me = useGmailProfile(connected);
  const ai = useGmailAiAccess();
  const setAi = useSetGmailAiAccess();
  const [draft, setDraft] = useState<{
    clientId: string;
    clientSecret: string;
  } | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [signIn, setSignIn] = useState<DesktopSignIn | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);
  if (!status.data) return <Skeleton className="h-48" />;
  const client = draft ?? status.data.client;
  const ownSaved =
    !!status.data.client.clientId && !!status.data.client.clientSecret;
  const builtIn = status.data.builtIn;
  const hasClient = ownSaved || builtIn;
  const problem = typeof window !== "undefined" ? originProblem() : null;
  const desktop = isDesktop();

  const connect = async () => {
    setConnecting(true);
    setConnectError(null);
    try {
      if ((await beginConnect({ onWaiting: setSignIn })) === "connected") {
        setConnecting(false);
        setSignIn(null);
        qc.invalidateQueries({ queryKey: gmailKeys.all });
        toast.success("Gmail connected");
      }
    } catch (e) {
      setConnecting(false);
      setSignIn(null);
      if (e instanceof GmailAuthError && e.code === "cancelled") return;
      const message = errorText(
        e,
        "Couldn't start the Google sign-in. Please try again.",
      );
      setConnectError(message);
      toast.error(message);
    }
  };

  const setup = (
    <>
      <ol className="list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
        <li>
          In{" "}
          <a
            href="https://console.cloud.google.com/projectcreate"
            target="_blank"
            rel="noopener noreferrer"
            className={ext}
          >
            Google Cloud <ExternalLink className="size-3" />
          </a>
          , create a project (or pick one), then{" "}
          <a
            href="https://console.cloud.google.com/apis/library/gmail.googleapis.com"
            target="_blank"
            rel="noopener noreferrer"
            className={ext}
          >
            enable the Gmail API <ExternalLink className="size-3" />
          </a>
          .
        </li>
        <li>
          Open{" "}
          <a
            href="https://console.cloud.google.com/auth/overview"
            target="_blank"
            rel="noopener noreferrer"
            className={ext}
          >
            Google Auth Platform <ExternalLink className="size-3" />
          </a>
          , click Get started, and choose{" "}
          <strong className="text-foreground">External</strong>. Under{" "}
          <strong className="text-foreground">Audience</strong>, add your Gmail
          address as a <strong className="text-foreground">test user</strong>.
        </li>
        <li>
          Under <strong className="text-foreground">Clients</strong>, create a
          client of type{" "}
          <strong className="text-foreground">
            {desktop ? "Desktop app" : "Web application"}
          </strong>
          {desktop ? (
            ". Desktop clients need no redirect URI: Skele listens on 127.0.0.1 while you sign in."
          ) : (
            <>
              {" "}
              with this authorized redirect URI:{" "}
              <span className="mt-1 block rounded-md bg-muted px-2 py-1.5 font-mono text-xs break-all text-foreground">
                {typeof window !== "undefined" ? redirectUri() : ""}
              </span>
            </>
          )}
        </li>
        <li>Copy the client&apos;s Client ID and Client secret below.</li>
      </ol>
      <form
        className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await setClient(client);
            setDraft(null);
            qc.invalidateQueries({ queryKey: gmailKeys.status });
            toast.success(
              client.clientId.trim()
                ? "Google client saved"
                : "Google client removed",
            );
          } catch (err) {
            toast.error(errorText(err, "Invalid client"));
          }
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="gmail-client">Client ID</Label>
          <Input
            id="gmail-client"
            placeholder="….apps.googleusercontent.com"
            autoComplete="off"
            spellCheck={false}
            value={client.clientId}
            onChange={(e) => setDraft({ ...client, clientId: e.target.value })}
            className="font-mono"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="gmail-secret">Client secret</Label>
          <Input
            id="gmail-secret"
            type="password"
            placeholder="GOCSPX-…"
            autoComplete="off"
            spellCheck={false}
            value={client.clientSecret}
            onChange={(e) =>
              setDraft({ ...client, clientSecret: e.target.value })
            }
            className="font-mono"
          />
        </div>
        <Button type="submit" variant="outline" disabled={draft === null}>
          Save
        </Button>
      </form>
      <p className="mt-3 text-xs text-muted-foreground">
        Permissions requested: read your email (gmail.readonly) and send email
        as you (gmail.send). Skele never changes, archives or deletes mail. The
        client secret and sign-in stay on this device and are never included in
        backups or exports. While your Google app is in Testing, Google ends the
        sign-in after 7 days and you connect again; you can revoke access any
        time at{" "}
        <a
          href="https://myaccount.google.com/connections"
          target="_blank"
          rel="noopener noreferrer"
          className={ext}
        >
          myaccount.google.com <ExternalLink className="size-3" />
        </a>
        .
      </p>
    </>
  );

  return (
    <>
      <SettingsCard
        title="Gmail"
        description="Optional. Read and send your email in Skele, save emails as pages, and let the AI look things up in your mail. Skele talks to Google only after you connect, straight from this device."
      >
        <div className="flex items-center gap-3">
          <span className="flex size-8 items-center justify-center rounded-lg bg-red-500/10 text-red-600 dark:text-red-400">
            <Mail className="size-4.5" />
          </span>
          <div className="min-w-0 flex-1 text-sm">
            {connected ? (
              <>
                <p className="font-medium">
                  Connected{me.data ? ` as ${me.data.emailAddress}` : ""}
                </p>
                <p className="text-muted-foreground">
                  {me.error ? (
                    errorText(me.error, "Gmail didn't return your account.")
                  ) : (
                    <Link href={routes.mail()} className="underline">
                      Open Mail
                    </Link>
                  )}
                </p>
              </>
            ) : (
              <p className="text-muted-foreground">
                {status.data.ended ??
                  (hasClient
                    ? builtIn && !ownSaved
                      ? "Not connected. Click Connect Gmail and sign in with Google in your browser."
                      : "Not connected"
                    : "Not connected. Set up your Google client below first.")}
              </p>
            )}
          </div>
          {connected ? (
            <Button
              variant="outline"
              onClick={async () => {
                await disconnect();
                qc.removeQueries({ queryKey: gmailKeys.all });
                qc.invalidateQueries({ queryKey: gmailKeys.status });
                toast.success("Gmail disconnected");
              }}
            >
              Disconnect
            </Button>
          ) : connecting && desktop ? (
            <div className="flex items-center gap-2">
              <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Finish signing in in
                your browser…
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void cancelConnect()}
              >
                Cancel
              </Button>
            </div>
          ) : (
            <Button
              disabled={!hasClient || !!problem || connecting}
              onClick={connect}
            >
              {connecting && <Loader2 className="animate-spin" />} Connect Gmail
            </Button>
          )}
        </div>
        {problem && !connected && (
          <p className="mt-3 rounded-md bg-amber-500/10 px-3 py-2 text-sm">
            {problem}
          </p>
        )}
        {connectError && !connecting && !connected && (
          <p
            role="alert"
            className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-sm"
          >
            {connectError}
          </p>
        )}
        {connecting && signIn && (
          <p className="mt-3 text-sm text-muted-foreground">
            {signIn.browserOpened
              ? "Browser didn't open? "
              : `Your browser didn't open${signIn.browserError ? ` (${signIn.browserError})` : ""}. `}
            <button
              type="button"
              className="text-foreground underline"
              onClick={async () => {
                await navigator.clipboard.writeText(signIn.url);
                toast.success("Sign-in link copied");
              }}
            >
              Copy sign-in link
            </button>{" "}
            and open it in any browser on this computer.
          </p>
        )}
        {connected && (
          <div className="mt-4 border-t pt-4">
            <Toggle
              label="Let the AI read your mail"
              hint="AI chats with the Claude API, OpenAI API or OpenRouter can search and read your emails when you ask about them. Emails go only to the provider that answers, and only the ones it looks up. The AI can't send, change or delete mail."
              checked={!!ai.data}
              onChange={(on) => setAi.mutate(on)}
            />
          </div>
        )}
      </SettingsCard>

      {builtIn ? (
        <SettingsCard
          title="Use your own Google client"
          description="Optional. Skele connects with its built-in Google client. Use your own Google Cloud OAuth client instead if you prefer; saving one signs Gmail out so you can connect with it."
        >
          <details open={ownSaved || undefined}>
            <summary className="cursor-pointer text-sm font-medium select-none">
              {ownSaved ? "Your own client (in use)" : "Set up your own client"}
            </summary>
            <div className="mt-3">{setup}</div>
          </details>
        </SettingsCard>
      ) : (
        <SettingsCard
          title="Gmail set up (one time)"
          description="Skele signs in with your own Google Cloud OAuth client, so your mail never passes through anyone else's servers. It takes about five minutes."
        >
          {setup}
        </SettingsCard>
      )}
    </>
  );
}
