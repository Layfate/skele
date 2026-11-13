// Tiny zero-dependency static server for the exported app (`npm run build && npm start`).
// Usage: node scripts/serve.mjs [port]   — serves ./out on 127.0.0.1 (Spotify needs 127.0.0.1).
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

const root = path.resolve("out");
const port = Number(process.argv[2] ?? process.env.PORT ?? 3000);
const types = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".webmanifest": "application/manifest+json", ".png": "image/png", ".ico": "image/x-icon", ".svg": "image/svg+xml",
  ".woff2": "font/woff2", ".txt": "text/plain",
};

createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://x");
    let file = path.join(root, decodeURIComponent(url.pathname));
    if (!file.startsWith(root)) throw new Error("outside root");
    // Next's segment prefetches ask for `__next.<group>.<seg>.__PAGE__.txt`; the export writes `__next.<group>/<seg>/__PAGE__.txt`.
    const base = path.basename(file);
    if (base.startsWith("__next.") && base.endsWith(".txt") && !(await stat(file).catch(() => null))) {
      const [, group, ...rest] = base.slice(0, -4).split(".");
      if (rest.length) file = path.join(path.dirname(file), `__next.${group}`, ...rest.slice(0, -1), `${rest.at(-1)}.txt`);
    }
    if ((await stat(file).catch(() => null))?.isDirectory()) file = path.join(file, "index.html");
    else if (!(await stat(file).catch(() => null))) {
      // /page → /page/ (trailing-slash routes)
      if (await stat(path.join(file, "index.html")).catch(() => null)) {
        res.writeHead(308, { Location: `${url.pathname}/${url.search}` }).end();
        return;
      }
      file = path.join(root, "404.html");
      res.statusCode = 404;
    }
    const body = await readFile(file);
    res.setHeader("Content-Type", types[path.extname(file)] ?? "application/octet-stream");
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (file.includes(`${path.sep}_next${path.sep}static${path.sep}`)) res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.end(body);
  } catch {
    res.writeHead(500).end("Server error");
  }
}).listen(port, "127.0.0.1", () => console.log(`Skele → http://127.0.0.1:${port}`));
