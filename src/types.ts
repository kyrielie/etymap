// ── Database row shapes ──────────────────────────────────────────────────────

export interface WordMeta {
  id: number;
  concept: string;
  category: string;       // human-readable display label
  route: string;          // snake_case key used in code
}

export interface Language {
  code: string;
  name: string;
  family: string | null;
  lat: number | null;
  lon: number | null;
  period: string | null;
}

export interface Entry {
  id: number;
  word_id: number;
  node_key: string;
  form: string;
  lang_code: string;
  pos: string | null;
  etym_text: string | null;
  is_proto: boolean;
  is_cognate: boolean;
}

export interface Edge {
  id: number;
  word_id: number;
  src_key: string;
  tgt_key: string;
  rel_type: "inh" | "bor" | "der" | "lbor" | "dbl" | "affix";
  expansion: string | null;
}

export interface Cognate {
  id: number;
  word_id: number;
  src_key: string;
  tgt_key: string;
  expansion: string | null;
}

// ── Assembled graph data (matches current GRAPH_DATA shape) ─────────────────

export interface GraphNode {
  id: string;           // node_key e.g. "la:abacus"
  word: string;
  lang: string;
  lang_name: string;
  pos: string;
  etym_text: string;
}

export interface GraphEdge {
  src: string;
  tgt: string;
  type: Edge["rel_type"] | "cog";
  expansion: string;
}

export interface GraphCognate {
  src: string;
  tgt: string;
  expansion: string;
}

export interface WordDetail {
  concept: string;
  category: string;
  route: string;
  summary: string;
  origin_status: "ESTABLISHED" | "CONTROVERSIAL" | "UNKNOWN" | null;
  nodes: GraphNode[];
  edges: GraphEdge[];
  cognates: GraphCognate[];
}

// ── Route styling ────────────────────────────────────────────────────────────

export type BendSide = "cw" | "ccw";
export type RouteFamily =
  | "sea_trade"
  | "conquest"
  | "intellectual"
  | "land_trade"
  | "indigenous"
  | "heritage"
  | "modern";

export interface RouteStyle {
  family: RouteFamily;
  label: string;           // display name for the family
  curvature: number;       // 0 = straight, 1 = very curved
  bendSide: BendSide;
  strokeDash: string;      // SVG stroke-dasharray value, "" = solid
  color: string;           // hex
  strokeWidth: number;
}
