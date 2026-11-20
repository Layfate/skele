# Gmail integration (optional)

Skele can show your Gmail inbox, send and reply to email, save an email as a page, and let the
AI search and read your mail. It talks to the Gmail API straight from your device with
**OAuth 2.0 Authorization Code + PKCE**, using your own Google Cloud OAuth client. Nothing goes
through a Skele server.

## Connect

In the desktop app built with a Gmail client (see [Built-in client](#built-in-client)), open
**Settings → Integrations** and click **Connect Gmail**. Your browser opens Google's sign-in;
pick your account, allow access, and Skele is connected. Nothing to set up.

Otherwise (a browser copy of Skele, a build without one, or if you'd rather use your own
client), set up your own Google client once:

## Use your own Google client

1. In [Google Cloud](https://console.cloud.google.com/projectcreate), create a project (or pick
   one) and [enable the Gmail API](https://console.cloud.google.com/apis/library/gmail.googleapis.com).
2. Open [Google Auth Platform](https://console.cloud.google.com/auth/overview), click **Get
   started** and choose **External**. Under **Audience**, add your Gmail address as a **test user**.
3. Under **Clients**, create an OAuth client:
   - **Desktop app:** type **Desktop app**. No redirect URI is needed: Skele listens on
     `127.0.0.1` (port 43827, or a free port) only while you sign in, like the Spotify sign-in.
   - **Browser:** type **Web application**, with the authorized redirect URI Skele shows in
     Settings → Integrations, for example `http://127.0.0.1:3000/integrations/gmail/callback/`
     (or your HTTPS address when hosted).
4. Paste the **Client ID** and **Client secret** into **Settings → Integrations → Gmail set
   up**, click **Save**, then **Connect Gmail** and leave every permission ticked.

Google asks for the client secret even with PKCE. For a Desktop app client it isn't treated as
confidential; Skele keeps it on this device next to the tokens.

Scopes requested: `gmail.readonly` (read mail) and `gmail.send` (send as you). Skele never
changes, labels, archives or deletes mail, so opening a message in Skele doesn't mark it read
in Gmail.

> **Testing apps sign out after 7 days.** While your Google Cloud app's publishing status is
> **Testing**, Google expires its sign-ins after 7 days. Skele then shows that Gmail
> disconnected and why; click **Connect Gmail** again. Publishing the app removes the limit,
> but Gmail's read scope is "restricted", so Google requires a verification for that. For your
> own account, Testing is the practical choice.

## Built-in client

To give a desktop build one-click Connect, create one Google Cloud OAuth client of type
**Desktop app** (steps 1–3 above) and build with `NEXT_PUBLIC_GMAIL_CLIENT_ID` and
`NEXT_PUBLIC_GMAIL_CLIENT_SECRET` set (in `.env`, or the `GMAIL_CLIENT_ID` and
`GMAIL_CLIENT_SECRET` repository variables in CI). Google treats a Desktop client's secret as
public, so shipping it in the app is expected. Saving your own client in Settings overrides the
built-in one; switching clients signs Gmail out, since a sign-in belongs to the client that made it.

While that Google app is in **Testing**, only the accounts listed as test users can sign in
(up to 100), and sign-ins expire after 7 days. Letting anyone with a Google account connect
means publishing the app, and because `gmail.readonly` is a restricted scope Google requires
verification plus a yearly third-party security assessment for that.

## What works

- **Mail** in the sidebar (shown once Gmail is connected) with the inbox's unread count.
  Inbox, Starred, Sent and All mail; search with Gmail's syntax (`from:ada has:attachment
  newer_than:7d`) across all mail; load more.
- **Reading:** HTML email is shown in a sandboxed frame with no scripts or forms, and remote
  images stay hidden until you click **Show images** (so senders can't tell you opened it).
  Links open in your browser; `mailto:` links open a new email in Skele. Attachments are
  listed; download them in Gmail.
- **Writing:** **Compose** (also "Compose email" in the command palette, Ctrl/⌘ K), **Reply**,
  **Reply all** and **Forward**. Replies stay in the Gmail thread. Mail is sent as plain text.
- **Save as a page:** turns the email into a page in the current workspace: the subject as the
  title, sender, recipients, date, an **Open in Gmail** link, and the body as Markdown
  (headings, links, lists, emphasis kept).
- **AI:** with **Let the AI read your mail** on (Settings → Integrations → Gmail, off by
  default), the Claude API, OpenAI API and OpenRouter get two read-only tools: `gmail_search`
  (Gmail search syntax) and `gmail_read`. Ask "what did the airline send me about my flight?"
  or "summarise this week's emails from Ada". Only the emails the model looks up are sent, to
  the provider that answers. Claude Code, Codex and local models don't get these tools.

## Privacy

- The client secret and tokens are stored only in Skele's local app registry (IndexedDB), apart
  from your workspaces. They're never included in backups or exports.
- Skele talks to `oauth2.googleapis.com` and `gmail.googleapis.com` only after you connect.
- **Disconnect** deletes the tokens and asks Google to revoke them. You can also remove access
  at <https://myaccount.google.com/connections>.

## Limitations

- One Gmail account at a time.
- No attachments in sent mail, no drafts, no labels or archiving (read-only plus send).
- Verified with mocked Google responses (`tests/unit/gmail.test.ts`, `tests/e2e/gmail.spec.ts`).
  Not yet tried with a live Google account.
