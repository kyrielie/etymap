import type { WordDetail, GraphNode, GraphEdge } from "./types";
import { getLang } from "./db";

declare const d3: typeof import("d3");

// ── Constants ─────────────────────────────────────────────────────────────────

const RC: Record<string, string> = {
  inh: "#315A78",
  bor: "#8A2E2E",
  der: "#556B4D",
  lbor: "#7B5B2E",
  cog: "#8B7355",
};

export const EDGE_LABELS: Record<string, string> = {
  inh: "Inherited",
  bor: "Borrowed",
  der: "Derived",
  lbor: "Learned borrowing",
  dbl: "Doublet",
  affix: "Affix",
  cog: "Cognate",
};

const FAM_COLOR: Record<string, string> = {
  Germanic: "#3D5F7A",
  "Proto-Germanic": "#2A4A5E",
  Romance: "#7A3030",
  Celtic: "#4A5E2A",
  Hellenic: "#7A6520",
  Semitic: "#5E3A7A",
  Iranian: "#7A5520",
  "Indo-Aryan": "#A0622A",
  Dravidian: "#3A6B3A",
  Sinitic: "#7A2A2A",
  "Sino-Tibetan": "#8B6533",
  Japonic: "#7A2A44",
  Austronesian: "#2A5A7A",
  "Uto-Aztecan": "#6B5A22",
  Arawakan: "#4A6B35",
  Cariban: "#3A5522",
  Uralic: "#4A3A7A",
  Slavic: "#4A3A6B",
  Baltic: "#3A5A4A",
  Armenian: "#7A4A22",
  Albanian: "#7A6622",
  Anatolian: "#7A5522",
  Tocharian: "#6B6B22",
  PIE: "#555550",
  Bantu: "#2A6B2A",
  Isolate: "#6B6B6B",
  Creole: "#3A5A7A",
  Constructed: "#5A5A5A",
  Papuan: "#4A6B4A",
};

// ── State ─────────────────────────────────────────────────────────────────────

let _zoomBehavior: ReturnType<typeof d3.zoom> | null = null;
let _simulation: ReturnType<typeof d3.forceSimulation> | null = null;

// ── Helpers ───────────────────────────────────────────────────────────────────

function nodeColor(langCode: string): string {
  const lang = getLang(langCode);
  return FAM_COLOR[lang.family ?? ""] ?? "#6B6B6B";
}

function edgeColor(type: string): string {
  return RC[type] ?? "#888";
}

function nodeR(lang: string, isProto: boolean): number {
  if (lang === "en") return 14;
  if (isProto) return 9;
  return 10;
}

function isProtoLang(code: string): boolean {
  return (
    code.endsWith("-pro") ||
    [
      "ine-pro",
      "gem-pro",
      "gmw-pro",
      "sit-pro",
      "azc-nah-pro",
      "poz-pol-pro",
    ].includes(code)
  );
}

function escHtml(s: string): string {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

// ── Ancestry pruning: keep only nodes/edges on a path TO English ──────────────

export function pruneToAncestors(
  nodes: GraphNode[],
  edges: GraphEdge[],
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const enNode = nodes.find((n) => n.lang === "en");
  if (!enNode) return { nodes, edges };

  // Build parent map: for each node, which nodes point TO it (its ancestors)
  const parents = new Map<string, string[]>();
  for (const e of edges) {
    if (!parents.has(e.tgt)) parents.set(e.tgt, []);
    parents.get(e.tgt)!.push(e.src);
  }

  // BFS backwards from English node to collect all ancestor node IDs
  const ancestorSet = new Set<string>();
  const queue = [enNode.id];
  while (queue.length) {
    const id = queue.shift()!;
    if (ancestorSet.has(id)) continue;
    ancestorSet.add(id);
    for (const p of parents.get(id) ?? []) {
      if (!ancestorSet.has(p)) queue.push(p);
    }
  }

  const keptNodes = nodes.filter((n) => ancestorSet.has(n.id));
  const keptEdges = edges.filter(
    (e) => ancestorSet.has(e.src) && ancestorSet.has(e.tgt),
  );
  return { nodes: keptNodes, edges: keptEdges };
}

// ── Show/hide tip ─────────────────────────────────────────────────────────────

function showTip(
  ev: MouseEvent,
  node: { word: string; lang: string; etym_text: string },
): void {
  const tip = document.getElementById("tip");
  if (!tip) return;
  const meta = getLang(node.lang);
  document.getElementById("tt-w")!.textContent = node.word;
  document.getElementById("tt-l")!.textContent =
    meta.name + (meta.family ? " · " + meta.family : "");
  document.getElementById("tt-b")!.textContent =
    (node.etym_text ?? "").slice(0, 130) +
    ((node.etym_text ?? "").length > 130 ? "…" : "");
  tip.classList.add("on");
  moveTip(ev);
}

function hideTip(): void {
  document.getElementById("tip")?.classList.remove("on");
}

function moveTip(ev: MouseEvent): void {
  const tip = document.getElementById("tip");
  if (!tip) return;
  tip.style.left = Math.min(ev.clientX + 16, window.innerWidth - 265) + "px";
  tip.style.top = Math.max(ev.clientY - 10, 6) + "px";
}

document.addEventListener("mousemove", (ev) => {
  const tip = document.getElementById("tip");
  if (tip?.classList.contains("on")) moveTip(ev);
});

// ── Main render ───────────────────────────────────────────────────────────────

export function renderGraph(
  data: WordDetail,
  filters: Set<string>,
  onNodeSelect: (nodeId: string) => void,
): void {
  const svg = d3.select<SVGSVGElement, unknown>("#graph-svg");
  svg.selectAll("*").remove();

  const W = svg.node()?.clientWidth ?? 800;
  const H = svg.node()?.clientHeight ?? 600;

  // Defs — arrow markers
  const defs = svg.append("defs");
  Object.entries(RC).forEach(([t, c]) => {
    defs
      .append("marker")
      .attr("id", "g-arr-" + t)
      .attr("viewBox", "0 0 10 10")
      .attr("refX", 18)
      .attr("refY", 5)
      .attr("markerWidth", 6)
      .attr("markerHeight", 6)
      .attr("orient", "auto-start-reverse")
      .append("path")
      .attr("d", "M2 1L8 5L2 9")
      .attr("fill", "none")
      .attr("stroke", c)
      .attr("stroke-width", 1.5)
      .attr("stroke-linecap", "round");
  });

  // Label halo filter
  const filter = defs
    .append("filter")
    .attr("id", "lbl-halo")
    .attr("x", "-20%")
    .attr("y", "-20%")
    .attr("width", "140%")
    .attr("height", "140%");
  filter
    .append("feFlood")
    .attr("flood-color", "#F0E6D2")
    .attr("flood-opacity", "0.85")
    .attr("result", "bg");
  filter
    .append("feMorphology")
    .attr("in", "SourceGraphic")
    .attr("operator", "dilate")
    .attr("radius", "2")
    .attr("result", "expanded");
  filter
    .append("feComposite")
    .attr("in", "bg")
    .attr("in2", "expanded")
    .attr("operator", "in")
    .attr("result", "halo");
  filter.append("feMerge").call((m: any) => {
    m.append("feMergeNode").attr("in", "halo");
    m.append("feMergeNode").attr("in", "SourceGraphic");
  });

  // Root group for zoom
  const g = svg.append("g");

  const zoom = d3
    .zoom<SVGSVGElement, unknown>()
    .scaleExtent([0.2, 4])
    .on("zoom", (ev) => g.attr("transform", ev.transform));
  svg.call(zoom);
  _zoomBehavior = zoom;

  // Filtered edges
  const seen = new Set<string>();
  const visEdges = data.edges.filter((e) => {
    const t = e.type;
    const ok =
      (t === "lbor" && (filters.has("lbor") || filters.has("bor"))) ||
      filters.has(t);
    if (!ok) return false;
    const k = e.src + "|" + e.tgt;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  // Prune to ancestors-only subgraph
  const pruned = pruneToAncestors(data.nodes, visEdges);

  // Cognate pseudo-edges
  const activeIds = new Set(pruned.nodes.map((n) => n.id));
  const cogEdges: GraphEdge[] = filters.has("cog")
    ? data.cognates.slice(0, 30).flatMap((cog) => {
        if (!activeIds.has(cog.src)) return [];
        const [langCode] = cog.tgt.split(":");
        const lang = getLang(langCode);
        if (!lang) return [];
        activeIds.add(cog.tgt);
        if (!pruned.nodes.find((n) => n.id === cog.tgt)) {
          const word = cog.tgt.split(":").slice(1).join(":");
          pruned.nodes.push({
            id: cog.tgt,
            word,
            lang: langCode,
            lang_name: lang.name,
            pos: "",
            etym_text: cog.expansion,
          });
        }
        return [
          {
            src: cog.src,
            tgt: cog.tgt,
            type: "cog" as const,
            expansion: cog.expansion,
          },
        ];
      })
    : [];

  const allEdges = [...pruned.edges, ...cogEdges];

  // D3 simulation nodes/links
  interface SimNode extends GraphNode {
    x?: number;
    y?: number;
    fx?: number | null;
    fy?: number | null;
  }
  const simNodes: SimNode[] = pruned.nodes.map((n) => ({
    ...n,
    // Jitter starting positions to prevent overlap at identical coords
    x: W / 2 + (Math.random() - 0.5) * 20,
    y: H / 2 + (Math.random() - 0.5) * 20,
  }));
  const nodeById = new Map(simNodes.map((n) => [n.id, n]));

  const simLinks = allEdges
    .map((e) => ({
      source: nodeById.get(e.src),
      target: nodeById.get(e.tgt),
      type: e.type,
      expansion: e.expansion,
    }))
    .filter((l) => l.source && l.target);

  if (_simulation) _simulation.stop();
  _simulation = d3
    .forceSimulation(simNodes as d3.SimulationNodeDatum[])
    .force(
      "link",
      d3
        .forceLink(simLinks)
        .id((d: any) => (d as SimNode).id)
        .distance(90)
        .strength(0.6),
    )
    .force("charge", d3.forceManyBody().strength(-280))
    .force("center", d3.forceCenter(W / 2, H / 2))
    .force("collide", d3.forceCollide(28));

  // Edges
  const edgeSel = g
    .selectAll<SVGPathElement, (typeof simLinks)[0]>(".g-edge")
    .data(simLinks)
    .enter()
    .append("path")
    .attr("class", "g-edge")
    .attr("stroke", (d) => edgeColor(d.type))
    .attr("stroke-width", (d) => (d.type === "cog" ? 0.9 : 1.5))
    .attr("stroke-dasharray", (d) => (d.type === "cog" ? "4 3" : ""))
    .attr("opacity", (d) => (d.type === "cog" ? 0.45 : 0.8))
    .attr("marker-end", (d) =>
      d.type === "cog" ? null : `url(#g-arr-${d.type})`,
    )
    .on("mouseover", (ev, d) => {
      const src = d.source as SimNode;
      const tgt = d.target as SimNode;
      showTip(ev, {
        word: `${src.word} → ${tgt.word}`,
        lang: `${getLang(src.lang).name} → ${getLang(tgt.lang).name}`,
        etym_text: `${EDGE_LABELS[d.type] ?? d.type}: ${d.expansion}`,
      });
    })
    .on("mouseout", hideTip);

  // Nodes
  const nodeSel = g
    .selectAll<SVGGElement, SimNode>(".g-node")
    .data(simNodes)
    .enter()
    .append("g")
    .attr("class", "g-node")
    .style("cursor", "pointer")
    .call(
      d3
        .drag<SVGGElement, SimNode>()
        .on("start", (ev, d) => {
          if (!ev.active) _simulation!.alphaTarget(0.3).restart();
          d.fx = d.x;
          d.fy = d.y;
        })
        .on("drag", (ev, d) => {
          d.fx = ev.x;
          d.fy = ev.y;
        })
        .on("end", (ev, d) => {
          if (!ev.active) _simulation!.alphaTarget(0);
          d.fx = null;
          d.fy = null;
        }),
    )
    .on("mouseover", (ev, d) =>
      showTip(ev, {
        word: d.word,
        lang: d.lang,
        etym_text: d.etym_text ?? "",
      }),
    )
    .on("mouseout", hideTip)
    .on("click", (ev, d) => onNodeSelect(d.id));

  nodeSel.each(function (d) {
    const el = d3.select(this);
    const proto = isProtoLang(d.lang);
    const r = nodeR(d.lang, proto);
    const color = nodeColor(d.lang);

    if (proto) {
      el.append("circle")
        .attr("r", r + 5)
        .attr("fill", "none")
        .attr("stroke", color)
        .attr("stroke-width", 0.7)
        .attr("stroke-dasharray", "2,3")
        .attr("opacity", 0.3);
    }

    el.append("circle")
      .attr("r", r)
      .attr("fill", color)
      .attr("stroke", d.lang === "en" ? "#2A2620" : "rgba(247,241,227,.7)")
      .attr("stroke-width", d.lang === "en" ? 1.5 : 1)
      .attr("opacity", 0.9);

    if (r >= 10) {
      el.append("text")
        .attr("text-anchor", "middle")
        .attr("dy", "0.38em")
        .attr("font-family", "'EB Garamond',serif")
        .attr("font-size", r >= 12 ? 9 : 7)
        .attr("font-style", proto ? "italic" : "normal")
        .attr("fill", "rgba(247,241,227,.92)")
        .attr("pointer-events", "none")
        .text(() => (d.word.length > 8 ? d.word.slice(0, 7) + "…" : d.word));
    }

    // Language label — full name, wrap proto-languages to two lines
    const langName = getLang(d.lang).name;
    const isLong = langName.length > 16;
    const words = langName.split(" ");
    // For long names, split at mid-point word boundary
    if (isLong && words.length > 1) {
      const mid = Math.ceil(words.length / 2);
      const line1 = words.slice(0, mid).join(" ");
      const line2 = words.slice(mid).join(" ");
      const lbl = el.append("text")
        .attr("class", "g-lbl")
        .attr("text-anchor", "middle")
        .attr("font-family", "'IBM Plex Sans',sans-serif")
        .attr("font-size", 7.5)
        .attr("font-weight", "500")
        .attr("letter-spacing", "0.03em")
        .attr("fill", "var(--ink1)")
        .attr("filter", "url(#lbl-halo)")
        .attr("pointer-events", "none");
      lbl.append("tspan")
        .attr("x", 0)
        .attr("dy", r + 10)
        .text(line1);
      lbl.append("tspan")
        .attr("x", 0)
        .attr("dy", "1.1em")
        .text(line2);
    } else {
      el.append("text")
        .attr("class", "g-lbl")
        .attr("text-anchor", "middle")
        .attr("dy", r + 10)
        .attr("font-family", "'IBM Plex Sans',sans-serif")
        .attr("font-size", 7.5)
        .attr("font-weight", "500")
        .attr("letter-spacing", "0.03em")
        .attr("fill", "var(--ink1)")
        .attr("filter", "url(#lbl-halo)")
        .attr("pointer-events", "none")
        .text(langName);
    }
  });

  // Tick
  _simulation.on("tick", () => {
    edgeSel.attr("d", (d) => {
      const s = d.source as SimNode;
      const t = d.target as SimNode;
      if (s.x == null || t.x == null) return "";
      const dx = t.x - s.x,
        dy = t.y - s.y;
      const dr = Math.sqrt(dx * dx + dy * dy) * (d.type === "cog" ? 1.5 : 0);
      return dr
        ? `M${s.x},${s.y}A${dr},${dr} 0 0,1 ${t.x},${t.y}`
        : `M${s.x},${s.y}L${t.x},${t.y}`;
    });
    nodeSel.attr("transform", (d) => `translate(${d.x ?? 0},${d.y ?? 0})`);
  });
}

// ── Zoom controls ─────────────────────────────────────────────────────────────

export function graphZoom(factor: number): void {
  if (!_zoomBehavior) return;
  d3.select<SVGSVGElement, unknown>("#graph-svg")
    .transition()
    .duration(280)
    .call(_zoomBehavior.scaleBy, factor);
}

export function graphReset(): void {
  if (!_zoomBehavior) return;
  d3.select<SVGSVGElement, unknown>("#graph-svg")
    .transition()
    .duration(350)
    .call(_zoomBehavior.transform, d3.zoomIdentity);
}
