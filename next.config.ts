import type { NextConfig } from "next";

// Skele is a fully client-side, local-first app: it builds to plain static files (`out/`) that
// any static host, the PWA service worker and the Tauri desktop shell can serve. No server runs.
const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  // Spotify only accepts loopback-IP redirect URIs, so the dev server must work at 127.0.0.1 too.
  allowedDevOrigins: ["127.0.0.1"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
