// Satellite search/tracking UI + Three.js markers/orbit rings. Orbital math
// itself lives in orbitalMechanics.js.

import * as THREE from "three";
import { createSphereLine } from "./threeGeoJSON.js";
import { createSatrec, propagateToGeodetic, computeOrbitPath, EARTH_RADIUS_KM } from "./orbitalMechanics.js";
import { RISK_BANDS, MIN_REPORTABLE_KM, CONJUNCTION_SCREEN_KM, orbitalAltitudeBand } from "../../shared/conjunctionMath.js";
import { showDistanceChart } from "./distanceChart.js";

const MAX_SELECTIONS = 8;

// The backend's calculated, catalog-wide critical-risk feed (see
// backend/src/routes/alerts.js) — independent of what's tracked in this
// browser tab. Hardcoded rather than derived from window.location since
// the frontend (GitHub Pages) and backend (Vercel) are deployed
// separately; point this at your own deployed backend if it differs.
const ALERTS_API_URL = "https://satellite-risk.vercel.app/api/alerts";
const ALERTS_POLL_INTERVAL_MS = 60_000;

// Position/marker refresh cadence — slower than 60fps on purpose, cheap on SGP4 work.
const POSITION_UPDATE_INTERVAL_MS = 200;

// Auto-selected on first catalog load, in order, whichever names are present.
const DEFAULT_SEARCH_TERMS = ["ISS (ZARYA)", "TIANHE", "TIANGONG", "HST", "ENVISAT", "CSS"];
const DEFAULT_SELECTION_COUNT = 2;

// Cycled per selection so tracked objects stay visually distinguishable.
const SELECTION_COLORS = [0x4d9fff, 0xff5d73, 0x8ee6b8, 0xffb84d, 0xc792ea, 0x4dd0ff];

// One color per risk level, plus "clear" for no close approach.
const RISK_COLORS = { critical: "#ff5d73", high: "#ff8a3d", moderate: "#ffcc4d", low: "#3ddc84", clear: "#3ddc84" };

// Zoom floor, world units — camera.near(1) + globeRadius(2), see index.js.
const MIN_ZOOM_DISTANCE_WORLD_UNITS = 3;
// Margin kept past a tracked satellite's own orbit once that's the binding constraint.
const SATELLITE_ZOOM_MARGIN = 1.5;
// Zoom range always preserved once a high orbit pushes the floor up (see updateMinZoomDistance).
const MIN_ZOOM_RANGE_WORLD_UNITS = 4;

// Escapes untrusted text (catalog names come from CelesTrak) before it's
// interpolated into innerHTML markup elsewhere in this file.
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function initSatelliteLayer({ globeGroup, globeRadius, controls }) {
  // Matches the axis realignment threeGeoJSON.js applies to landmasses/borders.
  const layerGroup = new THREE.Group();
  layerGroup.rotation.x = -Math.PI * 0.5;
  globeGroup.add(layerGroup);

  // Shared geometry — only the material (color) differs per marker.
  const markerGeometry = new THREE.SphereGeometry(globeRadius * 0.015, 12, 12);

  const searchInput = document.getElementById("satellite-search-input");
  const resultsEl = document.getElementById("satellite-search-results");
  const trackingEl = document.getElementById("satellite-tracking-list");
  const trackingEmptyEl = document.getElementById("satellite-tracking-empty");
  const trackedCountEl = document.getElementById("satellite-tracked-count");
  const timeScrubSlider = document.getElementById("time-scrub-slider");
  const timeScrubLabel = document.getElementById("time-scrub-label");
  const timeScrubReset = document.getElementById("time-scrub-reset");
  const riskListEl = document.getElementById("risk-list");
  const riskListEmptyEl = document.getElementById("risk-list-empty");

  let catalog = [];
  let catalogPromise = null;
  const selections = new Map(); // norad_id -> Selection
  // Monotonic, never decrements — deriving color from selections.size instead
  // would reuse a still-tracked color the moment anything was deselected
  // (e.g. track A, track B, deselect A, track C: C would collide with B).
  let colorCursor = 0;
  let lastPositionUpdate = 0;

  // Runs conjunction screening (tracked satellites vs. the full catalog) off
  // the main thread — see conjunctionWorker.js. Classic (non-module) worker
  // for Firefox <114 compatibility (module workers weren't supported before).
  const conjunctionWorker = new Worker(new URL("./conjunctionWorker.js", import.meta.url));
  const conjunctionResults = new Map();

  conjunctionWorker.onerror = (event) => {
    console.error("Conjunction worker failed to load:", event.message || event);
  };

  conjunctionWorker.onmessage = (event) => {
    if (event.data.type === "error") {
      console.error(`Conjunction worker error (${event.data.context}):`, event.data.message);
      return;
    }
    if (event.data.type === "catalogReady") {
      console.log(
        `Conjunction worker: catalog ready (${event.data.screenableCount}/${event.data.objectCount} objects screenable).`
      );
      return;
    }
    if (event.data.type === "result") {
      console.log(
        `Conjunction worker: ${event.data.closeApproaches.length} close approach(es) for ${event.data.name}.`
      );
      // Only keep it if still tracked — worker may still be mid-screen for a deselected satellite.
      if (!selections.has(event.data.noradId)) return;
      conjunctionResults.set(event.data.noradId, { name: event.data.name, closeApproaches: event.data.closeApproaches });
      renderRiskAndConjunctions();
    }
  };

  // Sends the full tracked set (not a diff) — cheap enough at MAX_SELECTIONS (8).
  function syncConjunctionTracking() {
    conjunctionWorker.postMessage({ type: "setTracked", noradIds: [...selections.keys()] });
  }

  // How far ahead of real time tracked markers are drawn, via the Time Scrub
  // slider. Orbit rings stay fixed (frozen snapshot at selection time).
  let timeOffsetMs = 0;
  const TIME_SCRUB_MAX_MINUTES = 300; // 5h — matches the slider's max attribute

  searchInput?.addEventListener("input", () => renderSearchResults(searchInput.value));
  timeScrubSlider?.addEventListener("input", () => applyTimeScrub(Number(timeScrubSlider.value)));
  timeScrubReset?.addEventListener("click", () => {
    if (timeScrubSlider) timeScrubSlider.value = "0";
    applyTimeScrub(0);
  });

  // Delegated — Close Approaches folder "+" buttons are re-created on every render.
  document.getElementById("conjunctions-feed")?.addEventListener("click", (event) => {
    const addButton = event.target.closest(".feed-item-add");
    if (!addButton) return;
    const noradId = Number(addButton.dataset.noradId);
    const object = catalog.find((entry) => entry.norad_id === noradId);
    if (!object) return;
    select(object);
  });

  function formatTimeOffset(minutes) {
    if (minutes <= 0) return "Now";
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (h === 0) return `+${m}m`;
    if (m === 0) return `+${h}h`;
    return `+${h}h ${m}m`;
  }

  function applyTimeScrub(minutes) {
    timeOffsetMs = minutes * 60_000;
    if (timeScrubLabel) timeScrubLabel.textContent = formatTimeOffset(minutes);
    if (timeScrubReset) timeScrubReset.disabled = minutes === 0;
    if (timeScrubSlider) {
      timeScrubSlider.style.setProperty("--fill", `${(minutes / TIME_SCRUB_MAX_MINUTES) * 100}%`);
    }
    lastPositionUpdate = 0; // bypass the throttle so dragging feels immediate
  }

  async function loadCatalogOnce() {
    if (catalogPromise) return catalogPromise;

    catalogPromise = fetch("../../data/raw/tle-latest.json")
      .then((response) => response.json())
      .then((data) => {
        // Precomputed once — avoids re-lowercasing every name on every keystroke.
        catalog = data.objects.map((object) => ({
          ...object,
          nameLower: object.name.toLowerCase(),
          noradIdStr: String(object.norad_id),
        }));
        selectDefaults();
      })
      .catch((error) => {
        console.warn("Could not load satellite catalog:", error.message);
      });

    return catalogPromise;
  }

  function selectDefaults() {
    for (const term of DEFAULT_SEARCH_TERMS) {
      if (selections.size >= DEFAULT_SELECTION_COUNT) break;
      const termLower = term.toLowerCase();
      const match = catalog.find((object) => object.nameLower === termLower);
      if (match) select(match);
    }

    // Fill any remaining slots with payload-type objects (small/incomplete catalog fallback).
    for (const object of catalog) {
      if (selections.size >= DEFAULT_SELECTION_COUNT) break;
      if (object.type === "payload") select(object);
    }
  }

  function searchCatalog(query) {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return [];

    return catalog
      .filter((object) => object.nameLower.includes(normalized) || object.noradIdStr.includes(normalized))
      .slice(0, 20);
  }

  function renderSearchResults(query) {
    const matches = searchCatalog(query);
    resultsEl.innerHTML = "";

    for (const object of matches) {
      const item = document.createElement("li");
      const isSelected = selections.has(object.norad_id);
      item.className = "satellite-result" + (isSelected ? " satellite-result--selected" : "");
      item.textContent = `${object.name} · #${object.norad_id}`;
      item.addEventListener("click", () => {
        select(object);
        // Clear + close results so the tracking card isn't pushed below the fold on mobile.
        searchInput.value = "";
        resultsEl.innerHTML = "";
      });
      resultsEl.appendChild(item);
    }
  }

  function select(object) {
    if (selections.has(object.norad_id)) return;
    if (selections.size >= MAX_SELECTIONS) {
      console.warn(`Tracking limit reached (${MAX_SELECTIONS}) — deselect something first.`);
      return;
    }

    const satrec = createSatrec(object.line1, object.line2);
    if (!satrec) {
      console.warn(`Could not compute orbit for "${object.name}" — invalid TLE.`);
      return;
    }

    const color = SELECTION_COLORS[colorCursor % SELECTION_COLORS.length];
    colorCursor += 1;

    const marker = new THREE.Mesh(markerGeometry, new THREE.MeshBasicMaterial({ color }));
    layerGroup.add(marker);

    // gmstSnapshot also drives this object's live position updates (see update()) —
    // reusing it keeps the marker glued to its own orbit ring instead of drifting off.
    const { points: orbitPoints, gmstSnapshot } = computeOrbitPath(satrec, new Date(), globeRadius);
    const orbitLine = createSphereLine(orbitPoints, { color, opacity: 0.5, linewidth: 1 });
    layerGroup.add(orbitLine);

    const card = buildTrackingCard(object, color, () => deselect(object.norad_id));
    trackingEl.appendChild(card.element);

    selections.set(object.norad_id, { object, satrec, gmstSnapshot, marker, orbitLine, card });
    trackingEmptyEl.hidden = selections.size > 0;
    updateTrackedCount();
    syncConjunctionTracking();
    renderRiskAndConjunctions(); // immediate feedback — its own "Screening…" row shows right away
    updateMinZoomDistance();
  }

  function deselect(noradId) {
    const selection = selections.get(noradId);
    if (!selection) return;

    layerGroup.remove(selection.marker, selection.orbitLine);
    // Not marker.geometry — shared across every marker (see markerGeometry above).
    selection.marker.material.dispose();
    selection.orbitLine.geometry.dispose();
    selection.orbitLine.material.dispose();
    selection.card.element.remove();

    selections.delete(noradId);
    conjunctionResults.delete(noradId);
    expandedRiskItems.delete(noradId);
    expandedApproachFolders.delete(noradId);
    trackingEmptyEl.hidden = selections.size > 0;
    updateTrackedCount();
    syncConjunctionTracking();
    renderRiskAndConjunctions();
    updateMinZoomDistance();
  }

  // Keeps OrbitControls from zooming closer than the HIGHEST tracked
  // satellite's perigee — the highest, since staying outside a low orbit
  // says nothing about a higher tracked one. perigeeKm is already a radial
  // distance from Earth's center, so it converts to world units directly.
  const baseMaxZoomDistance = controls ? controls.maxDistance : Infinity;

  function updateMinZoomDistance() {
    if (!controls) return;

    let maxPerigeeKm = null;
    for (const selection of selections.values()) {
      const { perigeeKm } = orbitalAltitudeBand(selection.satrec);
      maxPerigeeKm = maxPerigeeKm === null ? perigeeKm : Math.max(maxPerigeeKm, perigeeKm);
    }

    const worldUnitsPerKm = globeRadius / EARTH_RADIUS_KM;
    const satelliteMinDistance = maxPerigeeKm === null ? 0 : maxPerigeeKm * worldUnitsPerKm * SATELLITE_ZOOM_MARGIN;
    const minDistance = Math.max(MIN_ZOOM_DISTANCE_WORLD_UNITS, satelliteMinDistance);

    // Grow the ceiling to match rather than clamping the floor down against a
    // fixed max — otherwise a MEO/GEO orbit can squeeze the zoom range to ~0.
    controls.minDistance = minDistance;
    controls.maxDistance = Math.max(baseMaxZoomDistance, minDistance + MIN_ZOOM_RANGE_WORLD_UNITS);
  }

  function updateTrackedCount() {
    if (!trackedCountEl) return;
    trackedCountEl.textContent = `${selections.size} tracked`;
  }

  // Cards open collapsed and expand on click/tap to show live stats.
  function buildTrackingCard(object, color, onRemove) {
    const element = document.createElement("li");
    element.className = "satellite-card";
    element.style.setProperty("--satellite-color", `#${color.toString(16).padStart(6, "0")}`);

    const safeName = escapeHtml(object.name);
    element.innerHTML = `
      <div class="satellite-card-header">
        <span class="satellite-card-dot"></span>
        <span class="satellite-card-name">${safeName}</span>
        <button
          type="button"
          class="satellite-card-chart-btn"
          aria-label="Plot distance over time for ${safeName}"
          title="Distance-over-time chart"
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M2 13V9M6 13V5M10 13V7M14 13V3" stroke-linecap="round" />
          </svg>
        </button>
        <span class="satellite-card-id">#${object.norad_id}</span>
        <button type="button" class="satellite-card-remove" aria-label="Stop tracking ${safeName}">×</button>
      </div>
      <dl class="satellite-card-stats">
        <dt>Lat</dt><dd data-field="lat">—</dd>
        <dt>Lon</dt><dd data-field="lon">—</dd>
        <dt>Alt</dt><dd data-field="alt">—</dd>
      </dl>
    `;

    element.querySelector(".satellite-card-header").addEventListener("click", (event) => {
      if (event.target.closest(".satellite-card-remove") || event.target.closest(".satellite-card-chart-btn")) return;
      element.classList.toggle("satellite-card--expanded");
    });
    element.querySelector(".satellite-card-remove").addEventListener("click", onRemove);
    // Reads selections/conjunctionResults/catalog live at click time (not
    // at card-build time) — worker results and the catalog both arrive
    // asynchronously after this card already exists.
    element.querySelector(".satellite-card-chart-btn").addEventListener("click", () => {
      const selection = selections.get(object.norad_id);
      if (!selection) return;
      showDistanceChart({
        trackedName: object.name,
        trackedNoradId: object.norad_id,
        trackedSatrec: selection.satrec,
        closeApproaches: conjunctionResults.get(object.norad_id)?.closeApproaches,
        findObjectByNoradId: (noradId) => catalog.find((entry) => entry.norad_id === noradId),
      });
    });

    return {
      element,
      latField: element.querySelector("[data-field='lat']"),
      lonField: element.querySelector("[data-field='lon']"),
      altField: element.querySelector("[data-field='alt']"),
    };
  }

  // Runs every frame from animate(), but SGP4 work is throttled to POSITION_UPDATE_INTERVAL_MS.
  function update(now) {
    if (selections.size === 0) return;
    if (now - lastPositionUpdate < POSITION_UPDATE_INTERVAL_MS) return;
    lastPositionUpdate = now;

    const date = new Date(now + timeOffsetMs);

    for (const selection of selections.values()) {
      // gmstOverride reuses this object's frozen orbit-ring snapshot instead of live time.
      const result = propagateToGeodetic(selection.satrec, date, globeRadius, selection.gmstSnapshot);
      if (!result) continue;

      selection.marker.position.copy(result.spherePosition);
      selection.card.latField.textContent = `${result.lat.toFixed(2)}°`;
      selection.card.lonField.textContent = `${result.lon.toFixed(2)}°`;
      selection.card.altField.textContent = `${result.altitudeKm.toFixed(0)} km`;
    }
  }

  // --- Dashboard: risk / conjunctions / alerts ------------------------------
  // Fed purely by conjunctionWorker.js's streamed results (see conjunctionResults above).

  const expandedRiskItems = new Set();
  const expandedApproachFolders = new Set();

  const RISK_ITEM_EXTRA_MAX = 5;
  const APPROACH_FOLDER_MAX = 20;

  // 0-100, closer = higher; 0 at CONJUNCTION_SCREEN_KM.
  function riskScore(distanceKm) {
    return Math.round(100 - Math.min(distanceKm / CONJUNCTION_SCREEN_KM, 1) * 100);
  }

  // "+2h14m" style relative offset from now.
  function formatApproachTime(atDateIso) {
    const minutesFromNow = Math.round((new Date(atDateIso).getTime() - Date.now()) / 60_000);
    if (minutesFromNow <= 0) return "now";
    const h = Math.floor(minutesFromNow / 60);
    const m = minutesFromNow % 60;
    if (h === 0) return `+${m}m`;
    if (m === 0) return `+${h}h`;
    return `+${h}h ${m}m`;
  }

  // Alerts intentionally isn't rendered from here — it's driven by its own
  // pollBackendAlerts() timer, independent of local tracking changes.
  function renderRiskAndConjunctions() {
    renderRiskList();
    renderConjunctionsList();
  }

  // One close-approach row inside a satellite's own folder/risk row.
  function approachRowHtml(other) {
    const rawLabel = other.type === "debris" ? `${other.name} (debris)` : other.name;
    const otherLabel = escapeHtml(rawLabel);
    const addButton = selections.has(other.noradId)
      ? ""
      : `<button type="button" class="feed-item-add" data-norad-id="${other.noradId}" title="Track ${otherLabel}" aria-label="Track ${otherLabel}">+</button>`;
    return `
      <div class="dashboard-feed-item-objects">
        <span>${otherLabel}</span><span class="id">#${other.noradId}</span>
        ${addButton}
      </div>
      <div class="dashboard-feed-item-meta">
        <span class="dashboard-feed-item-distance">${other.distanceKm.toFixed(1)} km</span>
        <span class="dashboard-feed-item-time">${formatApproachTime(other.atDate)}</span>
        <span class="dashboard-feed-item-level">${other.risk.label}</span>
      </div>
    `;
  }

  // One row per tracked satellite (its own closest approach), not per close approach.
  function renderRiskList() {
    if (!riskListEl) return;

    const rows = [...selections.entries()].map(([noradId, selection]) => ({
      noradId,
      name: selection.object.name,
      approaches: conjunctionResults.get(noradId)?.closeApproaches, // undefined = still screening
    }));

    riskListEmptyEl.hidden = rows.length > 0;
    if (rows.length === 0) {
      riskListEl.innerHTML = "";
      return;
    }

    // Worst (closest) first; unscreened/clear satellites sort last.
    rows.sort((a, b) => (a.approaches?.[0]?.distanceKm ?? Infinity) - (b.approaches?.[0]?.distanceKm ?? Infinity));

    riskListEl.innerHTML = "";
    for (const row of rows) {
      const li = document.createElement("li");
      const safeName = escapeHtml(row.name);

      if (row.approaches === undefined) {
        li.className = "risk-item";
        li.innerHTML = `
          <div class="risk-item-header" data-foldable="false">
            <div class="risk-item-name">
              <span class="risk-item-title">${safeName}</span>
              <span class="risk-item-id">#${row.noradId}</span>
            </div>
            <span class="risk-item-detail">Screening…</span>
          </div>
        `;
        riskListEl.appendChild(li);
        continue;
      }

      const closest = row.approaches[0];
      const level = closest ? closest.risk.level : "clear";
      const extra = row.approaches.slice(1, 1 + RISK_ITEM_EXTRA_MAX);
      const foldable = extra.length > 0;
      const isExpanded = foldable && expandedRiskItems.has(row.noradId);

      li.className = "risk-item" + (isExpanded ? " risk-item--expanded" : "");
      li.innerHTML = `
        <div class="risk-item-header" data-foldable="${foldable}">
          <span class="risk-item-chevron">${foldable ? (isExpanded ? "▾" : "▸") : ""}</span>
          <div class="risk-item-name">
            <span class="risk-item-title">${safeName}</span>
            <span class="risk-item-id">#${row.noradId}</span>
          </div>
          ${closest ? `<span class="risk-item-detail">${closest.distanceKm.toFixed(1)} km · ${formatApproachTime(closest.atDate)}</span>` : ""}
          <span class="risk-item-score" style="--item-risk-color:${RISK_COLORS[level]}">${closest ? riskScore(closest.distanceKm) : 0}</span>
          <span class="risk-item-badge" style="--item-risk-color:${RISK_COLORS[level]}">${closest ? closest.risk.label : "Clear"}</span>
        </div>
        <ul class="risk-item-more"></ul>
      `;

      if (foldable) {
        li.querySelector(".risk-item-header").addEventListener("click", () => {
          if (expandedRiskItems.has(row.noradId)) expandedRiskItems.delete(row.noradId);
          else expandedRiskItems.add(row.noradId);
          renderRiskList();
        });
      }

      if (isExpanded) {
        const sublist = li.querySelector(".risk-item-more");
        for (const other of extra) {
          const rowEl = document.createElement("li");
          rowEl.className = "risk-item-more-row";
          const rawLabel = other.type === "debris" ? `${other.name} (debris)` : other.name;
          const otherLabel = escapeHtml(rawLabel);
          rowEl.innerHTML = `<span>${otherLabel} <span class="id">#${other.noradId}</span></span><span>${other.distanceKm.toFixed(1)} km · ${formatApproachTime(other.atDate)}</span>`;
          sublist.appendChild(rowEl);
        }
      }

      riskListEl.appendChild(li);
    }
  }

  // One folder per tracked satellite (not one interleaved list) — collapsed by default.
  function renderConjunctionsList() {
    const list = document.getElementById("conjunctions-feed");
    if (!list) return;

    const rows = [...selections.entries()].map(([noradId, selection]) => ({
      noradId,
      name: selection.object.name,
      approaches: conjunctionResults.get(noradId)?.closeApproaches, // undefined = still screening
    }));

    if (rows.length === 0) {
      list.innerHTML = `<li class="dashboard-feed-empty">Track a satellite to see its close approaches here.</li>`;
      return;
    }

    rows.sort((a, b) => (a.approaches?.[0]?.distanceKm ?? Infinity) - (b.approaches?.[0]?.distanceKm ?? Infinity));

    list.innerHTML = "";
    for (const row of rows) {
      const li = document.createElement("li");
      const isExpanded = expandedApproachFolders.has(row.noradId);
      const closest = row.approaches?.[0];
      const countLabel = row.approaches === undefined ? "…" : String(row.approaches.length);
      const safeName = escapeHtml(row.name);

      li.className = "approach-folder" + (isExpanded ? " approach-folder--expanded" : "");
      if (closest) li.style.setProperty("--item-risk-color", RISK_COLORS[closest.risk.level]);

      li.innerHTML = `
        <button type="button" class="approach-folder-header" aria-expanded="${isExpanded}">
          <span class="approach-folder-chevron">${isExpanded ? "▾" : "▸"}</span>
          <span class="approach-folder-name">${safeName}</span>
          <span class="approach-folder-id">#${row.noradId}</span>
          <span class="approach-folder-count" title="Catalog objects (including debris) predicted within ${CONJUNCTION_SCREEN_KM}km over the next 5h">${countLabel}</span>
        </button>
        <ul class="approach-folder-list"></ul>
      `;

      li.querySelector(".approach-folder-header").addEventListener("click", () => {
        if (expandedApproachFolders.has(row.noradId)) expandedApproachFolders.delete(row.noradId);
        else expandedApproachFolders.add(row.noradId);
        renderConjunctionsList();
      });

      if (isExpanded) {
        const sublist = li.querySelector(".approach-folder-list");
        if (row.approaches === undefined) {
          sublist.innerHTML = `<li class="dashboard-feed-empty">Screening…</li>`;
        } else if (row.approaches.length === 0) {
          sublist.innerHTML = `<li class="dashboard-feed-empty">No close approaches found for this satellite.</li>`;
        } else {
          for (const other of row.approaches.slice(0, APPROACH_FOLDER_MAX)) {
            const item = document.createElement("li");
            item.className = "dashboard-feed-item";
            item.style.setProperty("--item-risk-color", RISK_COLORS[other.risk.level]);
            item.innerHTML = approachRowHtml(other);
            sublist.appendChild(item);
          }
        }
      }

      list.appendChild(li);
    }
  }

  const ALERTS_TOTAL_MAX = 10;

  // Unlike Risk/Close Approaches (both purely local — whatever this tab
  // happens to be tracking), Alerts shows the BACKEND's own catalog-wide
  // scan: satellites nobody in this browser tab selected can still show up
  // here if the backend's scan found them critical. Polled independently
  // of the tracking list on its own timer (see ALERTS_POLL_INTERVAL_MS),
  // not tied to conjunctionWorker.js's results at all.
  let backendAlerts = [];

  async function pollBackendAlerts() {
    try {
      const response = await fetch(ALERTS_API_URL);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      backendAlerts = data.alerts ?? [];
    } catch (error) {
      // Backend being unreachable shouldn't break a page that otherwise
      // works entirely client-side — just leave the last-known list (or
      // empty, on first load) and try again next interval.
      console.warn("Could not load live alerts from the backend:", error.message);
    }
    renderAlertsList();
  }

  function renderAlertsList() {
    const list = document.getElementById("alerts-feed");
    if (!list) return;

    // The backend already excludes expired rows as of its own response, but
    // this poll can sit unused for up to ALERTS_POLL_INTERVAL_MS — filter
    // again against the current time so nothing already past its predicted
    // closest approach lingers on screen until the next poll comes in.
    const now = Date.now();
    const liveAlerts = backendAlerts.filter((alert) => new Date(alert.closest_approach_at).getTime() > now);

    if (liveAlerts.length === 0) {
      list.innerHTML = `<li class="dashboard-feed-empty">All clear.</li>`;
      return;
    }

    list.innerHTML = "";
    for (const alert of liveAlerts.slice(0, ALERTS_TOTAL_MAX)) {
      const li = document.createElement("li");
      li.className = "dashboard-feed-item";
      li.style.setProperty("--item-risk-color", RISK_COLORS[alert.risk_level] ?? RISK_COLORS.critical);
      const safeTrackedName = escapeHtml(alert.satellite_name);
      const otherLabel = escapeHtml(alert.other_name);
      const safeRiskLevel = escapeHtml(alert.risk_level);
      li.innerHTML = `
        <div class="dashboard-feed-item-objects">
          <span>${safeTrackedName}</span><span class="id">#${alert.norad_id}</span>
          <span class="dashboard-feed-item-cross">×</span>
          <span>${otherLabel}</span><span class="id">#${alert.other_norad_id}</span>
        </div>
        <div class="dashboard-feed-item-meta">
          <span class="dashboard-feed-item-distance">${alert.distance_km.toFixed(2)} km</span>
          <span class="dashboard-feed-item-time">${formatApproachTime(alert.closest_approach_at)}</span>
          <span class="dashboard-feed-item-level">${safeRiskLevel}</span>
        </div>
      `;
      list.appendChild(li);
    }
  }

  // Built from the real thresholds/caps so the tooltips can't drift out of sync.
  function riskBandRowsHtml() {
    return RISK_BANDS.map((band, i) => {
      const prevMax = i === 0 ? MIN_REPORTABLE_KM : RISK_BANDS[i - 1].maxKm;
      return `
        <div class="info-tooltip-row">
          <span class="info-tooltip-label"><span class="info-tooltip-dot" style="--dot-color:${RISK_COLORS[band.level]}"></span>${band.label}</span>
          <span class="info-tooltip-range">${prevMax}–${band.maxKm} km</span>
        </div>`;
    }).join("");
  }

  function setTooltip(id, introHtml) {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = `<p class="info-tooltip-intro">${introHtml}</p>${riskBandRowsHtml()}`;
  }

  setTooltip("risk-info-tooltip", `Each tracked satellite's closest predicted approach in the next 5h.`);
  setTooltip(
    "conjunctions-info-tooltip",
    `Every catalog object predicted to come within ${CONJUNCTION_SCREEN_KM}km of each tracked satellite in the next 5h, grouped by satellite.`
  );
  setTooltip(
    "alerts-info-tooltip",
    `Critical-risk close approaches from the backend's own catalog-wide scan — not limited to what you're tracking here.`
  );

  updateMinZoomDistance(); // sets the default floor before anything's tracked yet

  // Independent of tracking/selection — runs regardless of what (if
  // anything) is being tracked in this tab, and regardless of explore mode.
  pollBackendAlerts();
  setInterval(pollBackendAlerts, ALERTS_POLL_INTERVAL_MS);

  setupDashboardModeControls();

  return { loadCatalogOnce, update };
}

const DASHBOARD_MODE_STORAGE_KEY = "spacecell.dashboardMode";
const DASHBOARD_MODES = ["docked", "full"];

// The header's two status dots (see index.html) double as real view
// controls — docked is the original floating card, full gives the
// dashboard nearly the whole screen (globe tucked fully behind it, see
// style.css's --dashboard-width override). Persisted so a reload keeps
// whatever was last picked. Any stale "minimized" value from before that
// mode was removed just falls back to "docked" below.
function setupDashboardModeControls() {
  const buttons = document.querySelectorAll("[data-panel-mode]");
  if (buttons.length === 0) return;

  function applyMode(mode) {
    const safeMode = DASHBOARD_MODES.includes(mode) ? mode : "docked";
    document.body.setAttribute("data-dashboard-mode", safeMode);
    buttons.forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.panelMode === safeMode));
    });
    try {
      localStorage.setItem(DASHBOARD_MODE_STORAGE_KEY, safeMode);
    } catch {
      // Private browsing or storage blocked — mode just won't persist across reloads.
    }
  }

  buttons.forEach((button) => {
    button.addEventListener("click", () => applyMode(button.dataset.panelMode));
  });

  let savedMode = "docked";
  try {
    savedMode = localStorage.getItem(DASHBOARD_MODE_STORAGE_KEY) ?? "docked";
  } catch {
    // Ignore — falls back to the docked default already set above.
  }
  applyMode(savedMode);
}
