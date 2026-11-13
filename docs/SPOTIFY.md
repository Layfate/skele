# Spotify integration (optional)

Skele can show what's playing and control playback on your Spotify devices. It uses the
Spotify Web API with **OAuth 2.0 Authorization Code + PKCE**, so there's no client secret and no
server. Each person uses their own Spotify app (client ID).

## Set up

1. Go to the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard), create an
   app, and select **Web API**.
2. Add the **redirect URI** exactly as Skele shows it in **Settings → Integrations**. For local
   use that's:

   ```
   http://127.0.0.1:3000/integrations/spotify/callback/
   ```

   Spotify rejects `localhost`, so open Skele at `127.0.0.1`. Hosted copies need HTTPS, for
   example `https://notes.example.com/integrations/spotify/callback/`.
3. Copy the app's **Client ID** into Settings → Integrations, then click **Connect Spotify**.
4. While your Spotify app is in development mode, add your Spotify account under
   **User Management** in the dashboard.

Scopes requested: `user-read-playback-state`, `user-modify-playback-state`,
`user-read-currently-playing`, `user-read-recently-played`, `playlist-read-private`,
`playlist-read-collaborative`.

## What works

- Sidebar mini player, floating player, and an expanded player with playlists, search, recently
  played, and a device picker
- Play/pause, next/previous, seek, volume and switching devices. These **need Spotify Premium**,
  which is a Spotify rule. Free accounts can see what's playing.
- Spotify must be open on some device (phone, desktop or web player). Skele tells you when no
  device is active.

## Privacy

- Tokens are stored only in the local app registry (IndexedDB). They're never included in
  backups or exports.
- Skele talks to `accounts.spotify.com` and `api.spotify.com` only after you connect.
- **Disconnect** removes the tokens. You can also revoke access at
  <https://www.spotify.com/account/apps/>.

## Limitations

- The desktop app can't complete the Spotify sign-in yet, because its window origin isn't an
  HTTPS or loopback address Spotify accepts. Use Skele in a browser to connect.
- Not yet verified against a live Spotify account. The PKCE flow, token refresh and error
  handling are covered by unit tests with mocked responses (`tests/unit/spotify.test.ts`).
