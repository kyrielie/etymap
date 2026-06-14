import type { RouteFamily, RouteStyle } from "./types";

// ── Family style profiles ────────────────────────────────────────────────────
// curvature: 0 = straight line, 1 = very high arc
// bendSide: "cw" = curves clockwise (arcs south over ocean), "ccw" = counter
// strokeDash: SVG dasharray string, "" = solid
// These are visual scaffolds — actual historical waypoints will be added later.

const FAMILY_STYLES: Record<RouteFamily, Omit<RouteStyle, "label">> = {
  sea_trade: {
    family: "sea_trade",
    curvature: 0.65,
    bendSide: "ccw",
    strokeDash: "",
    color: "#315A78",
    strokeWidth: 1.8,
  },
  conquest: {
    family: "conquest",
    curvature: 0.35,
    bendSide: "cw",
    strokeDash: "6 3",
    color: "#8A2E2E",
    strokeWidth: 1.6,
  },
  intellectual: {
    family: "intellectual",
    curvature: 0.5,
    bendSide: "ccw",
    strokeDash: "3 4",
    color: "#556B4D",
    strokeWidth: 1.2,
  },
  land_trade: {
    family: "land_trade",
    curvature: 0.2,
    bendSide: "cw",
    strokeDash: "",
    color: "#7B5B2E",
    strokeWidth: 1.4,
  },
  indigenous: {
    family: "indigenous",
    curvature: 0.3,
    bendSide: "ccw",
    strokeDash: "2 4",
    color: "#4A6B35",
    strokeWidth: 1.1,
  },
  heritage: {
    family: "heritage",
    curvature: 0.8,
    bendSide: "ccw",
    strokeDash: "4 5",
    color: "#6B5A78",
    strokeWidth: 1.0,
  },
  modern: {
    family: "modern",
    curvature: 0.05,
    bendSide: "cw",
    strokeDash: "",
    color: "#1A7A6E",
    strokeWidth: 2.2,
  },
};

// ── Route → family mapping ───────────────────────────────────────────────────

const ROUTE_FAMILY: Record<string, RouteFamily> = {
  // Sea trade
  dutch_golden_age_maritime:        "sea_trade",
  portuguese_maritime_exploration:  "sea_trade",
  silk_road_transmission:           "sea_trade",
  manila_galleon_pacific:           "sea_trade",
  cape_horn_maritime:               "sea_trade",
  clipper_route_trade:              "sea_trade",
  malay_indonesian_maritime:        "sea_trade",
  chinese_coastal_treaty_port:      "sea_trade",
  mediterranean_trade:              "sea_trade",
  black_sea_trade:                  "sea_trade",

  // Conquest / colonisation
  norman_conquest_anglo_french:     "conquest",
  spanish_colonial_exchange:        "conquest",
  columbian_exchange:               "conquest",
  russian_imperial_soviet:          "conquest",
  indian_colonial_administration:   "conquest",
  continental_warfare_terminology:  "conquest",

  // Intellectual / elite exchange
  greek_classical_byzantine:        "intellectual",
  islamic_science_renaissance:      "intellectual",
  french_enlightenment_elite_borrowings: "intellectual",
  italian_renaissance_arts:         "intellectual",
  german_intellectual_migration:    "intellectual",
  grand_tour_european_culture:      "intellectual",

  // Land / overland trade
  hanseatic_league_trade:           "land_trade",
  ancient_european_trade_roads:     "land_trade",
  north_sea_germanic_trade:         "land_trade",
  circumpolar_fur_trade:            "land_trade",

  // Indigenous / contact zone
  indigenous_north_american_contact: "indigenous",
  sub_saharan_african_transmission:  "indigenous",
  oceania_pacific_exchange:         "indigenous",
  japanese_meiji_transmission:      "indigenous",

  // Heritage / proto-language
  proto_indo_european_heritage:     "heritage",
  germanic_core_ingvaeonic:         "heritage",
  old_norse_danelaw:                "heritage",
  semitic_scriptural_liturgical:    "heritage",

  // Modern / digital
  telecommunications_broadcast_era: "modern",
  internet_digital_era:             "modern",
};

const FAMILY_LABELS: Record<RouteFamily, string> = {
  sea_trade:    "Sea trade",
  conquest:     "Conquest & colonisation",
  intellectual: "Intellectual & elite exchange",
  land_trade:   "Land & overland trade",
  indigenous:   "Indigenous & contact zone",
  heritage:     "Heritage & proto-language",
  modern:       "Modern & digital",
};

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns the RouteStyle for a given route key.
 * Also logs the resolved style to the console so path geometry
 * can be verified before real waypoints are wired in.
 */
export function getRouteStyle(route: string): RouteStyle {
  const family = ROUTE_FAMILY[route] ?? "heritage";
  const base = FAMILY_STYLES[family];
  const style: RouteStyle = {
    ...base,
    label: FAMILY_LABELS[family],
  };

  // Scaffold: log every arc dispatch so geometry can be validated in devtools
  console.log(
    `[route] ${route} → family: ${family}`,
    `| curvature: ${style.curvature}`,
    `| bendSide: ${style.bendSide}`,
    `| dash: "${style.strokeDash}"`,
    `| color: ${style.color}`,
  );

  return style;
}

/** All unique route families, for legend rendering */
export function getAllFamilyStyles(): RouteStyle[] {
  return (Object.keys(FAMILY_STYLES) as RouteFamily[]).map((f) => ({
    ...FAMILY_STYLES[f],
    label: FAMILY_LABELS[f],
  }));
}

/** Resolve a route key to its family label for display */
export function routeToFamilyLabel(route: string): string {
  const family = ROUTE_FAMILY[route] ?? "heritage";
  return FAMILY_LABELS[family];
}
