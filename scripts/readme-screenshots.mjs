// Regenerates the README screenshots in docs/screenshots from the sample workspace.
//
//   npm run build && npm run screenshots
//
// Serves ./out, opens the sample workspace in a fresh browser (so nothing personal appears),
// visits and stars a few pages so Home isn't empty, and connects Spotify through Skele's real
// sign-in flow against a simulated Spotify (no account or network involved; the track, playlists
// and cover art below are made up). Each scene is captured in light and dark at a 1280×800 window
// and 2× pixel density, then placed in a macOS-style window frame on a transparent background.
// The README shows the dark versions to visitors using GitHub's dark theme.
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

const PORT = 3123;
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = path.resolve("docs/screenshots");
mkdirSync(OUT, { recursive: true });

// ── Simulated Spotify ──────────────────────────────────────────────────────────────────────────

const COVERS = {
  slow: ["#f97316", "#db2777", "#fde68a"],
  focus: ["#4f46e5", "#06b6d4", "#c7d2fe"],
  pages: ["#059669", "#a3e635", "#ecfccb"],
  night: ["#1e293b", "#7c3aed", "#f0abfc"],
  rain: ["#0ea5e9", "#64748b", "#e0f2fe"],
  sun: ["#f59e0b", "#ef4444", "#fef3c7"],
};

/** Abstract cover art as SVG (served in place of i.scdn.co images). */
function cover(id) {
  const [a, b, c] = COVERS[id] ?? COVERS.focus;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>
<rect width="640" height="640" fill="url(#g)"/>
<circle cx="420" cy="230" r="150" fill="${c}" opacity=".85"/>
<path d="M0 470 C 160 390 300 560 640 430 L640 640 L0 640Z" fill="#000" opacity=".22"/>
<path d="M0 540 C 200 470 380 620 640 520 L640 640 L0 640Z" fill="#000" opacity=".2"/></svg>`;
}
const images = (id) => [640, 300, 64].map((w) => ({ url: `https://i.scdn.co/image/${id}-${w}`, width: w, height: w }));
const track = (id, name, artist, album, cov, duration) => ({
  id,
  name,
  uri: `spotify:track:${id}`,
  duration_ms: duration,
  artists: [{ name: artist }],
  album: { name: album, images: images(cov) },
  external_urls: { spotify: `https://open.spotify.com/track/${id}` },
});
const NOW = track("t1", "Slow Mornings", "The Calm Machines", "Quiet Hours", "slow", 214_000);
const RECENT = [
  track("t2", "Paper Boats", "Lumen Fields", "Paper Boats", "rain", 187_000),
  track("t3", "Night Shift", "Velvet Static", "Afterglow", "night", 241_000),
  track("t4", "Golden Hour Drive", "Sunday Arcade", "Golden Hour", "sun", 199_000),
  track("t5", "Margins", "The Calm Machines", "Quiet Hours", "slow", 176_000),
];
const playlist = (id, name, cov, total) => ({ id, name, uri: `spotify:playlist:${id}`, images: images(cov), tracks: { total }, owner: { display_name: "Alex" } });
const PLAYLISTS = [
  playlist("p1", "Focus Flow", "focus", 64),
  playlist("p2", "Morning Pages", "pages", 38),
  playlist("p3", "Late Night Notes", "night", 51),
  playlist("p4", "Rainy Day Writing", "rain", 42),
  playlist("p5", "Sunday Reset", "sun", 27),
];
const DEVICES = [
  { id: "d1", name: "MacBook Pro", type: "Computer", is_active: true, volume_percent: 62, supports_volume: true, is_restricted: false },
  { id: "d2", name: "Living Room", type: "Speaker", is_active: false, volume_percent: 40, supports_volume: true, is_restricted: false },
  { id: "d3", name: "Alex's iPhone", type: "Smartphone", is_active: false, volume_percent: 100, supports_volume: true, is_restricted: false },
];

async function simulateSpotify(context) {
  await context.route("https://accounts.spotify.com/authorize**", (route) => {
    const url = new URL(route.request().url());
    const back = new URL(url.searchParams.get("redirect_uri"));
    back.search = new URLSearchParams({ code: "demo-code", state: url.searchParams.get("state") }).toString();
    return route.fulfill({ contentType: "text/html", body: `<script>location.replace(${JSON.stringify(back.toString())})</script>` });
  });
  await context.route("https://accounts.spotify.com/api/token", (route) =>
    route.fulfill({ json: { access_token: "demo", refresh_token: "demo", expires_in: 3600, scope: "", token_type: "Bearer" } }),
  );
  await context.route("https://i.scdn.co/image/**", (route) =>
    route.fulfill({ contentType: "image/svg+xml", body: cover(new URL(route.request().url()).pathname.split("/").pop().split("-")[0]) }),
  );
  await context.route("https://api.spotify.com/v1/**", (route) => {
    const { pathname } = new URL(route.request().url());
    const json = {
      "/v1/me": { display_name: "Alex", product: "premium", country: "US" },
      "/v1/me/player": { is_playing: true, progress_ms: 83_000, item: NOW, device: DEVICES[0], currently_playing_type: "track" },
      "/v1/me/player/devices": { devices: DEVICES },
      "/v1/me/playlists": { items: PLAYLISTS },
      "/v1/me/player/recently-played": { items: RECENT.map((t, i) => ({ track: t, played_at: new Date(Date.now() - (i + 1) * 900_000).toISOString() })) },
    }[pathname];
    return json ? route.fulfill({ json }) : route.fulfill({ status: 204 });
  });
}

// ── macOS-style window frame ───────────────────────────────────────────────────────────────────

async function framed(framePage, png, scheme, file) {
  const dark = scheme === "dark";
  await framePage.setContent(`<!doctype html><html><head><style>
html,body{margin:0;background:transparent}
.pad{display:inline-block;padding:36px 44px 60px}
.win{width:1280px;border-radius:12px;overflow:hidden;
  box-shadow:0 0 0 1px ${dark ? "rgba(255,255,255,.13)" : "rgba(0,0,0,.16)"},0 28px 64px rgba(0,0,0,${dark ? 0.6 : 0.26}),0 8px 20px rgba(0,0,0,${dark ? 0.35 : 0.1})}
.bar{position:relative;height:30px;display:flex;align-items:center;background:${dark ? "#26272b" : "#ebe9e6"};border-bottom:1px solid ${dark ? "#121316" : "#d9d6d1"}}
.dots{display:flex;gap:8px;padding-left:13px}
.dots i{display:block;width:12px;height:12px;border-radius:50%;box-shadow:inset 0 0 0 .5px rgba(0,0,0,.2)}
.title{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font:600 13px -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;color:${dark ? "#a1a1a6" : "#6e6c69"}}
img{display:block;width:1280px;height:800px}
</style></head><body><div class="pad"><div class="win">
<div class="bar"><div class="title">Skele</div><div class="dots"><i style="background:#ff5f57"></i><i style="background:#febc2e"></i><i style="background:#28c840"></i></div></div>
<img src="data:image/png;base64,${png.toString("base64")}" alt="">
</div></div></body></html>`);
  await framePage.locator("img").evaluate((img) => img.decode());
  await framePage.locator(".pad").screenshot({ path: path.join(OUT, file), omitBackground: true });
  console.log(`docs/screenshots/${file}`);
}

// ── Scenes ─────────────────────────────────────────────────────────────────────────────────────

const server = spawn(process.execPath, ["scripts/serve.mjs", String(PORT)], { stdio: "ignore" });
const browser = await chromium.launch();

try {
  for (let i = 0; i < 50; i++) {
    if (await fetch(`${BASE}/welcome/`).then((r) => r.ok).catch(() => false)) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  const frameContext = await browser.newContext({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: 2 });
  const framePage = await frameContext.newPage();

  for (const scheme of ["light", "dark"]) {
    const suffix = scheme === "dark" ? "-dark" : "";
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2, colorScheme: scheme, reducedMotion: "reduce" });
    await simulateSpotify(context);
    // Present as a Mac so shortcuts read ⌘ like the macOS window frame around them.
    await context.addInitScript(() => Object.defineProperty(Navigator.prototype, "platform", { get: () => "MacIntel" }));
    const page = await context.newPage();
    const sidebar = page.getByRole("complementary", { name: "Sidebar" });

    const shot = async (name) => {
      await page.mouse.move(1279, 799);
      await page.evaluate(() => (document.activeElement instanceof HTMLElement ? document.activeElement.blur() : null));
      await page.waitForTimeout(1200);
      await framed(framePage, await page.screenshot(), scheme, `${name}${suffix}.png`);
    };

    await page.goto(`${BASE}/welcome/`);
    await page.getByRole("button", { name: "Open the sample" }).click();
    await sidebar.getByText("Team handbook").first().waitFor({ timeout: 30_000 });

    // Connect Spotify (simulated) through the normal settings flow.
    await page.goto(`${BASE}/settings/?tab=integrations`);
    await page.locator("#spotify-client").fill("0123456789abcdef0123456789abcdef");
    await page.getByRole("button", { name: "Save" }).click();
    await page.getByRole("button", { name: "Connect Spotify" }).click();
    await page.getByText("Premium — full playback control.").waitFor({ timeout: 30_000 });
    await sidebar.getByRole("region", { name: "Spotify" }).getByText("Slow Mornings").waitFor();

    // Use the workspace a little so Home's "Recently visited" and "Favorites" have content.
    for (const title of ["Content calendar", "Meeting notes", "Team handbook"]) {
      await sidebar.getByText(title).first().click();
      await page.waitForTimeout(800);
      const star = page.getByRole("button", { name: "Add to favorites" }).first();
      if (title !== "Content calendar" && (await star.isVisible().catch(() => false))) await star.click();
      await page.waitForTimeout(400);
    }

    // Home (reloaded so the recent-pages list includes the visits above)
    await sidebar.getByRole("link", { name: "Home" }).first().click();
    await page.waitForTimeout(1500);
    await page.reload();
    await page.getByText("My tasks").first().waitFor({ timeout: 30_000 });
    await sidebar.getByRole("region", { name: "Spotify" }).getByText("Slow Mornings").waitFor();
    await shot("home");

    // The expanded Spotify player over Home
    await sidebar.getByRole("region", { name: "Spotify" }).getByRole("button", { name: "More" }).click();
    await page.getByText("Focus Flow").first().waitFor();
    await shot("spotify");
    await page.getByRole("button", { name: "Minimise player" }).click();
    await page.getByText("Focus Flow").first().waitFor({ state: "hidden" });

    // A note with the details panel (outline, backlinks, tags)
    await sidebar.getByText("Team handbook").first().click();
    await page.getByRole("button", { name: "Details: outline, backlinks, tags" }).first().click();
    await page.getByText("Backlinks").first().waitFor();
    await shot("page");
    await page.getByRole("button", { name: "Hide details" }).first().click();

    // A project's task board
    await sidebar.getByRole("link", { name: "Projects" }).first().click();
    await page.getByText("Website relaunch").first().click();
    await page.getByText("Board", { exact: true }).first().click();
    await page.getByText("Not started").first().waitFor();
    await shot("board");

    // A database table
    await sidebar.getByText("Content calendar").first().click();
    await page.getByText("4 records").waitFor();
    await shot("database");

    await context.close();
  }
} finally {
  await browser.close();
  server.kill();
}
