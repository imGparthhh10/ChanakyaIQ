/**
 * companyPanel.js — Map + Company 360 split view.
 *
 * The map and Company 360 panel are a permanent 50/50 workspace (fixed in
 * CSS — dashboard.css's .map-split-row) — this module only ever swaps the
 * panel's *content* between the empty-state placeholder and a rendered
 * profile. It never resizes anything, so there's no mapEngine.invalidateSize()
 * call needed here (the map's own dimensions never change on selection).
 *
 * Listens for the map's existing marker/branch click events and renders
 * the Company 360 detail in place (#map-detail-panel) instead of the old
 * behavior of navigating away to the standalone Company 360 route. Table/
 * search-based navigation is untouched — this is map-page-only, per the
 * confirmed split-view scope.
 */

import { bus }        from '../utils/eventBus.js';
import { qs }         from '../utils/dom.js';
import { dataEngine } from '../data/data.js';
import { renderCompanyDetail } from '../pages/company360.js';

let _dispose = null;

// Matches index.html's initial #map-detail-body markup exactly, so
// clearing a selection returns the panel to its pre-selection state.
const EMPTY_STATE_HTML = `
  <div class="map-detail-empty">
    <div class="map-detail-empty-icon">📍</div>
    <p>Select a company on the map to view its full profile.</p>
  </div>`;

function openPanel(rec) {
  const body = qs('#map-detail-body');
  if (!body || !rec) return;

  if (_dispose) { try { _dispose(); } catch { /* ignore */ } _dispose = null; }

  _dispose = renderCompanyDetail(body, rec, { setTitle: false });
}

function closePanel() {
  const body = qs('#map-detail-body');
  if (!body) return;

  if (_dispose) { try { _dispose(); } catch { /* ignore */ } _dispose = null; }
  body.innerHTML = EMPTY_STATE_HTML;
}

function findByDedupeKey(key) {
  const cache = dataEngine.cache;
  if (!cache || !key) return null;
  return cache.getAll().find(r => r._dedupeKey === key) || null;
}

export function initCompanyPanel() {
  bus.on('map:marker-click', ({ record }) => {
    if (record) openPanel(record);
  });

  bus.on('map:branch-click', ({ branch }) => {
    const rec = findByDedupeKey(branch?.parentKey);
    if (rec) openPanel(rec);
  });

  // The branch-list popup's "Open Company 360 →" button (delegated click
  // listener in markers.js) also opens the panel in place now, via this
  // event, instead of a real navigation.
  bus.on('map:branch-popup-open', ({ parentKey }) => {
    const rec = findByDedupeKey(parentKey);
    if (rec) openPanel(rec);
  });

  qs('#map-detail-close')?.addEventListener('click', closePanel);
}
