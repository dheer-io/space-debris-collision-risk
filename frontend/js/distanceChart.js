// Distance-vs-time chart for a tracked satellite's closest approaches.
// Self-contained: builds its own modal DOM on first use, nothing needed in
// index.html. Reuses createSatrec/propagateEci from conjunctionMath.js —
// the same primitives conjunctionWorker.js uses — sampled on a fixed grid
// here since this is a one-off chart for a handful of objects, not a
// continuous catalog-wide scan.

import { createSatrec, propagateEci } from "../../shared/conjunctionMath.js";

const WINDOW_MINUTES = 5 * 60; // matches the screening window used elsewhere
const SAMPLE_COUNT = 120; // ~2.5 min resolution across the 5h window
const MAX_LINES = 5;

const RISK_COLORS = { critical: "#ff5d73", high: "#ff8a3d", moderate: "#ffcc4d", low: "#3ddc84" };

// Catalog names come from CelesTrak — untrusted-ish text ends up in
// innerHTML below, so this stays duplicated here rather than importing it
// (small enough, and keeps this module usable on its own).
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function distanceKmAt(satrecA, satrecB, date) {
  const a = propagateEci(satrecA, date);
  const b = propagateEci(satrecB, date);
  if (!a || !b) return null; // propagation failure (decayed/invalid orbit) — leave a gap, not a fake 0
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function buildSeries(trackedSatrec, otherSatrec) {
  const now = Date.now();
  const points = [];
  for (let i = 0; i <= SAMPLE_COUNT; i++) {
    const minutes = (i / SAMPLE_COUNT) * WINDOW_MINUTES;
    const date = new Date(now + minutes * 60_000);
    points.push({ minutes, distanceKm: distanceKmAt(trackedSatrec, otherSatrec, date) });
  }
  return points;
}

let modalEl = null;

function ensureModal() {
  if (modalEl) return modalEl;

  modalEl = document.createElement("div");
  modalEl.className = "distance-chart-modal";
  modalEl.innerHTML = `
    <div class="distance-chart-backdrop"></div>
    <div class="distance-chart-panel" role="dialog" aria-modal="true">
      <div class="distance-chart-header">
        <h3 class="distance-chart-title"></h3>
        <button type="button" class="distance-chart-close" aria-label="Close">×</button>
      </div>
      <div class="distance-chart-body"></div>
      <ul class="distance-chart-legend"></ul>
    </div>
  `;
  document.body.appendChild(modalEl);

  modalEl.querySelector(".distance-chart-backdrop").addEventListener("click", hideDistanceChart);
  modalEl.querySelector(".distance-chart-close").addEventListener("click", hideDistanceChart);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") hideDistanceChart();
  });

  return modalEl;
}

export function hideDistanceChart() {
  modalEl?.classList.remove("distance-chart-modal--open");
}

// X = minutes from now (0..WINDOW_MINUTES), Y = distance km. Plain inline
// SVG (no chart library) so this stays dependency-free like the rest of the
// frontend's hand-drawn icons.
function renderChartSvg(series) {
  const width = 640;
  const height = 320;
  const padding = { top: 16, right: 16, bottom: 32, left: 46 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  const allDistances = series.flatMap((s) => s.points.map((p) => p.distanceKm).filter((d) => d !== null));
  // Never compress the y-axis below the 10km screen band — a chart that's
  // all near-critical zoom when everything's actually comfortably "low"
  // would be misleading.
  const maxDistance = Math.max(10, ...allDistances, 0);

  const xForMinutes = (minutes) => padding.left + (minutes / WINDOW_MINUTES) * plotWidth;
  const yForDistance = (distanceKm) => padding.top + plotHeight - (distanceKm / maxDistance) * plotHeight;

  const gridLines = [0, 0.25, 0.5, 0.75, 1]
    .map((t) => {
      const distanceKm = t * maxDistance;
      const y = yForDistance(distanceKm);
      return (
        `<line x1="${padding.left}" y1="${y.toFixed(1)}" x2="${width - padding.right}" y2="${y.toFixed(1)}" class="distance-chart-grid" />` +
        `<text x="${padding.left - 8}" y="${(y + 4).toFixed(1)}" class="distance-chart-axis-label" text-anchor="end">${distanceKm.toFixed(1)}</text>`
      );
    })
    .join("");

  const timeTicks = [0, 60, 120, 180, 240, 300]
    .map((minutes) => {
      const x = xForMinutes(minutes);
      const label = minutes === 0 ? "Now" : `+${minutes / 60}h`;
      return `<text x="${x.toFixed(1)}" y="${height - padding.bottom + 18}" class="distance-chart-axis-label" text-anchor="middle">${label}</text>`;
    })
    .join("");

  // Gaps (propagation failures) split the line into separate segments
  // instead of drawing a straight line across the missing stretch.
  const lines = series
    .map(({ color, points }) => {
      let d = "";
      let penDown = false;
      for (const point of points) {
        if (point.distanceKm === null) {
          penDown = false;
          continue;
        }
        const x = xForMinutes(point.minutes).toFixed(1);
        const y = yForDistance(Math.min(point.distanceKm, maxDistance)).toFixed(1);
        d += `${penDown ? "L" : "M"} ${x} ${y} `;
        penDown = true;
      }
      return `<path d="${d.trim()}" fill="none" stroke="${color}" stroke-width="2" />`;
    })
    .join("");

  return `
    <svg viewBox="0 0 ${width} ${height}" class="distance-chart-svg" role="img">
      <line x1="${padding.left}" y1="${padding.top}" x2="${padding.left}" y2="${height - padding.bottom}" class="distance-chart-axis" />
      <line x1="${padding.left}" y1="${height - padding.bottom}" x2="${width - padding.right}" y2="${height - padding.bottom}" class="distance-chart-axis" />
      ${gridLines}
      ${timeTicks}
      ${lines}
    </svg>
  `;
}

// closeApproaches: the tracked satellite's own worker results (undefined =
// still screening). findObjectByNoradId: (noradId) => catalog entry with
// line1/line2, so this can build the OTHER object's satrec — the worker
// only reports names/distances, not orbital elements, back to the main
// thread.
export function showDistanceChart({ trackedName, trackedNoradId, trackedSatrec, closeApproaches, findObjectByNoradId }) {
  const modal = ensureModal();
  modal.querySelector(".distance-chart-title").textContent = `${trackedName} (#${trackedNoradId}) — distance over the next 5h`;

  const body = modal.querySelector(".distance-chart-body");
  const legend = modal.querySelector(".distance-chart-legend");

  if (closeApproaches === undefined) {
    body.innerHTML = `<p class="distance-chart-empty">Still screening this satellite — try again in a moment.</p>`;
    legend.innerHTML = "";
    modal.classList.add("distance-chart-modal--open");
    return;
  }

  const series = [];
  const legendItems = [];

  for (const approach of closeApproaches.slice(0, MAX_LINES)) {
    const other = findObjectByNoradId(approach.noradId);
    if (!other) continue;
    const otherSatrec = createSatrec(other.line1, other.line2);
    if (!otherSatrec) continue;

    const points = buildSeries(trackedSatrec, otherSatrec);
    const color = RISK_COLORS[approach.risk.level] ?? "#93a2b8";
    series.push({ color, points });
    legendItems.push({ color, name: approach.name, noradId: approach.noradId, riskLabel: approach.risk.label });
  }

  body.innerHTML =
    series.length === 0
      ? `<p class="distance-chart-empty">No close approaches to plot for this satellite right now.</p>`
      : renderChartSvg(series);

  legend.innerHTML = legendItems
    .map(
      (item) =>
        `<li><span class="distance-chart-swatch" style="background:${item.color}"></span>${escapeHtml(item.name)} ` +
        `<span class="id">#${item.noradId}</span><span class="distance-chart-legend-risk">${item.riskLabel}</span></li>`,
    )
    .join("");

  modal.classList.add("distance-chart-modal--open");
}
