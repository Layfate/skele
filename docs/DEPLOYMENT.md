# Hosting Skele

Skele builds to plain static files. There's no server code, database or secrets, so any static
host works. Each visitor's data stays in their own browser, and hosting a copy doesn't give
you access to anyone's notes.

```bash
npm ci
npm run build            # → ./out
```

Optional build-time variables (see `.env.example`): `NEXT_PUBLIC_SPOTIFY_CLIENT_ID`,
`NEXT_PUBLIC_MAX_UPLOAD_MB`.

## Requirements for the host

- **HTTPS.** Needed for the service worker (offline use), installation as a PWA, and Spotify
  redirects. Loopback addresses such as `http://127.0.0.1` are the exception.
- **Trailing-slash routes.** Routes are exported as `page/index.html`, `graph/index.html` and so
  on. Most hosts serve `/page/` from `page/index.html` automatically.
- **Serve from the domain root.** The app expects to live at `/`. Hosting under a sub-path
  (`/skele/`) would need `basePath` in `next.config.ts`.
- **Next.js segment prefetch files** (optional). Next 16 requests files like
  `/tasks/__next.!KGFwcCk.tasks.__PAGE__.txt`, which the export writes as
  `/tasks/__next.!KGFwcCk/tasks/__PAGE__.txt`. If your host returns 404 for these, navigation
  still works because Next falls back to `index.txt`, but prefetching is slower. `npm start`
  (`scripts/serve.mjs`) maps them, and you can add a similar rewrite rule on your host.

## Examples

**GitHub Pages / Netlify / Cloudflare Pages:** publish directory `out`, build command
`npm run build`.

**nginx:**

```nginx
server {
  listen 443 ssl;
  root /srv/skele/out;
  location /_next/static/ { add_header Cache-Control "public, max-age=31536000, immutable"; }
  location / { try_files $uri $uri/ $uri/index.html =404; }
}
```

**Locally:** `npm start` serves `./out` at `http://127.0.0.1:3000` (`npm start -- 8080` for
another port).

## Security headers (recommended)

`X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, and a
Content-Security-Policy that allows `connect-src 'self' https://api.spotify.com
https://accounts.spotify.com` and `img-src 'self' blob: data: https://i.scdn.co
https://*.spotifycdn.com` if you use the Spotify integration. Test the CSP before enforcing it:
Next.js inlines bootstrap scripts, so `script-src` needs `'unsafe-inline'` or hashes.

## Updating

Deploy the new `out/`. Open tabs pick up the new version on their next navigation. The service
worker uses network-first for pages and cache-first for hashed assets.
