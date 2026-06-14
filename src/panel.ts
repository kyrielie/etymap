import type { WordDetail, GraphNode } from "./types";
import { getLang } from "./db";
import { routeToFamilyLabel } from "./routes";

// ── Panel update ──────────────────────────────────────────────────────────────

export function updatePanel(data: WordDetail): void {
  // Header
  setText("panel-concept", data.concept);
  setText("panel-category", data.category ?? routeToFamilyLabel(data.route));
  setText("panel-summary", data.summary ?? "");

  // Origin status badge
  const badge = document.getElementById("panel-origin-badge");
  if (badge) {
    badge.textContent = data.origin_status ?? "";
    badge.className = "origin-badge " + (data.origin_status ?? "").toLowerCase();
    badge.hidden = !data.origin_status;
  }

  // Node list
  const list = document.getElementById("panel-nodes");
  if (list) {
    list.innerHTML = "";
    const sorted = [...data.nodes].sort((a, b) => {
      if (a.lang === "en") return -1;
      if (b.lang === "en") return 1;
      return 0;
    });
    sorted.forEach((n) => {
      const lang = getLang(n.lang);
      const li = document.createElement("li");
      li.className = "panel-node-item";
      li.dataset.nodeId = n.id;

      const form = document.createElement("span");
      form.className = "panel-node-form";
      form.textContent = n.word;

      const meta = document.createElement("span");
      meta.className = "panel-node-meta";
      meta.textContent = lang.name + (n.pos ? " · " + n.pos : "");

      li.appendChild(form);
      li.appendChild(meta);

      if (n.etym_text) {
        const etym = document.createElement("p");
        etym.className = "panel-node-etym";
        etym.textContent = n.etym_text.slice(0, 200) + (n.etym_text.length > 200 ? "…" : "");
        li.appendChild(etym);
      }

      li.addEventListener("click", () => selectPanelNode(n.id));
      list.appendChild(li);
    });
  }

  // Edge summary counts
  updateEdgeCounts(data);
}

export function selectPanelNode(nodeId: string): void {
  document.querySelectorAll(".panel-node-item").forEach((el) => {
    el.classList.toggle("active", (el as HTMLElement).dataset.nodeId === nodeId);
  });
  // Scroll into view
  const active = document.querySelector<HTMLElement>('.panel-node-item.active');
  active?.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function updateEdgeCounts(data: WordDetail): void {
  const counts: Record<string, number> = {};
  data.edges.forEach((e) => {
    counts[e.type] = (counts[e.type] ?? 0) + 1;
  });

  const container = document.getElementById("panel-edge-counts");
  if (!container) return;
  container.innerHTML = "";

  const labels: Record<string, string> = {
    inh: "Inherited", bor: "Borrowed", der: "Derived",
    lbor: "Learned borrowing", dbl: "Doublet", affix: "Affix",
  };

  Object.entries(counts).forEach(([type, count]) => {
    const span = document.createElement("span");
    span.className = "edge-count-pill edge-" + type;
    span.textContent = `${labels[type] ?? type} ×${count}`;
    container.appendChild(span);
  });

  if (data.cognates.length) {
    const span = document.createElement("span");
    span.className = "edge-count-pill edge-cog";
    span.textContent = `Cognates ×${data.cognates.length}`;
    container.appendChild(span);
  }
}

// ── Loading / error states ────────────────────────────────────────────────────

export function showLoading(msg: string): void {
  const el = document.getElementById("panel-loading");
  if (el) { el.textContent = msg; el.hidden = false; }
  const content = document.getElementById("panel-content");
  if (content) content.hidden = true;
}

export function hideLoading(): void {
  const el = document.getElementById("panel-loading");
  if (el) el.hidden = true;
  const content = document.getElementById("panel-content");
  if (content) content.hidden = false;
}

export function showError(msg: string): void {
  const el = document.getElementById("panel-error");
  if (el) { el.textContent = msg; el.hidden = false; }
}

export function hideError(): void {
  const el = document.getElementById("panel-error");
  if (el) el.hidden = true;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function setText(id: string, value: string): void {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}
