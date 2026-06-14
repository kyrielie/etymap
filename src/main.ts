import { initDb, getWordsByCategory, loadWordDetail, findWordId } from "./db";
import { buildWordSelector, selectByConceptString, getHashConcept } from "./wordSelector";
import { renderGraph, graphZoom, graphReset } from "./graph";
import { renderMap, mapZoom, mapReset, loadWorldTopo } from "./map";
import { updatePanel, selectPanelNode, showLoading, hideLoading, showError, hideError } from "./panel";

// ── App state ─────────────────────────────────────────────────────────────────

type View = "graph" | "map";
let _currentView: View = "graph";
let _currentWordId: number | null = null;
let _filters = new Set<string>(["inh", "bor", "der", "lbor"]);

// ── DB paths ──────────────────────────────────────────────────────────────────
// Use a document-relative URL so this works in dev (served from /) and on
// GitHub Pages where the site lives at /<reponame>/.
const DB_URL = new URL("db/etymap.db", document.baseURI).href;
const WASM_URL = "https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/sql-wasm.wasm";

// ── Boot ──────────────────────────────────────────────────────────────────────

async function boot(): Promise<void> {
  showLoading("Loading database engine…");

  try {
    await Promise.all([
      initDb(DB_URL, WASM_URL, (msg) => showLoading(msg)),
      loadWorldTopo(),
    ]);
  } catch (err) {
    showError(`Failed to load database: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }

  // Populate word selector
  const grouped = getWordsByCategory();
  buildWordSelector(grouped, handleWordSelect);

  hideLoading();

  // Restore from URL hash, or show prompt
  const hash = getHashConcept();
  if (hash) {
    const id = findWordId(hash);
    if (id != null) {
      selectByConceptString(hash);
      await handleWordSelect(id, hash);
      return;
    }
  }

  showLoading("Select a word to begin.");
}

// ── Word selection ────────────────────────────────────────────────────────────

async function handleWordSelect(wordId: number, concept: string): Promise<void> {
  _currentWordId = wordId;
  hideError();

  try {
    const data = loadWordDetail(wordId);
    updatePanel(data);
    renderCurrentView();
  } catch (err) {
    showError(`Could not load "${concept}": ${err instanceof Error ? err.message : String(err)}`);
  }
}

function renderCurrentView(): void {
  if (_currentWordId == null) return;
  const data = loadWordDetail(_currentWordId);

  if (_currentView === "graph") {
    renderGraph(data, _filters, (nodeId) => {
      selectPanelNode(nodeId);
    });
  } else {
    renderMap(data, _filters, (nodeId) => {
      selectPanelNode(nodeId);
    });
  }
}

// ── View toggle ───────────────────────────────────────────────────────────────

function switchView(view: View): void {
  _currentView = view;

  document.getElementById("graph-stage")!.hidden = view !== "graph";
  document.getElementById("map-stage")!.hidden = view !== "map";

  document.querySelectorAll<HTMLButtonElement>(".view-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.view === view);
  });

  renderCurrentView();
}

// ── Filter bar ────────────────────────────────────────────────────────────────

function setupFilters(): void {
  document.querySelectorAll<HTMLInputElement>(".filter-cb").forEach((cb) => {
    const type = cb.dataset.type!;
    const label = cb.closest<HTMLLabelElement>(".fc");
    cb.checked = _filters.has(type);
    label?.classList.toggle("off", !cb.checked);

    cb.addEventListener("change", () => {
      if (cb.checked) _filters.add(type);
      else _filters.delete(type);
      label?.classList.toggle("off", !cb.checked);
      renderCurrentView();
    });
  });
}

// ── Zoom controls ─────────────────────────────────────────────────────────────

function setupZoom(): void {
  document.getElementById("btn-zoom-in")?.addEventListener("click", () => {
    if (_currentView === "graph") graphZoom(1.35);
    else mapZoom(1.35);
  });
  document.getElementById("btn-zoom-out")?.addEventListener("click", () => {
    if (_currentView === "graph") graphZoom(1 / 1.35);
    else mapZoom(1 / 1.35);
  });
  document.getElementById("btn-zoom-reset")?.addEventListener("click", () => {
    if (_currentView === "graph") graphReset();
    else mapReset();
  });
}

// ── View toggle buttons ───────────────────────────────────────────────────────

function setupViewButtons(): void {
  document.querySelectorAll<HTMLButtonElement>(".view-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const view = btn.dataset.view as View;
      if (view) switchView(view);
    });
  });
}

// ── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
  setupFilters();
  setupZoom();
  setupViewButtons();
  boot();
});
