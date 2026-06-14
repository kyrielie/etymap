import type { WordMeta, WordDetail, GraphNode, GraphEdge, GraphCognate, Language } from "./types";

// sql.js is loaded via CDN <script> tag; type it minimally here
declare const initSqlJs: (config: { locateFile: (f: string) => string }) => Promise<SqlJsStatic>;
interface SqlJsStatic { Database: new (data: ArrayBuffer) => SqlDatabase }
interface SqlDatabase {
  exec(sql: string, params?: unknown[]): QueryResult[];
  run(sql: string, params?: unknown[]): void;
  close(): void;
}
interface QueryResult {
  columns: string[];
  values: unknown[][];
}

// ── Module state ─────────────────────────────────────────────────────────────

let _db: SqlDatabase | null = null;
let _wordMetas: WordMeta[] | null = null;
const _wordCache = new Map<number, WordDetail>();
const _langCache = new Map<string, Language>();

// ── Init ─────────────────────────────────────────────────────────────────────

/**
 * Fetches the WASM binary and the .db file, then initialises sql.js.
 * Call once at app startup. Subsequent calls are no-ops.
 */
export async function initDb(
  dbUrl: string,
  wasmUrl: string,
  onProgress?: (msg: string) => void,
): Promise<void> {
  if (_db) return;

  onProgress?.("Loading database engine…");
  const SQL = await initSqlJs({ locateFile: () => wasmUrl });

  onProgress?.("Fetching word database…");
  console.log("[db] Fetching from:", dbUrl);

  let resp: Response;
  try {
    resp = await fetch(dbUrl);
  } catch (err) {
    throw new Error(
      `Network error fetching database from "${dbUrl}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (!resp.ok) {
    throw new Error(
      `Database fetch failed: HTTP ${resp.status} ${resp.statusText} — ` +
      `tried to load "${dbUrl}". ` +
      `Make sure db/etymap.db is in your project root and your dev server serves it.`,
    );
  }

  const contentType = resp.headers.get("content-type") ?? "";
  const buf = await resp.arrayBuffer();

  // sql.js silently creates an empty in-memory DB when given an empty or HTML buffer.
  // Detect this before it produces a confusing "no such table" error.
  if (buf.byteLength === 0) {
    throw new Error(
      `Database file is empty (0 bytes) at "${dbUrl}". Check the file exists and is committed.`,
    );
  }
  if (contentType.includes("text/html")) {
    throw new Error(
      `Database URL "${dbUrl}" returned HTML instead of a binary file (likely a 404 page). ` +
      `Check your dev server is configured to serve the db/ directory.`,
    );
  }

  // Validate SQLite magic bytes: first 6 bytes must be "SQLite"
  const magic = new Uint8Array(buf, 0, 6);
  const magicStr = String.fromCharCode(...magic);
  if (magicStr !== "SQLite") {
    throw new Error(
      `File at "${dbUrl}" is not a valid SQLite database (bad magic bytes: "${magicStr}"). ` +
      `Expected "SQLite format 3".`,
    );
  }

  console.log(`[db] Fetched ${(buf.byteLength / 1024).toFixed(1)} KB`);
  onProgress?.("Opening database…");
  // sql.js requires Uint8Array — passing a raw ArrayBuffer silently produces an empty DB
  _db = new SQL.Database(new Uint8Array(buf));

  // Smoke-test: verify expected tables exist
  const result = _db.exec(
    `SELECT name FROM sqlite_master WHERE type='table' AND name IN ('words','entries','edges','languages') ORDER BY name`,
  );
  const tables = result[0]?.values.flat() ?? [];
  const expected = ["edges", "entries", "languages", "words"];
  const missing = expected.filter((t) => !tables.includes(t));
  if (missing.length) {
    throw new Error(
      `Database is missing expected tables: ${missing.join(", ")}. ` +
      `Found tables: ${tables.join(", ") || "(none)"}`,
    );
  }

  console.log("[db] Initialised successfully — tables:", tables.join(", "));
}

function db(): SqlDatabase {
  if (!_db) throw new Error("Database not initialised — call initDb() first");
  return _db;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function rows(result: QueryResult[]): Record<string, unknown>[] {
  if (!result.length) return [];
  const { columns, values } = result[0];
  return values.map((row) =>
    Object.fromEntries(columns.map((col, i) => [col, row[i]])),
  );
}

function queryRows(sql: string, params: unknown[] = []): Record<string, unknown>[] {
  const result = db().exec(sql, params);
  return rows(result);
}

// ── Language cache ───────────────────────────────────────────────────────────

export function getLang(code: string): Language {
  if (_langCache.has(code)) return _langCache.get(code)!;

  const result = queryRows(
    "SELECT code, name, family, lat, lon, period FROM languages WHERE code = ?",
    [code],
  );

  const lang: Language = result.length
    ? {
        code: result[0].code as string,
        name: result[0].name as string,
        family: result[0].family as string | null,
        lat: result[0].lat as number | null,
        lon: result[0].lon as number | null,
        period: result[0].period as string | null,
      }
    : { code, name: code, family: null, lat: null, lon: null, period: null };

  _langCache.set(code, lang);
  return lang;
}

// ── Word list ────────────────────────────────────────────────────────────────

/**
 * Returns all words grouped by category, sorted alphabetically within each group.
 * Cheap query — only reads the words table.
 */
export function getWordMetas(): WordMeta[] {
  if (_wordMetas) return _wordMetas;

  const result = queryRows(
    `SELECT id, concept, category, route
     FROM words
     ORDER BY category ASC, concept ASC`,
  );

  _wordMetas = result.map((r) => ({
    id: r.id as number,
    concept: r.concept as string,
    category: r.category as string,
    route: r.route as string,
  }));

  return _wordMetas;
}

/**
 * Returns words grouped by category as a Map.
 * Keys are category display strings; values are arrays of WordMeta.
 */
export function getWordsByCategory(): Map<string, WordMeta[]> {
  const metas = getWordMetas();
  const grouped = new Map<string, WordMeta[]>();
  for (const m of metas) {
    const cat = m.category ?? "Uncategorised";
    if (!grouped.has(cat)) grouped.set(cat, []);
    grouped.get(cat)!.push(m);
  }
  return grouped;
}

// ── Word detail ──────────────────────────────────────────────────────────────

/**
 * Loads full etymology data for a word by its DB id.
 * Results are cached in memory — subsequent calls return immediately.
 */
export function loadWordDetail(wordId: number): WordDetail {
  if (_wordCache.has(wordId)) return _wordCache.get(wordId)!;

  // Word metadata
  const wordRows = queryRows(
    "SELECT concept, category, route, summary, origin_status FROM words WHERE id = ?",
    [wordId],
  );
  if (!wordRows.length) throw new Error(`Word id ${wordId} not found`);
  const word = wordRows[0];

  // Entries → GraphNodes
  const entryRows = queryRows(
    `SELECT e.node_key, e.form, e.lang_code, e.pos, e.etym_text, e.is_proto
     FROM entries e
     WHERE e.word_id = ?`,
    [wordId],
  );

  const nodes: GraphNode[] = entryRows.map((e) => {
    const lang = getLang(e.lang_code as string);
    return {
      id: e.node_key as string,
      word: e.form as string,
      lang: e.lang_code as string,
      lang_name: lang.name,
      pos: (e.pos as string) ?? "",
      etym_text: (e.etym_text as string) ?? "",
    };
  });

  // Edges → GraphEdges
  const edgeRows = queryRows(
    `SELECT src_key, tgt_key, rel_type, expansion
     FROM edges
     WHERE word_id = ?`,
    [wordId],
  );

  const edges: GraphEdge[] = edgeRows.map((e) => ({
    src: e.src_key as string,
    tgt: e.tgt_key as string,
    type: e.rel_type as GraphEdge["type"],
    expansion: (e.expansion as string) ?? "",
  }));

  // Cognates
  const cogRows = queryRows(
    `SELECT src_key, tgt_key, expansion
     FROM cognates
     WHERE word_id = ?`,
    [wordId],
  );

  const cognates: GraphCognate[] = cogRows.map((c) => ({
    src: c.src_key as string,
    tgt: c.tgt_key as string,
    expansion: (c.expansion as string) ?? "",
  }));

  const detail: WordDetail = {
    concept: word.concept as string,
    category: word.category as string,
    route: word.route as string,
    summary: (word.summary as string) ?? "",
    origin_status: (word.origin_status as WordDetail["origin_status"]) ?? null,
    nodes,
    edges,
    cognates,
  };

  _wordCache.set(wordId, detail);
  return detail;
}

/** Look up a word by concept string, returns its id or null */
export function findWordId(concept: string): number | null {
  const result = queryRows("SELECT id FROM words WHERE concept = ?", [concept]);
  return result.length ? (result[0].id as number) : null;
}
