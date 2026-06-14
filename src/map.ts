import type { WordDetail, GraphNode, RouteStyle } from "./types";
import { getLang } from "./db";
import { getRouteStyle } from "./routes";

declare const d3: typeof import("d3");
declare const topojson: typeof import("topojson-client");

// ── State ─────────────────────────────────────────────────────────────────────

let _zoomBehavior: ReturnType<typeof d3.zoom> | null = null;
let _projection: ReturnType<typeof d3.geoNaturalEarth1> | null = null;
let _worldTopo: object | null = null;

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

// ── Topo fetch (called once from main.ts) ─────────────────────────────────────

export async function loadWorldTopo(): Promise<void> {
  try {
    const resp = await fetch(
      "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json",
    );
    _worldTopo = await resp.json();
  } catch {
    console.warn("[map] World topo unavailable");
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function nodeColor(langCode: string): string {
  const lang = getLang(langCode);
  return FAM_COLOR[lang.family ?? ""] ?? "#6B6B6B";
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

function showTip(
  ev: MouseEvent,
  d: { word: string; lang: string; etym_text?: string },
): void {
  const tip = document.getElementById("tip");
  if (!tip) return;
  const meta = getLang(d.lang);
  document.getElementById("tt-w")!.textContent = d.word;
  document.getElementById("tt-l")!.textContent =
    meta.name + (meta.family ? " · " + meta.family : "");
  document.getElementById("tt-b")!.textContent = (d.etym_text ?? "").slice(
    0,
    130,
  );
  tip.classList.add("on");
  moveTip(ev);
}
function hideTip() {
  document.getElementById("tip")?.classList.remove("on");
}
function moveTip(ev: MouseEvent) {
  const tip = document.getElementById("tip");
  if (!tip) return;
  tip.style.left = Math.min(ev.clientX + 16, window.innerWidth - 265) + "px";
  tip.style.top = Math.max(ev.clientY - 10, 6) + "px";
}

// ── Arc path builder ──────────────────────────────────────────────────────────

/**
 * Calculates the control point for a quadratic bezier curve based on RouteStyle geometry.
 */
function getControlPoint(
  sx: number,
  sy: number,
  tx: number,
  ty: number,
  style: RouteStyle,
): [number, number] {
  const mx = (sx + tx) / 2;
  const my = (sy + ty) / 2;
  const dx = tx - sx,
    dy = ty - sy;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;

  const sign = style.bendSide === "cw" ? 1 : -1;
  const offset = len * style.curvature * sign;

  const nx = -dy / len;
  const ny = dx / len;

  return [mx + nx * offset, my + ny * offset];
}

/** Shorten arc endpoint so arrow doesn't overlap node circle using control point tangent */
function arcEndShortened(
  cx: number,
  cy: number,
  tx: number,
  ty: number,
  r: number,
): [number, number] {
  const tdx = tx - cx,
    tdy = ty - cy;
  const tlen = Math.sqrt(tdx * tdx + tdy * tdy) || 1;
  return [tx - (tdx / tlen) * r, ty - (tdy / tlen) * r];
}

/** Shorten arc startpoint using control point tangent */
function arcStartShortened(
  sx: number,
  sy: number,
  cx: number,
  cy: number,
  r: number,
): [number, number] {
  const tdx = cx - sx,
    tdy = cy - sy;
  const tlen = Math.sqrt(tdx * tdx + tdy * tdy) || 1;
  return [sx + (tdx / tlen) * r, sy + (tdy / tlen) * r];
}

// ── Main render ───────────────────────────────────────────────────────────────

export function renderMap(
  data: WordDetail,
  filters: Set<string>,
  onNodeSelect: (nodeId: string) => void,
): void {
  const svg = d3.select<SVGSVGElement, unknown>("#map-svg");
  svg.selectAll("*").remove();

  const W = svg.node()?.clientWidth ?? 900;
  const H = svg.node()?.clientHeight ?? 600;

  const routeStyle = getRouteStyle(data.route);
  const defs = svg.append("defs");

  // ── FIX BUG 1 & 4: Correctly sized filled triangle markers using userSpaceOnUse units
  const edgeTypes = ["inh", "bor", "der", "lbor", "cog"];
  const edgeColors: Record<string, string> = {
    inh: "#315A78",
    bor: "#8A2E2E",
    der: "#556B4D",
    lbor: "#7B5B2E",
    cog: "#8B7355",
  };
  edgeTypes.forEach((t) => {
    defs
      .append("marker")
      .attr("id", "marr-" + t)
      .attr("viewBox", "0 -5 10 10")
      .attr("refX", 7)
      .attr("refY", 0)
      .attr("markerWidth", 7)
      .attr("markerHeight", 7)
      .attr("markerUnits", "userSpaceOnUse")
      .attr("orient", "auto-start-reverse")
      .append("path")
      .attr("d", "M0,-4L8,0L0,4Z")
      .attr("fill", edgeColors[t]);
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

  // Base background ocean rect (non-zoomable background)
  svg.append("rect").attr("class", "ocean").attr("width", W).attr("height", H);

  // ── FIX BUG 2: Create a single top-level container group for ALL zoomable features
  const gZoomable = svg.append("g").attr("class", "zoomable-content");

  const proj = d3
    .geoNaturalEarth1()
    .scale(W / 6.5)
    .translate([W / 2, H / 2]);
  _projection = proj;

  const path = d3.geoPath().projection(proj);

  // Land layout inside zoomable space
  if (_worldTopo) {
    const countries = topojson.feature(
      _worldTopo as any,
      (_worldTopo as any).objects.countries,
    );
    gZoomable
      .selectAll(".land")
      .data((countries as any).features)
      .enter()
      .append("path")
      .attr("class", "land")
      .attr("d", path as any);
    gZoomable
      .append("path")
      .attr("class", "map-border")
      .datum(
        topojson.mesh(
          _worldTopo as any,
          (_worldTopo as any).objects.countries,
          (a: any, b: any) => a !== b,
        ),
      )
      .attr("d", path as any);
  }

  gZoomable
    .append("path")
    .attr("class", "graticule")
    .datum(d3.geoGraticule()())
    .attr("d", path as any);

  // Arcs and Nodes layers nested sequentially inside gZoomable
  const gArcs = gZoomable.append("g").attr("class", "arcs-layer");
  const gNodes = gZoomable.append("g").attr("class", "nodes-layer");

  // Zoom Setup
  const zoom = d3
    .zoom<SVGSVGElement, unknown>()
    .scaleExtent([0.5, 8])
    .on("zoom", (ev) => {
      // Linearly pass the transformations to the entire uniform world space container.
      // We removed the arc-inverse-scaling here so that nodes, labels, and lines
      // scale purely geographically, exactly mirroring the graph's native behavior.
      gZoomable.attr("transform", ev.transform);
    });
  svg.call(zoom);
  _zoomBehavior = zoom;

  // ── Build geo nodes
  interface GeoNode extends GraphNode {
    lat: number;
    lon: number;
    name: string;
  }
  const geoNodes: GeoNode[] = data.nodes.flatMap((n) => {
    const lang = getLang(n.lang);
    if (lang.lat == null || lang.lon == null) return [];
    return [{ ...n, lat: lang.lat, lon: lang.lon, name: lang.name }];
  });

  const gm = new Map(geoNodes.map((n) => [n.id, n]));

  // ── Build geo edges
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

  // Cognates
  if (filters.has("cog")) {
    data.cognates.slice(0, 30).forEach((cog) => {
      if (!gm.has(cog.src)) return;
      const [lc] = cog.tgt.split(":");
      const lang = getLang(lc);
      if (lang.lat == null) return;
      if (!gm.has(cog.tgt)) {
        const word = cog.tgt.split(":").slice(1).join(":");
        const gn: GeoNode = {
          id: cog.tgt,
          word,
          lang: lc,
          lang_name: lang.name,
          pos: "",
          etym_text: cog.expansion,
          lat: lang.lat,
          lon: lang.lon!,
          name: lang.name,
        };
        geoNodes.push(gn);
        gm.set(cog.tgt, gn);
      }
      visEdges.push({
        src: cog.src,
        tgt: cog.tgt,
        type: "cog",
        expansion: cog.expansion,
      });
    });
  }

  // ── Draw arcs
  visEdges.forEach((edge) => {
    const src = gm.get(edge.src);
    const tgt = gm.get(edge.tgt);
    if (!src || !tgt) return;

    const isCog = edge.type === "cog";
    const baseW = isCog ? 0.8 : routeStyle.strokeWidth;
    const srcR = src.lang === "en" ? 12 : isProtoLang(src.lang) ? 7 : 8;
    const tgtR = tgt.lang === "en" ? 12 : isProtoLang(tgt.lang) ? 7 : 8;

    const [sx, sy] = proj([src.lon, src.lat]) ?? [0, 0];
    const [tx, ty] = proj([tgt.lon, tgt.lat]) ?? [0, 0];

    // ── FIX BUG 3: Capture the exact Bezier curve control point (cpx, cpy)
    const [cpx, cpy] = getControlPoint(sx, sy, tx, ty, routeStyle);

    // Shorten calculations derived directly from the curve's control trajectory tangents
    const [asx, asy] = arcStartShortened(sx, sy, cpx, cpy, srcR);
    const [atx, aty] = arcEndShortened(cpx, cpy, tx, ty, tgtR);

    const arcColor = isCog ? edgeColors.cog : routeStyle.color;
    const arcDash = isCog ? "3 3" : routeStyle.strokeDash;

    // Recalculate control point dynamically relative to truncated parameters to ensure curve integrity
    const [nasx, nasy] = getControlPoint(asx, asy, atx, aty, routeStyle);
    const d = `M${asx},${asy} Q${nasx},${nasy} ${atx},${aty}`;

    gArcs
      .append("path")
      .attr("class", "m-arc")
      .attr("fill", "none")
      .attr("d", d)
      .attr("stroke", arcColor)
      .attr("stroke-width", baseW)
      .attr("stroke-linecap", "round")
      .attr("stroke-dasharray", arcDash)
      .attr("data-base-w", baseW)
      .attr("opacity", isCog ? 0.38 : 0.72)
      .attr("marker-end", isCog ? null : "url(#marr-" + edge.type + ")")
      .on("mouseover", (ev) =>
        showTip(ev, {
          word: `${src.word} → ${tgt.word}`,
          lang: `${src.name} → ${tgt.name}`,
          etym_text: `${edge.type}: ${edge.expansion ?? ""}`,
        }),
      )
      .on("mouseout", hideTip);
  });

  // ── Draw nodes
  const NODE_R = { en: 12, proto: 7, default: 8 };

  geoNodes.forEach((node) => {
    const [px, py] = proj([node.lon, node.lat]) ?? [0, 0];
    const proto = isProtoLang(node.lang);
    const r =
      node.lang === "en" ? NODE_R.en : proto ? NODE_R.proto : NODE_R.default;
    const color = nodeColor(node.lang);

    // Nodes are statically positioned in projection space inside gZoomable, keeping everything tied perfectly together
    const ng = gNodes
      .append("g")
      .attr("class", "m-node-g")
      .attr("transform", `translate(${px},${py})`)
      .style("cursor", "pointer")
      .on("mouseover", (ev) => showTip(ev, node))
      .on("mouseout", hideTip)
      .on("click", () => onNodeSelect(node.id));

    if (proto) {
      ng.append("circle")
        .attr("r", r + 5)
        .attr("fill", "none")
        .attr("stroke", color)
        .attr("stroke-width", 0.7)
        .attr("stroke-dasharray", "2,3")
        .attr("opacity", 0.3);
    }

    ng.append("circle")
      .attr("r", r)
      .attr("fill", color)
      .attr("stroke", node.lang === "en" ? "#2A2620" : "rgba(247,241,227,.7)")
      .attr("stroke-width", node.lang === "en" ? 1.5 : 1)
      .attr("opacity", 0.9);

    if (r >= 10) {
      ng.append("text")
        .attr("text-anchor", "middle")
        .attr("dy", "0.38em")
        .attr("font-family", "'EB Garamond',serif")
        .attr("font-size", r >= 12 ? 9 : 7)
        .attr("font-style", proto ? "italic" : "normal")
        .attr("fill", "rgba(247,241,227,.92)")
        .attr("pointer-events", "none")
        .text(() =>
          node.word.length > 6 ? node.word.slice(0, 5) + "…" : node.word,
        );
    }

    ng.append("text")
      .attr("class", "m-lbl")
      .attr("text-anchor", "middle")
      .attr("dy", r + 10)
      .attr("font-family", "'IBM Plex Sans',sans-serif")
      .attr("font-size", 8)
      .attr("font-weight", "500")
      .attr("letter-spacing", "0.03em")
      .attr("fill", "var(--ink1)")
      .attr("filter", "url(#lbl-halo)")
      .attr("pointer-events", "none")
      .text(() =>
        node.name.length > 14 ? node.name.slice(0, 13) + "…" : node.name,
      );
  });
}

// ── Zoom controls ─────────────────────────────────────────────────────────────

export function mapZoom(factor: number): void {
  if (!_zoomBehavior) return;
  d3.select<SVGSVGElement, unknown>("#map-svg")
    .transition()
    .duration(280)
    .call(_zoomBehavior.scaleBy, factor);
}

export function mapReset(): void {
  if (!_zoomBehavior) return;
  d3.select<SVGSVGElement, unknown>("#map-svg")
    .transition()
    .duration(350)
    .call(_zoomBehavior.transform, d3.zoomIdentity);
}
