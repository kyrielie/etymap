import type { WordDetail, GraphNode, GraphEdge } from "./types";
import { getLang } from "./db";

declare const d3: typeof import("d3");

// ── Constants ─────────────────────────────────────────────────────────────────

const RC: Record<string, string> = {
  inh: "#315A78", bor: "#8A2E2E", der: "#556B4D",
  lbor: "#7B5B2E", cog: "#8B7355",
};

const FAM_COLOR: Record<string, string> = {
  Germanic: "#3D5F7A", "Proto-Germanic": "#2A4A5E",
  Romance: "#7A3030", Celtic: "#4A5E2A",
  Hellenic: "#7A6520", Semitic: "#5E3A7A",
  Iranian: "#7A5520", "Indo-Aryan": "#A0622A",
  Dravidian: "#3A6B3A", Sinitic: "#7A2A2A",
  "Sino-Tibetan": "#8B6533", Japonic: "#7A2A44",
  Austronesian: "#2A5A7A", "Uto-Aztecan": "#6B5A22",
  Arawakan: "#4A6B35", Cariban: "#3A5522",
  Uralic: "#4A3A7A", Slavic: "#4A3A6B",
  Baltic: "#3A5A4A", Armenian: "#7A4A22",
  Albanian: "#7A6622", Anatolian: "#7A5522",
  Tocharian: "#6B6B22", PIE: "#555550",
  Bantu: "#2A6B2A", Isolate: "#6B6B6B",
  Creole: "#3A5A7A", Constructed: "#5A5A5A",
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
    ["ine-pro", "gem-pro", "gmw-pro", "sit-pro", "azc-nah-pro", "poz-pol-pro"].includes(code)
  );
}

function escHtml(s: string): string {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

// ── Show/hide tip ─────────────────────────────────────────────────────────────

function showTip(ev: MouseEvent, node: { word: string; lang: string; etym_text: string }): void {
  const tip = document.getElementById("tip");
  if (!tip) return;
  const meta = getLang(node.lang);
  document.getElementById("tt-w")!.textContent = node.word;
  document.getElementById("tt-l")!.textContent =
    meta.name + (meta.family ? " · " + meta.family : "");
  document.getElementById("tt-b")!.textContent =
    (node.etym_text ?? "").slice(0, 130) + ((node.etym_text ?? "").length > 130 ? "…" : "");
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

  const W = (svg.node()?.clientWidth ?? 800);
  const H = (svg.node()?.clientHeight ?? 600);

  // Defs — arrow markers
  const defs = svg.append("defs");
  Object.entries(RC).forEach(([t, c]) => {
    defs.append("marker")
      .attr("id", "g-arr-" + t)
      .attr("viewBox", "0 0 10 10").attr("refX", 18).attr("refY", 5)
      .attr("markerWidth", 6).attr("markerHeight", 6)
      .attr("orient", "auto-start-reverse")
      .append("path")
      .attr("d", "M2 1L8 5L2 9")
      .attr("fill", "none").attr("stroke", c)
      .attr("stroke-width", 1.5).attr("stroke-linecap", "round");
  });

  // Root group for zoom
  const g = svg.append("g");

  const zoom = d3.zoom<SVGSVGElement, unknown>()
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

  // Cognate pseudo-edges
  const activeIds = new Set(data.nodes.map((n) => n.id));
  const cogEdges: GraphEdge[] = filters.has("cog")
    ? data.cognates.slice(0, 30).flatMap((cog) => {
        if (!activeIds.has(cog.src)) return [];
        const [langCode] = cog.tgt.split(":");
        const lang = getLang(langCode);
        if (!lang) return [];
        activeIds.add(cog.tgt);
        if (!data.nodes.find((n) => n.id === cog.tgt)) {
          const word = cog.tgt.split(":").slice(1).join(":");
          data.nodes.push({
            id: cog.tgt, word, lang: langCode,
            lang_name: lang.name, pos: "", etym_text: cog.expansion,
          });
        }
        return [{ src: cog.src, tgt: cog.tgt, type: "cog" as const, expansion: cog.expansion }];
      })
    : [];

  const allEdges = [...visEdges, ...cogEdges];

  // D3 simulation nodes/links
  interface SimNode extends GraphNode { x?: number; y?: number; fx?: number | null; fy?: number | null }
  const simNodes: SimNode[] = data.nodes.map((n) => ({ ...n }));
  const nodeById = new Map(simNodes.map((n) => [n.id, n]));

  const simLinks = allEdges
    .map((e) => ({ source: nodeById.get(e.src), target: nodeById.get(e.tgt), type: e.type, expansion: e.expansion }))
    .filter((l) => l.source && l.target);

  if (_simulation) _simulation.stop();
  _simulation = d3.forceSimulation(simNodes as d3.SimulationNodeDatum[])
    .force("link", d3.forceLink(simLinks).id((d: any) => (d as SimNode).id).distance(90).strength(0.6))
    .force("charge", d3.forceManyBody().strength(-280))
    .force("center", d3.forceCenter(W / 2, H / 2))
    .force("collide", d3.forceCollide(22));

  // Edges
  const edgeSel = g.selectAll<SVGPathElement, typeof simLinks[0]>(".g-edge")
    .data(simLinks).enter().append("path")
    .attr("class", "g-edge")
    .attr("stroke", (d) => edgeColor(d.type))
    .attr("stroke-width", (d) => d.type === "cog" ? 0.9 : 1.5)
    .attr("stroke-dasharray", (d) => d.type === "cog" ? "4 3" : "")
    .attr("opacity", (d) => d.type === "cog" ? 0.45 : 0.8)
    .attr("marker-end", (d) => d.type === "cog" ? null : `url(#g-arr-${d.type})`)
    .on("mouseover", (ev, d) => {
      const src = d.source as SimNode;
      const tgt = d.target as SimNode;
      showTip(ev, {
        word: `${src.word} → ${tgt.word}`,
        lang: `${getLang(src.lang).name} → ${getLang(tgt.lang).name}`,
        etym_text: `${d.type}: ${d.expansion}`,
      });
    })
    .on("mouseout", hideTip);

  // Nodes
  const nodeSel = g.selectAll<SVGGElement, SimNode>(".g-node")
    .data(simNodes).enter().append("g")
    .attr("class", "g-node")
    .call(
      d3.drag<SVGGElement, SimNode>()
        .on("start", (ev, d) => { if (!ev.active) _simulation!.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
        .on("drag", (ev, d) => { d.fx = ev.x; d.fy = ev.y; })
        .on("end", (ev, d) => { if (!ev.active) _simulation!.alphaTarget(0); d.fx = null; d.fy = null; }),
    )
    .on("click", (_, d) => onNodeSelect(d.id))
    .on("mouseover", (ev, d) => showTip(ev, d))
    .on("mouseout", hideTip);

  nodeSel.each(function (d) {
    const el = d3.select(this);
    const proto = isProtoLang(d.lang);
    const r = nodeR(d.lang, proto);
    const color = nodeColor(d.lang);

    if (proto) {
      el.append("circle")
        .attr("r", r + 5).attr("fill", "none")
        .attr("stroke", color).attr("stroke-width", 0.7)
        .attr("stroke-dasharray", "2,3").attr("opacity", 0.3);
    }

    el.append("circle")
      .attr("r", r).attr("fill", color)
      .attr("stroke", d.lang === "en" ? "#2A2620" : "rgba(247,241,227,.7)")
      .attr("stroke-width", d.lang === "en" ? 1.5 : 1)
      .attr("opacity", 0.9);

    if (r >= 10) {
      el.append("text")
        .attr("text-anchor", "middle").attr("dy", "0.38em")
        .attr("font-family", "'EB Garamond',serif")
        .attr("font-size", r >= 12 ? 9 : 7)
        .attr("font-style", proto ? "italic" : "normal")
        .attr("fill", "rgba(247,241,227,.92)")
        .attr("pointer-events", "none")
        .text(() => d.word.length > 6 ? d.word.slice(0, 5) + "…" : d.word);
    }
  });

  // Tick
  _simulation.on("tick", () => {
    edgeSel.attr("d", (d) => {
      const s = d.source as SimNode;
      const t = d.target as SimNode;
      if (s.x == null || t.x == null) return "";
      const dx = t.x - s.x, dy = t.y - s.y;
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
    .transition().duration(280).call(_zoomBehavior.scaleBy, factor);
}

export function graphReset(): void {
  if (!_zoomBehavior) return;
  d3.select<SVGSVGElement, unknown>("#graph-svg")
    .transition().duration(350).call(_zoomBehavior.transform, d3.zoomIdentity);
}
