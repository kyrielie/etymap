import type { WordMeta } from "./types";

type SelectHandler = (wordId: number, concept: string) => void;

let _onSelect: SelectHandler | null = null;
let _allMetas: WordMeta[] = [];

// ── Build DOM ─────────────────────────────────────────────────────────────────

/**
 * Replaces the #word-selector-container element with a grouped
 * <select> and a search <input>.
 */
export function buildWordSelector(
  grouped: Map<string, WordMeta[]>,
  onSelect: SelectHandler,
): void {
  _onSelect = onSelect;
  _allMetas = [...grouped.values()].flat();

  const container = document.getElementById("word-selector-container");
  if (!container) throw new Error("Missing #word-selector-container in HTML");

  // Search input
  const search = document.createElement("input");
  search.type = "search";
  search.id = "word-search";
  search.placeholder = "Search words…";
  search.autocomplete = "off";
  search.spellcheck = false;
  search.setAttribute("aria-label", "Search words");

  // Select
  const select = document.createElement("select");
  select.id = "word-select";
  select.setAttribute("aria-label", "Select a word");

  // Placeholder option
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Choose a word…";
  placeholder.disabled = true;
  placeholder.selected = true;
  select.appendChild(placeholder);

  // Optgroups by category
  for (const [category, metas] of grouped) {
    const group = document.createElement("optgroup");
    group.label = category;
    for (const m of metas) {
      const opt = document.createElement("option");
      opt.value = String(m.id);
      opt.dataset.concept = m.concept;
      opt.textContent = m.concept;
      group.appendChild(opt);
    }
    select.appendChild(group);
  }

  container.innerHTML = "";
  container.appendChild(search);
  container.appendChild(select);

  // Wire events
  select.addEventListener("change", () => {
    const id = Number(select.value);
    const meta = _allMetas.find((m) => m.id === id);
    if (meta) handleSelect(id, meta.concept);
  });

  search.addEventListener("input", () => filterOptions(search.value.trim()));
  search.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      search.value = "";
      filterOptions("");
    }
  });
}

// ── Filter ────────────────────────────────────────────────────────────────────

function filterOptions(query: string): void {
  const select = document.getElementById("word-select") as HTMLSelectElement | null;
  if (!select) return;

  const q = query.toLowerCase();

  let visibleGroups = 0;
  for (const group of Array.from(select.querySelectorAll("optgroup"))) {
    let visibleOptions = 0;
    for (const opt of Array.from(group.querySelectorAll("option"))) {
      const match = !q || (opt.textContent ?? "").toLowerCase().includes(q);
      // hide/show via disabled + CSS — can't truly hide <option> cross-browser
      (opt as HTMLOptionElement).hidden = !match;
      if (match) visibleOptions++;
    }
    (group as HTMLOptGroupElement).hidden = visibleOptions === 0;
    if (visibleOptions > 0) visibleGroups++;
  }

  // If exactly one option visible and user pressed Enter — auto-select it
  if (visibleGroups === 1) {
    const visible = Array.from(select.querySelectorAll("option:not([disabled])")).filter(
      (o) => !(o as HTMLOptionElement).hidden,
    ) as HTMLOptionElement[];
    if (visible.length === 1) {
      select.value = visible[0].value;
      const id = Number(visible[0].value);
      const concept = visible[0].dataset.concept ?? "";
      handleSelect(id, concept);
    }
  }
}

// ── Selection ─────────────────────────────────────────────────────────────────

function handleSelect(id: number, concept: string): void {
  // Sync URL hash
  history.replaceState(null, "", `#${encodeURIComponent(concept)}`);
  _onSelect?.(id, concept);
}

/** Programmatically select a word by concept string */
export function selectByConceptString(concept: string): void {
  const select = document.getElementById("word-select") as HTMLSelectElement | null;
  if (!select) return;
  const opt = select.querySelector<HTMLOptionElement>(`option[data-concept="${CSS.escape(concept)}"]`);
  if (opt) {
    select.value = opt.value;
  }
}

/** Read initial selection from URL hash, returns concept string or null */
export function getHashConcept(): string | null {
  const hash = location.hash.slice(1);
  return hash ? decodeURIComponent(hash) : null;
}
