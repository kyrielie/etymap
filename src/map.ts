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
  document.getElementById("tt-b")!.textContent =
    (d.etym_text ?? "").slice(0, 130) +
    ((d.etym_text ?? "").length > 130 ? "…" : "");
  tip.classList.add("on");

  const tipW = tip.offsetWidth || 255;
  tip.style.left =
    Math.min(ev.clientX + 16, window.innerWidth - tipW - 10) + "px";
  tip.style.top = Math.max(ev.clientY - 10, 6) + "px";
}

function hideTip() {
  document.getElementById("tip")?.classList.remove("on");
}

// ── Math Helpers ──────────────────────────────────────────────────────────────

function arcEndShortened(
  sx: number,
  sy: number,
  mx: number,
  my: number,
  tx: number,
  ty: number,
  r: number,
): [number, number] {
  const tdx = tx - mx,
    tdy = ty - my;
  const tlen = Math.sqrt(tdx * tdx + tdy * tdy) || 1;
  return [tx - (tdx / tlen) * r, ty - (tdy / tlen) * r];
}

function arcStartShortened(
  sx: number,
  sy: number,
  mx: number,
  my: number,
  tx: number,
  ty: number,
  r: number,
): [number, number] {
  const tdx = mx - sx,
    tdy = my - sy;
  const tlen = Math.sqrt(tdx * tdx + tdy * tdy) || 1;
  return [sx + (tdx / tlen) * r, sy + (tdy / tlen) * r];
}

// ── Main Render ───────────────────────────────────────────────────────────────

export function renderMap(
  data: WordDetail,
  filters: Set<string>,
  onNodeSelect: (nodeId: string) => void,
): void {
  const svg = d3.select<SVGSVGElement, unknown>("#map-svg");
  svg.selectAll("*").remove();

  const W = svg.node()?.clientWidth ?? 900;
  const H = svg.node()?.clientHeight ?? 600;

  const defs = svg.append("defs");
  const edgeColors: Record<string, string> = {
    inh: "#315A78",
    bor: "#8A2E2E",
    der: "#556B4D",
    lbor: "#7B5B2E",
    cog: "#8B7355",
  };

  Object.entries(edgeColors).forEach(([t, c]) => {
    defs
      .append("marker")
      .attr("id", "marr-" + t)
      .attr("viewBox", "0 -2.5 6 5")
      .attr("refX", 6)
      .attr("refY", 0)
      .attr("markerWidth", 5)
      .attr("markerHeight", 5)
      .attr("orient", "auto")
      .attr("markerUnits", "strokeWidth")
      .append("path")
      .attr("d", "M0,-2.5L6,0L0,2.5Z")
      .attr("fill", c);
  });

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

  // Layer architecture matches v5 perfectly
  const gBase = svg.append("g").attr("class", "map-base");
  const gArcs = svg.append("g").attr("class", "map-arcs");
  const gNodes = svg.append("g").attr("class", "map-nodes");

  const proj = d3
    .geoNaturalEarth1()
    .scale(W / 6.5)
    .translate([W / 2, H / 2 + 20]);
  _projection = proj;
  const pathGen = d3.geoPath().projection(proj);

  // Base map
  gBase
    .append("path")
    .datum({ type: "Sphere" })
    .attr("fill", "var(--ocean)")
    .attr("d", pathGen as any);
  gBase
    .append("path")
    .datum(d3.geoGraticule().step([30, 30])())
    .attr("fill", "none")
    .attr("stroke", "rgba(110,143,163,.25)")
    .attr("stroke-width", 0.3)
    .attr("d", pathGen as any);

  if (_worldTopo) {
    const land = topojson.feature(
      _worldTopo as any,
      (_worldTopo as any).objects.countries,
    );
    gBase
      .append("g")
      .selectAll("path")
      .data((land as any).features)
      .join("path")
      .attr("fill", "var(--land)")
      .attr("stroke", "var(--land-stroke)")
      .attr("stroke-width", 0.4)
      .attr("d", pathGen as any);
    gBase
      .append("path")
      .datum(
        topojson.mesh(
          _worldTopo as any,
          (_worldTopo as any).objects.countries,
          (a: any, b: any) => a !== b,
        ),
      )
      .attr("fill", "none")
      .attr("stroke", "var(--land-stroke)")
      .attr("stroke-width", 0.35)
      .attr("d", pathGen as any);
  }

  // Data processing
  interface GeoNode extends GraphNode {
    lat: number;
    lon: number;
    name: string;
  }
  const gm = new Map<string, GeoNode>();

  data.nodes.forEach((n) => {
    const meta = getLang(n.lang);
    if (meta.lat != null)
      gm.set(n.id, { ...n, lat: meta.lat, lon: meta.lon!, name: meta.name });
  });

  const seen = new Set<string>();
  const visEdges = data.edges.filter((e) => {
    const t = e.type;
    const ok =
      (t === "lbor" && (filters.has("lbor") || filters.has("bor"))) ||
      filters.has(t);
    if (!ok || !gm.has(e.src) || !gm.has(e.tgt)) return false;
    const k = e.src + "|" + e.tgt;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  if (filters.has("cog")) {
    data.cognates.slice(0, 30).forEach((cog) => {
      const [lc] = cog.tgt.split(":");
      const meta = getLang(lc);
      if (meta.lat == null || !gm.has(cog.src)) return;
      if (!gm.has(cog.tgt)) {
        const word = cog.tgt.split(":").slice(1).join(":");
        gm.set(cog.tgt, {
          id: cog.tgt,
          word,
          lang: lc,
          lang_name: meta.name,
          pos: "",
          etym_text: cog.expansion,
          lat: meta.lat,
          lon: meta.lon!,
          name: meta.name,
        });
      }
      visEdges.push({
        src: cog.src,
        tgt: cog.tgt,
        type: "cog",
        expansion: cog.expansion,
      });
    });
  }

  const geoNodes = Array.from(gm.values());

  // Nodes render
  const NODE_R = { en: 12, proto: 7, default: 8 };

  const nSel = gNodes
    .selectAll<SVGGElement, GeoNode>(".m-node-g")
    .data(geoNodes)
    .join("g")
    .attr("class", "m-node-g")
    .style("cursor", "pointer")
    .on("mouseover", (ev, d) => showTip(ev, d))
    .on("mouseout", hideTip)
    .on("click", (ev, d) => onNodeSelect(d.id));

  nSel.each(function (d) {
    const el = d3.select(this);
    const proto = isProtoLang(d.lang);
    const r =
      d.lang === "en" ? NODE_R.en : proto ? NODE_R.proto : NODE_R.default;

    if (proto) {
      el.append("circle")
        .attr("r", r + 5)
        .attr("fill", "none")
        .attr("stroke", nodeColor(d.lang))
        .attr("stroke-width", 0.7)
        .attr("stroke-dasharray", "2,3")
        .attr("opacity", 0.3);
    }
    el.append("circle")
      .attr("r", r)
      .attr("fill", nodeColor(d.lang))
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
        .text(d.word.length > 6 ? d.word.slice(0, 5) + "…" : d.word);
    }

    // FIX: Using explicit #3A352D to fix text coloring mismatch from var(--ink1)
    el.append("text")
      .attr("class", "m-lbl")
      .attr("text-anchor", "middle")
      .attr("dy", r + 10)
      .attr("font-family", "'IBM Plex Sans',sans-serif")
      .attr("font-size", 8)
      .attr("font-weight", "500")
      .attr("letter-spacing", "0.03em")
      .attr("fill", "#3A352D")
      .attr("filter", "url(#lbl-halo)")
      .attr("pointer-events", "none")
      .text(d.name.length > 14 ? d.name.slice(0, 13) + "…" : d.name);
  });

  // Arcs render
  const eSel = gArcs
    .selectAll<SVGPathElement, (typeof visEdges)[0]>(".m-arc")
    .data(visEdges)
    .join("path")
    .attr("class", "m-arc")
    .attr("fill", "none")
    .attr("stroke", (d) =>
      d.type === "cog" ? edgeColors.cog : edgeColors[d.type] || "#888",
    )
    .attr("stroke-linecap", "round")
    .attr("stroke-width", (d) => (d.type === "cog" ? 0.8 : 1.6))
    .attr("opacity", (d) => (d.type === "cog" ? 0.38 : 0.72))
    .attr("stroke-dasharray", (d) => (d.type === "cog" ? "4,4" : null))
    .attr("marker-end", (d) =>
      d.type === "cog" ? null : `url(#marr-${d.type})`,
    )
    .on("mouseover", (ev, d) => {
      const src = gm.get(d.src)!,
        tgt = gm.get(d.tgt)!;
      showTip(ev, {
        word: `${src.word} → ${tgt.word}`,
        lang: `${src.name} → ${tgt.name}`,
        etym_text: `${d.type}: ${d.expansion ?? ""}`,
      });
    })
    .on("mouseout", hideTip);

  // Dynamic zoom positioning logic ported from v5
  function repositionNodes(k: number, tx: number, ty: number) {
    nSel.attr("transform", (d) => {
      const [px, py] = proj([d.lon, d.lat]) ?? [0, 0];
      return `translate(${px * k + tx},${py * k + ty})`;
    });

    eSel.attr("d", (d) => {
      const src = gm.get(d.src)!,
        tgt = gm.get(d.tgt)!;
      const srcR = src.lang === "en" ? 12 : isProtoLang(src.lang) ? 7 : 8;
      const tgtR = tgt.lang === "en" ? 12 : isProtoLang(tgt.lang) ? 7 : 8;

      const ps = proj([src.lon, src.lat]),
        pt = proj([tgt.lon, tgt.lat]);
      if (!ps || !pt) return "";

      const sx = ps[0] * k + tx,
        sy = ps[1] * k + ty;
      const tx2 = pt[0] * k + tx,
        ty2 = pt[1] * k + ty;
      const dx = tx2 - sx,
        dy = ty2 - sy;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;

      const curve = Math.min(dist * (d.type === "cog" ? 0.2 : 0.25), 55);
      const mx = (sx + tx2) / 2 - (dy / dist) * curve;
      const my = (sy + ty2) / 2 + (dx / dist) * curve;

      const [ex, ey] = arcEndShortened(sx, sy, mx, my, tx2, ty2, tgtR);
      const [startX, startY] = arcStartShortened(
        sx,
        sy,
        mx,
        my,
        tx2,
        ty2,
        srcR,
      );

      return `M${startX},${startY} Q${mx},${my} ${ex},${ey}`;
    });
  }

  const zoom = d3
    .zoom<SVGSVGElement, unknown>()
    .scaleExtent([0.4, 14])
    .on("zoom", (ev) => {
      gBase.attr("transform", ev.transform);
      repositionNodes(ev.transform.k, ev.transform.x, ev.transform.y);
    });

  svg.call(zoom);
  _zoomBehavior = zoom;
  repositionNodes(1, 0, 0);
}

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
