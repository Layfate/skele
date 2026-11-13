"use client";

import { useQuery } from "@tanstack/react-query";
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, type Simulation, type SimulationLinkDatum, type SimulationNodeDatum } from "d3-force";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Crosshair, Globe, Maximize, Network } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/common";
import { routes } from "@/lib/routes";
import { cn } from "@/lib/utils";
import { linkGraph } from "@/data/repo/pages";
import { Topbar } from "@/features/shell/topbar";
import { useWorkspaceCtx } from "@/features/shell/workspace-context";

type GNode = SimulationNodeDatum & { id: string; title: string; tags: string[]; folder: string | null; degree: number };
type GLink = SimulationLinkDatum<GNode>;

/** Interactive note graph: global view of every link, or the local neighbourhood of one note. */
export function GraphPage() {
  const { workspaceId, store } = useWorkspaceCtx();
  const router = useRouter();
  const params = useSearchParams();
  const graph = useQuery({ queryKey: ["graph", workspaceId], queryFn: () => linkGraph(store) });
  const [mode, setMode] = useState<"global" | "local">(params.get("focus") ? "local" : "global");
  const [focus, setFocus] = useState<string | null>(params.get("focus"));
  const [depth, setDepth] = useState(1);
  const [tag, setTag] = useState("");
  const [folder, setFolder] = useState("");
  const [showOrphans, setShowOrphans] = useState(true);

  const { allTags, folders, rootOf } = useMemo(() => {
    const nodes = graph.data?.nodes ?? [];
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const rootOf = (id: string) => {
      let cur = byId.get(id);
      let guard = 0;
      while (cur?.parentId && byId.get(cur.parentId) && guard++ < 100) cur = byId.get(cur.parentId);
      return cur && cur.id !== id ? cur.id : null;
    };
    return {
      allTags: [...new Set(nodes.flatMap((n) => n.tags))].sort(),
      folders: nodes.filter((n) => nodes.some((c) => c.parentId === n.id) && !n.parentId),
      rootOf,
    };
  }, [graph.data]);

  const data = useMemo(() => {
    if (!graph.data) return null;
    let nodes = graph.data.nodes;
    let links = graph.data.links;
    if (tag) nodes = nodes.filter((n) => n.tags.some((t) => t === tag || t.startsWith(`${tag}/`)));
    if (folder) nodes = nodes.filter((n) => n.id === folder || rootOf(n.id) === folder);
    let ids = new Set(nodes.map((n) => n.id));
    links = links.filter((l) => ids.has(l.source) && ids.has(l.target));
    if (mode === "local" && focus) {
      const keep = new Set([focus]);
      for (let i = 0; i < depth; i++) {
        for (const l of links) {
          if (keep.has(l.source)) keep.add(l.target);
          if (keep.has(l.target)) keep.add(l.source);
        }
      }
      nodes = nodes.filter((n) => keep.has(n.id));
      ids = keep;
      links = links.filter((l) => keep.has(l.source) && keep.has(l.target));
    }
    const degree = new Map<string, number>();
    for (const l of links) {
      degree.set(l.source, (degree.get(l.source) ?? 0) + 1);
      degree.set(l.target, (degree.get(l.target) ?? 0) + 1);
    }
    if (!showOrphans) nodes = nodes.filter((n) => degree.has(n.id) || n.id === focus);
    return {
      nodes: nodes.map<GNode>((n) => ({ id: n.id, title: n.title, tags: n.tags, folder: rootOf(n.id), degree: degree.get(n.id) ?? 0 })),
      links: links.map<GLink>((l) => ({ source: l.source, target: l.target })),
    };
  }, [graph.data, tag, folder, mode, focus, depth, showOrphans, rootOf]);

  const selectClass = "h-8 rounded-md border bg-background px-2 text-sm";

  return (
    <>
      <Topbar crumbs={[{ label: "Graph view" }]} />
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2 text-sm">
        <div className="flex rounded-md bg-muted p-0.5" role="tablist" aria-label="Graph mode">
          {(
            [
              ["global", Globe, "Global"],
              ["local", Crosshair, "Local"],
            ] as const
          ).map(([m, Icon, label]) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              onClick={() => setMode(m)}
              className={cn("flex h-7 items-center gap-1.5 rounded px-2.5 text-muted-foreground", mode === m && "bg-background text-foreground shadow-sm")}
            >
              <Icon className="size-3.5" /> {label}
            </button>
          ))}
        </div>
        {mode === "local" && (
          <>
            <select aria-label="Focus note" className={cn(selectClass, "max-w-56")} value={focus ?? ""} onChange={(e) => setFocus(e.target.value || null)}>
              <option value="">Choose a note…</option>
              {graph.data?.nodes
                .slice()
                .sort((a, b) => a.title.localeCompare(b.title))
                .map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.title}
                  </option>
                ))}
            </select>
            <select aria-label="Depth" className={selectClass} value={depth} onChange={(e) => setDepth(Number(e.target.value))}>
              {[1, 2, 3].map((d) => (
                <option key={d} value={d}>
                  {d} {d === 1 ? "link" : "links"} away
                </option>
              ))}
            </select>
          </>
        )}
        <select aria-label="Filter by tag" className={selectClass} value={tag} onChange={(e) => setTag(e.target.value)}>
          <option value="">All tags</option>
          {allTags.map((t) => (
            <option key={t} value={t}>
              #{t}
            </option>
          ))}
        </select>
        <select aria-label="Filter by folder" className={cn(selectClass, "max-w-48")} value={folder} onChange={(e) => setFolder(e.target.value)}>
          <option value="">All folders</option>
          {folders.map((f) => (
            <option key={f.id} value={f.id}>
              {f.title}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-muted-foreground">
          <input type="checkbox" checked={showOrphans} onChange={(e) => setShowOrphans(e.target.checked)} className="accent-[var(--brand)]" />
          Unlinked notes
        </label>
        <span className="ml-auto text-xs text-muted-foreground">
          {data?.nodes.length ?? 0} notes · {data?.links.length ?? 0} links
        </span>
      </div>
      <div className="relative min-h-0 flex-1">
        {data && data.nodes.length === 0 ? (
          <EmptyState
            icon={Network}
            title={mode === "local" && !focus ? "Choose a note to centre the graph on" : "Nothing to show"}
            description="Link notes with [[ ]] in the editor and they'll appear connected here."
            className="h-full"
          />
        ) : (
          data && <GraphCanvas data={data} focus={mode === "local" ? focus : null} onOpen={(id) => router.push(routes.page(id))} onFocus={(id) => (setFocus(id), setMode("local"))} />
        )}
      </div>
    </>
  );
}

function cssVar(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#888";
}

function GraphCanvas({
  data,
  focus,
  onOpen,
  onFocus,
}: {
  data: { nodes: GNode[]; links: GLink[] };
  focus: string | null;
  onOpen: (id: string) => void;
  onFocus: (id: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const view = useRef({ x: 0, y: 0, k: 1 });
  const hover = useRef<GNode | null>(null);
  const sim = useRef<Simulation<GNode, GLink> | null>(null);
  const draw = useRef<() => void>(() => {});
  const [, force] = useState(0);
  // Latest callbacks without restarting the simulation on every render.
  const callbacks = useRef({ onOpen, onFocus });
  useEffect(() => {
    callbacks.current = { onOpen, onFocus };
  });

  useEffect(() => {
    const canvas = canvasRef.current!;
    const wrap = wrapRef.current!;
    const ctx = canvas.getContext("2d")!;
    const nodes = data.nodes.map((n) => ({ ...n }));
    const links = data.links.map((l) => ({ ...l }));
    const neighbours = new Map<string, Set<string>>();
    for (const l of links) {
      const s = String(l.source);
      const t = String(l.target);
      (neighbours.get(s) ?? neighbours.set(s, new Set()).get(s)!).add(t);
      (neighbours.get(t) ?? neighbours.set(t, new Set()).get(t)!).add(s);
    }
    const radius = (n: GNode) => 4 + Math.min(10, Math.sqrt(n.degree) * 2.2);

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = wrap.clientWidth * dpr;
      canvas.height = wrap.clientHeight * dpr;
      canvas.style.width = `${wrap.clientWidth}px`;
      canvas.style.height = `${wrap.clientHeight}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      draw.current();
    };

    draw.current = () => {
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      const { x, y, k } = view.current;
      const fg = cssVar("--foreground");
      const muted = cssVar("--muted-foreground");
      const brand = cssVar("--brand");
      const border = cssVar("--border");
      ctx.clearRect(0, 0, w, h);
      ctx.save();
      ctx.translate(w / 2 + x, h / 2 + y);
      ctx.scale(k, k);
      const active = hover.current;
      const lit = active ? neighbours.get(active.id) : null;
      ctx.lineWidth = 1 / k;
      for (const l of links) {
        const s = l.source as GNode;
        const t = l.target as GNode;
        const on = active && (s.id === active.id || t.id === active.id);
        ctx.strokeStyle = on ? brand : border;
        ctx.globalAlpha = active && !on ? 0.35 : 1;
        ctx.beginPath();
        ctx.moveTo(s.x!, s.y!);
        ctx.lineTo(t.x!, t.y!);
        ctx.stroke();
      }
      for (const n of nodes) {
        const isActive = active?.id === n.id || n.id === focus;
        const dim = active && !isActive && !lit?.has(n.id);
        ctx.globalAlpha = dim ? 0.3 : 1;
        ctx.fillStyle = isActive || lit?.has(n.id) ? brand : muted;
        ctx.beginPath();
        ctx.arc(n.x!, n.y!, radius(n), 0, Math.PI * 2);
        ctx.fill();
        if (k > 0.7 || isActive || n.degree > 3) {
          ctx.fillStyle = fg;
          ctx.font = `${12 / Math.max(k, 0.7)}px Inter, system-ui, sans-serif`;
          ctx.textAlign = "center";
          ctx.fillText(n.title.length > 32 ? `${n.title.slice(0, 30)}…` : n.title, n.x!, n.y! + radius(n) + 12 / Math.max(k, 0.7));
        }
      }
      ctx.restore();
      ctx.globalAlpha = 1;
    };

    const simulation = forceSimulation<GNode>(nodes)
      .force("link", forceLink<GNode, GLink>(links).id((d) => d.id).distance(60).strength(0.4))
      .force("charge", forceManyBody().strength(nodes.length > 800 ? -40 : -140))
      .force("center", forceCenter(0, 0))
      .force("collide", forceCollide<GNode>().radius((d) => radius(d) + 6))
      .alphaDecay(nodes.length > 1500 ? 0.06 : 0.0228)
      .on("tick", () => draw.current());
    sim.current = simulation;

    const toWorld = (cx: number, cy: number) => {
      const rect = canvas.getBoundingClientRect();
      const { x, y, k } = view.current;
      return { x: (cx - rect.left - rect.width / 2 - x) / k, y: (cy - rect.top - rect.height / 2 - y) / k };
    };
    const hit = (cx: number, cy: number) => {
      const p = toWorld(cx, cy);
      return simulation.find(p.x, p.y, 16 / view.current.k) ?? null;
    };

    let dragging: GNode | null = null;
    let panning: { x: number; y: number; vx: number; vy: number } | null = null;
    let moved = false;

    const onDown = (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId);
      moved = false;
      const n = hit(e.clientX, e.clientY);
      if (n) {
        dragging = n;
        n.fx = n.x;
        n.fy = n.y;
        simulation.alphaTarget(0.25).restart();
      } else {
        panning = { x: e.clientX, y: e.clientY, vx: view.current.x, vy: view.current.y };
      }
    };
    const onMove = (e: PointerEvent) => {
      if (dragging) {
        moved = true;
        const p = toWorld(e.clientX, e.clientY);
        dragging.fx = p.x;
        dragging.fy = p.y;
      } else if (panning) {
        moved = true;
        view.current.x = panning.vx + e.clientX - panning.x;
        view.current.y = panning.vy + e.clientY - panning.y;
        draw.current();
      } else {
        const n = hit(e.clientX, e.clientY);
        if (n !== hover.current) {
          hover.current = n;
          canvas.style.cursor = n ? "pointer" : "grab";
          draw.current();
        }
      }
    };
    const onUp = (e: PointerEvent) => {
      if (dragging) {
        if (!moved) (e.altKey || e.shiftKey ? callbacks.current.onFocus : callbacks.current.onOpen)(dragging.id);
        dragging.fx = null;
        dragging.fy = null;
        simulation.alphaTarget(0);
      }
      dragging = null;
      panning = null;
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left - rect.width / 2;
      const my = e.clientY - rect.top - rect.height / 2;
      const v = view.current;
      const k = Math.min(4, Math.max(0.15, v.k * Math.exp(-e.deltaY * 0.0015)));
      v.x = mx - ((mx - v.x) * k) / v.k;
      v.y = my - ((my - v.y) * k) / v.k;
      v.k = k;
      draw.current();
    };

    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    resize();
    return () => {
      simulation.stop();
      ro.disconnect();
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("wheel", onWheel);
    };
  }, [data, focus]);

  return (
    <div ref={wrapRef} className="absolute inset-0 overflow-hidden">
      <canvas ref={canvasRef} className="block cursor-grab touch-none" role="img" aria-label={`Graph of ${data.nodes.length} notes and ${data.links.length} links`} />
      <div className="absolute right-3 bottom-3 flex flex-col items-end gap-2">
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="Reset view"
          onClick={() => {
            view.current = { x: 0, y: 0, k: 1 };
            draw.current();
            force((n) => n + 1);
          }}
        >
          <Maximize />
        </Button>
        <p className="rounded bg-background/80 px-2 py-1 text-[11px] text-muted-foreground backdrop-blur">
          Click to open · Shift+click to focus · drag to move · scroll to zoom
        </p>
      </div>
      {/* Accessible alternative to the canvas: a plain list of the visible notes. */}
      <ul className="sr-only">
        {data.nodes.map((n) => (
          <li key={n.id}>
            <a href={routes.page(n.id)}>{n.title}</a> — {n.degree} links
          </li>
        ))}
      </ul>
    </div>
  );
}
