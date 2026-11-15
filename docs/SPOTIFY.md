# Spotify integration (optional)

Skele can show what's playing and control playback on your Spotify devices. It uses the
Spotify Web API with **OAuth 2.0 Authorization Code + PKCE**, so there's no client secret and no
server. Each person uses their own Spotify app (client ID).

## Set up

1. Go to the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard), create an
   app, and select **Web API**.
2. Add the **redirect URI** exactly as Skele shows it in **Settings → Integrations**:

   - **Desktop app:** `http://127.0.0.1/callback`, with no port. Spotify then accepts
     whichever local port Skele listens on (it uses 43827, or a free port if something else
     has 43827). A redirect URI you added earlier as `http://127.0.0.1:43827/callback` keeps
     working as long as that port is free.
   - **Browser, local:** `http://127.0.0.1:3000/integrations/spotify/callback/`. Spotify
     rejects `localhost`, so open Skele at `127.0.0.1`.
   - **Browser, hosted:** HTTPS, for example
     `https://notes.example.com/integrations/spotify/callback/`.
3. Copy the app's **Client ID** into Settings → Integrations, then click **Connect Spotify**.
4. While your Spotify app is in development mode, add your Spotify account under
   **User Management** in the dashboard (up to 5 accounts).

> **The app owner needs Spotify Premium.** Since March 2026 Spotify only serves development-mode
> apps whose owner (the account that created the app in the developer dashboard) has an active
> Premium subscription. Otherwise sign-in succeeds but every request fails with "Active premium
> subscription required for the owner of the app", and Skele says so. The accounts that sign in
> can be Free or Premium. After the owner upgrades, Spotify can take a few hours to allow
> requests again. See Spotify's [quota modes](https://developer.spotify.com/documentation/web-api/concepts/quota-modes).

Scopes requested: `user-read-playback-state`, `user-modify-playback-state`,
`user-read-currently-playing`, `user-read-recently-played`, `playlist-read-private`,
`playlist-read-collaborative`.

## What works

- Sidebar mini player, floating player, and an expanded player with playlists, search, recently
  played, and a device picker
- Play/pause, next/previous, seek, volume and switching devices. These **need Spotify Premium**,
  which is a Spotify rule. Free accounts can see what's playing.
- **Seeking**: click or drag the progress bar (a bubble shows the time under the pointer), or
  focus it and use ← → (5 s; Shift for 15 s), Home and End.
- **Free accounts on Windows** (desktop app): play, pause, skip and seek in the Spotify app on
  this computer through Windows' media controls, no Premium or connection needed.
- Spotify must be open on some device (phone, desktop or web player). Skele tells you when no
  device is active.

## Privacy

- Tokens are stored only in the local app registry (IndexedDB). They're never included in
  backups or exports.
- Skele talks to `accounts.spotify.com` and `api.spotify.com` only after you connect.
- **Disconnect** removes the tokens. You can also revoke access at
  <https://www.spotify.com/account/apps/>.

## Limitations

- The desktop app signs in through your default browser: Skele listens on `127.0.0.1` only
  until the redirect arrives (or 5 minutes pass, or you click Cancel), then finishes the PKCE
  exchange itself. If the browser doesn't open, **Copy sign-in link** and paste it into any
  browser on the same computer.
- The desktop sign-in was verified with a live Spotify account on Windows (November 2026).
  Playback control hasn't been verified live yet. The PKCE flow, token refresh and error
  handling are covered by unit tests with mocked responses (`tests/unit/spotify.test.ts`).
