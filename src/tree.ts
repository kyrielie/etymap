import type { WordDetail, GraphNode, GraphEdge } from "./types";
import { getLang } from "./db";
import { pruneToAncestors, EDGE_LABELS } from "./graph";

declare const d3: typeof import("d3");

// ── Constants ─────────────────────────────────────────────────────────────────

const NODE_W = 130;
const NODE_H = 46;
const H_GAP = 36;   // horizontal gap between sibling nodes
const V_GAP = 80;   // vertical gap between depth levels

const EDGE_COLOR: Record<string, string> = {
  inh: "#315A78",
  bor: "#8A2E2E",
  der: "#556B4D",
  lbor: "#7B5B2E",
};

const EDGE_DASH: Record<string, string> = {
  inh: "",
  der: "",
  bor: "6 3",
  lbor: "4 4",
};

// Edge type priority for choosing spanning-tree parent (lower = preferred)
const EDGE_PRIORITY: Record<string, number> = {
  inh: 0,
  der: 1,
  bor: 2,
  lbor: 3,
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

// ── Helpers ───────────────────────────────────────────────────────────────────

function famColor(langCode: string): string {
  const lang = getLang(langCode);
  return FAM_COLOR[lang.family ?? ""] ?? "#8B7E6E";
}

function isProtoLang(code: string): boolean {
  return (
    code.endsWith("-pro") ||
    ["ine-pro", "gem-pro", "gmw-pro", "sit-pro", "azc-nah-pro", "poz-pol-pro"].includes(code)
  );
}

function showTip(ev: MouseEvent, html: string): void {
  const tip = document.getElementById("tip");
  if (!tip) return;
  // Tip expects tw/tl/tb children — repurpose tw for label, tb for body
  document.getElementById("tt-w")!.textContent = "";
  document.getElementById("tt-l")!.textContent = "";
  document.getElementById("tt-b")!.textContent = html;
  tip.classList.add("on");
  moveTip(ev);
}

function showNodeTip(ev: MouseEvent, node: GraphNode): void {
  const tip = document.getElementById("tip");
  if (!tip) return;
  const meta = getLang(node.lang);
  document.getElementById("tt-w")!.textContent = node.word;
  document.getElementById("tt-l")!.textContent =
    meta.name + (meta.family ? " · " + meta.family : "");
  document.getElementById("tt-b")!.textContent =
    (node.etym_text ?? "").slice(0, 150) +
    ((node.etym_text ?? "").length > 150 ? "…" : "");
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

// ── DAG → layout data ─────────────────────────────────────────────────────────

interface LayoutNode {
  id: string;
  node: GraphNode;
  depth: number;
  x: number;
  y: number;
  primaryParentId: string | null;
  parentEdgeType: string;
}

interface LayoutEdge {
  src: string;
  tgt: string;
  type: string;
  expansion: string;
  isPrimary: boolean;
}

function buildLayout(
  nodes: GraphNode[],
  edges: GraphEdge[],
): { layoutNodes: Map<string, LayoutNode>; layoutEdges: LayoutEdge[] } {
  // ── Step 1: Assign depths via longest-path topological sort ─────────────────
  // Build adjacency structures
  const childrenOf = new Map<string, string[]>();  // src → [tgt, ...]
  const parentsOf = new Map<string, { id: string; type: string; expansion: string }[]>();
  for (const e of edges) {
    if (!childrenOf.has(e.src)) childrenOf.set(e.src, []);
    childrenOf.get(e.src)!.push(e.tgt);
    if (!parentsOf.has(e.tgt)) parentsOf.set(e.tgt, []);
    parentsOf.get(e.tgt)!.push({ id: e.src, type: e.type, expansion: e.expansion });
  }

  // Detect and break cycles: DFS-based
  const visited = new Set<string>();
  const inStack = new Set<string>();
  const cycleBreakerRemoved = new Set<string>(); // "src|tgt" keys

  function dfsBreakCycles(id: string): void {
    if (inStack.has(id)) return;
    if (visited.has(id)) return;
    visited.add(id);
    inStack.add(id);
    for (const child of childrenOf.get(id) ?? []) {
      if (inStack.has(child)) {
        // Cycle: remove lowest-priority edge in cycle
        cycleBreakerRemoved.add(id + "|" + child);
        console.warn(`[tree] Cycle detected, breaking edge ${id} → ${child}`);
      } else {
        dfsBreakCycles(child);
      }
    }
    inStack.delete(id);
  }
  for (const n of nodes) dfsBreakCycles(n.id);

  // Filter edges removing cycle-breakers
  const cleanEdges = edges.filter(
    (e) => !cycleBreakerRemoved.has(e.src + "|" + e.tgt),
  );

  // Rebuild parentsOf with clean edges
  const cleanParentsOf = new Map<string, { id: string; type: string; expansion: string }[]>();
  for (const e of cleanEdges) {
    if (!cleanParentsOf.has(e.tgt)) cleanParentsOf.set(e.tgt, []);
    cleanParentsOf.get(e.tgt)!.push({ id: e.src, type: e.type, expansion: e.expansion });
  }

  // Longest-path depth: depth[n] = max(depth[parent] + 1) for all parents
  const depth = new Map<string, number>();
  const nodeSet = new Set(nodes.map((n) => n.id));

  function getDepth(id: string, seen = new Set<string>()): number {
    if (depth.has(id)) return depth.get(id)!;
    if (seen.has(id)) return 0; // cycle guard
    seen.add(id);
    const parents = cleanParentsOf.get(id) ?? [];
    const d = parents.length === 0 ? 0 : Math.max(...parents.map((p) => getDepth(p.id, new Set(seen)) + 1));
    depth.set(id, d);
    return d;
  }
  for (const n of nodes) getDepth(n.id);

  // Group nodes by depth
  const byDepth = new Map<number, string[]>();
  for (const n of nodes) {
    const d = depth.get(n.id) ?? 0;
    if (!byDepth.has(d)) byDepth.set(d, []);
    byDepth.get(d)!.push(n.id);
  }

  // ── Step 2: Build spanning tree via primary parent selection ─────────────────
  // Each node picks its "best" parent by edge type priority
  const primaryParent = new Map<string, { id: string; type: string; expansion: string } | null>();
  for (const n of nodes) {
    const parents = cleanParentsOf.get(n.id) ?? [];
    if (parents.length === 0) {
      primaryParent.set(n.id, null);
    } else {
      const best = [...parents].sort(
        (a, b) => (EDGE_PRIORITY[a.type] ?? 99) - (EDGE_PRIORITY[b.type] ?? 99),
      )[0];
      primaryParent.set(n.id, best);
    }
  }

  // ── Step 3: X-position using simple subtree-width algorithm ──────────────────
  // Build children map for spanning tree
  const spanChildren = new Map<string, string[]>();
  for (const n of nodes) {
    const pp = primaryParent.get(n.id);
    if (pp) {
      if (!spanChildren.has(pp.id)) spanChildren.set(pp.id, []);
      spanChildren.get(pp.id)!.push(n.id);
    }
  }

  // Compute subtree width (number of leaf slots needed)
  const subtreeWidth = new Map<string, number>();
  function calcWidth(id: string): number {
    const children = spanChildren.get(id) ?? [];
    if (children.length === 0) {
      subtreeWidth.set(id, 1);
      return 1;
    }
    const w = children.reduce((sum, c) => sum + calcWidth(c), 0);
    subtreeWidth.set(id, w);
    return w;
  }

  // Find roots (nodes with no primary parent)
  const roots = nodes.filter((n) => !primaryParent.get(n.id));

  for (const r of roots) calcWidth(r.id);

  // Assign x positions via in-order traversal
  const xPos = new Map<string, number>();
  let leafCounter = 0;

  function assignX(id: string): void {
    const children = spanChildren.get(id) ?? [];
    if (children.length === 0) {
      xPos.set(id, leafCounter++);
      return;
    }
    for (const c of children) assignX(c);
    // Parent x = average of children x
    const childXs = children.map((c) => xPos.get(c) ?? 0);
    xPos.set(id, childXs.reduce((a, b) => a + b, 0) / childXs.length);
  }

  for (const r of roots) assignX(r.id);

  // ── Step 4: Convert to pixel coordinates ─────────────────────────────────────
  const layoutNodes = new Map<string, LayoutNode>();
  const nodeById = new Map(nodes.map((n) => [n.id, n]));

  for (const n of nodes) {
    const d = depth.get(n.id) ?? 0;
    const x = (xPos.get(n.id) ?? 0) * (NODE_W + H_GAP);
    const y = d * (NODE_H + V_GAP);
    const pp = primaryParent.get(n.id);
    layoutNodes.set(n.id, {
      id: n.id,
      node: n,
      depth: d,
      x,
      y,
      primaryParentId: pp?.id ?? null,
      parentEdgeType: pp?.type ?? "",
    });
  }

  // ── Step 5: Build layout edges (primary + secondary) ─────────────────────────
  const layoutEdges: LayoutEdge[] = [];
  const addedEdges = new Set<string>();

  for (const e of cleanEdges) {
    const key = e.src + "|" + e.tgt;
    if (addedEdges.has(key)) continue;
    addedEdges.add(key);
    const pp = primaryParent.get(e.tgt);
    const isPrimary = pp?.id === e.src;
    layoutEdges.push({
      src: e.src,
      tgt: e.tgt,
      type: e.type,
      expansion: e.expansion,
      isPrimary,
    });
  }

  return { layoutNodes, layoutEdges };
}

// ── Main render ───────────────────────────────────────────────────────────────

export function renderTree(
  data: WordDetail,
  filters: Set<string>,
  onNodeSelect: (nodeId: string) => void,
): void {
  const svg = d3.select<SVGSVGElement, unknown>("#tree-svg");
  svg.selectAll("*").remove();

  const W = svg.node()?.clientWidth ?? 800;
  const H = svg.node()?.clientHeight ?? 600;

  // Filter edges by active filters
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

  // Prune to ancestors-of-English only
  const pruned = pruneToAncestors(data.nodes, visEdges);

  // Empty state
  if (pruned.nodes.length === 0 || pruned.edges.length === 0) {
    const enNode = data.nodes.find((n) => n.lang === "en");
    if (enNode) {
      // Show single English node centred
      const g = svg.append("g");
      const zoom = d3.zoom<SVGSVGElement, unknown>().scaleExtent([0.2, 4])
        .on("zoom", (ev) => g.attr("transform", ev.transform));
      svg.call(zoom);
      _zoomBehavior = zoom;

      const nx = W / 2 - NODE_W / 2;
      const ny = H / 2 - NODE_H / 2;
      renderNode(g, enNode, nx, ny, true, onNodeSelect);

      const msg = g.append("text")
        .attr("x", W / 2)
        .attr("y", ny + NODE_H + 24)
        .attr("text-anchor", "middle")
        .attr("font-family", "'EB Garamond',serif")
        .attr("font-style", "italic")
        .attr("font-size", 13)
        .attr("fill", "var(--ink3)")
        .text("No etymological ancestors recorded for current filters.");
      return;
    }
    return;
  }

  const { layoutNodes, layoutEdges } = buildLayout(pruned.nodes, pruned.edges);

  // Compute bounding box for zoom-to-fit
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const ln of layoutNodes.values()) {
    minX = Math.min(minX, ln.x);
    maxX = Math.max(maxX, ln.x + NODE_W);
    minY = Math.min(minY, ln.y);
    maxY = Math.max(maxY, ln.y + NODE_H);
  }
  const contentW = maxX - minX;
  const contentH = maxY - minY;
  const PAD = 40;
  const scale = Math.min(
    (W - PAD * 2) / (contentW || 1),
    (H - PAD * 2) / (contentH || 1),
    1.2, // don't over-enlarge tiny graphs
  );
  const tx = (W - contentW * scale) / 2 - minX * scale;
  const ty = (H - contentH * scale) / 2 - minY * scale;
  const initialTransform = d3.zoomIdentity.translate(tx, ty).scale(scale);

  // Defs: arrow markers
  const defs = svg.append("defs");
  Object.entries(EDGE_COLOR).forEach(([t, c]) => {
    defs.append("marker")
      .attr("id", "t-arr-" + t)
      .attr("viewBox", "0 0 10 10")
      .attr("refX", 9)
      .attr("refY", 5)
      .attr("markerWidth", 5)
      .attr("markerHeight", 5)
      .attr("orient", "auto-start-reverse")
      .append("path")
      .attr("d", "M2 1L8 5L2 9")
      .attr("fill", "none")
      .attr("stroke", c)
      .attr("stroke-width", 1.5)
      .attr("stroke-linecap", "round");
  });

  // Root group + zoom
  const g = svg.append("g");
  const zoom = d3.zoom<SVGSVGElement, unknown>()
    .scaleExtent([0.1, 4])
    .on("zoom", (ev) => g.attr("transform", ev.transform));
  svg.call(zoom);
  svg.call(zoom.transform, initialTransform);
  _zoomBehavior = zoom;

  // Depth guide lines (subtle horizontal rules)
  const depthLevels = new Set(Array.from(layoutNodes.values()).map((n) => n.depth));
  const guideG = g.append("g").attr("class", "t-guides");
  for (const d of depthLevels) {
    const y = d * (NODE_H + V_GAP) + NODE_H / 2;
    guideG.append("line")
      .attr("x1", minX - 20)
      .attr("x2", maxX + 20)
      .attr("y1", y)
      .attr("y2", y)
      .attr("stroke", "var(--p3)")
      .attr("stroke-width", 0.5)
      .attr("stroke-dasharray", "3 4")
      .attr("opacity", 0.5);
  }

  // Draw edges
  const edgeG = g.append("g").attr("class", "t-edges");
  const nodeById = new Map(data.nodes.map((n) => [n.id, n]));

  for (const le of layoutEdges) {
    const srcLn = layoutNodes.get(le.src);
    const tgtLn = layoutNodes.get(le.tgt);
    if (!srcLn || !tgtLn) continue;

    const color = EDGE_COLOR[le.type] ?? "#888";
    const dash = EDGE_DASH[le.type] ?? "";

    // S-curve: from bottom-centre of src to top-centre of tgt
    const x1 = srcLn.x + NODE_W / 2;
    const y1 = srcLn.y + NODE_H;
    const x2 = tgtLn.x + NODE_W / 2;
    const y2 = tgtLn.y;
    const my = (y1 + y2) / 2;

    const edgeEl = edgeG.append("path")
      .attr("class", "t-edge")
      .attr("fill", "none")
      .attr("d", `M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}`)
      .attr("stroke", color)
      .attr("stroke-width", le.isPrimary ? 1.5 : 1)
      .attr("stroke-dasharray", dash)
      .attr("opacity", le.isPrimary ? 0.8 : 0.4)
      .attr("marker-end", `url(#t-arr-${le.type})`);

    // Edge type label at midpoint on hover
    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;
    const srcNode = nodeById.get(le.src);
    const tgtNode = nodeById.get(le.tgt);
    const tipText = `${EDGE_LABELS[le.type] ?? le.type}${le.expansion ? ": " + le.expansion : ""}`;

    edgeEl
      .on("mouseover", (ev) => showTip(ev, tipText))
      .on("mouseout", hideTip);
  }

  // Draw nodes
  const nodeG = g.append("g").attr("class", "t-nodes");
  for (const [id, ln] of layoutNodes) {
    const isEn = ln.node.lang === "en";
    renderNode(nodeG, ln.node, ln.x, ln.y, isEn, onNodeSelect);
  }
}

function renderNode(
  container: d3.Selection<SVGGElement, unknown, HTMLElement, any>,
  node: GraphNode,
  x: number,
  y: number,
  isEn: boolean,
  onNodeSelect: (id: string) => void,
): void {
  const lang = getLang(node.lang);
  const color = FAM_COLOR[lang.family ?? ""] ?? "#8B7E6E";
  const proto = isProtoLang(node.lang);

  const grp = container.append("g")
    .attr("class", "t-node")
    .attr("transform", `translate(${x},${y})`)
    .style("cursor", "pointer")
    .on("click", () => onNodeSelect(node.id))
    .on("mouseover", (ev) => showNodeTip(ev, node))
    .on("mouseout", hideTip);

  // Card background
  grp.append("rect")
    .attr("width", NODE_W)
    .attr("height", NODE_H)
    .attr("rx", 5)
    .attr("fill", "var(--p0)")
    .attr("stroke", isEn ? "#B18B3D" : "var(--p3)")
    .attr("stroke-width", isEn ? 2 : 0.75);

  // Left colour bar (family colour)
  grp.append("rect")
    .attr("width", 4)
    .attr("height", NODE_H)
    .attr("rx", 2)
    .attr("fill", color)
    .attr("opacity", 0.85);

  // Proto-language: dashed border overlay
  if (proto) {
    grp.append("rect")
      .attr("width", NODE_W)
      .attr("height", NODE_H)
      .attr("rx", 5)
      .attr("fill", "none")
      .attr("stroke", color)
      .attr("stroke-width", 1)
      .attr("stroke-dasharray", "4 3")
      .attr("opacity", 0.35);
  }

  // Word form
  const wordText = node.word.length > 14 ? node.word.slice(0, 13) + "…" : node.word;
  grp.append("text")
    .attr("x", 12)
    .attr("y", 17)
    .attr("font-family", "'EB Garamond',serif")
    .attr("font-size", isEn ? 14 : 13)
    .attr("font-weight", isEn ? "600" : "500")
    .attr("font-style", proto ? "italic" : "normal")
    .attr("fill", "var(--ink0)")
    .attr("pointer-events", "none")
    .text(wordText);

  // Language name
  const langLabel = lang.name.length > 18 ? lang.name.slice(0, 17) + "…" : lang.name;
  grp.append("text")
    .attr("x", 12)
    .attr("y", 33)
    .attr("font-family", "'IBM Plex Sans',sans-serif")
    .attr("font-size", 8.5)
    .attr("font-weight", "400")
    .attr("fill", "var(--ink3)")
    .attr("pointer-events", "none")
    .text(langLabel);

  // Selected highlight (driven by panel interaction)
  grp.attr("data-node-id", node.id);
}

// ── Highlight selected node ───────────────────────────────────────────────────

export function highlightTreeNode(nodeId: string): void {
  d3.selectAll<SVGGElement, unknown>(".t-node").each(function () {
    const el = d3.select(this);
    const id = (this as SVGGElement).dataset?.nodeId ??
      el.attr("data-node-id");
    const isSelected = id === nodeId;
    el.select("rect:first-child")
      .attr("stroke", isSelected ? "#B18B3D" : undefined)
      .attr("stroke-width", isSelected ? 2 : undefined);
  });
}

// ── Zoom controls ─────────────────────────────────────────────────────────────

export function treeZoom(factor: number): void {
  if (!_zoomBehavior) return;
  d3.select<SVGSVGElement, unknown>("#tree-svg")
    .transition()
    .duration(280)
    .call(_zoomBehavior.scaleBy, factor);
}

export function treeReset(): void {
  if (!_zoomBehavior) return;
  d3.select<SVGSVGElement, unknown>("#tree-svg")
    .transition()
    .duration(350)
    .call(_zoomBehavior.transform, d3.zoomIdentity);
}
