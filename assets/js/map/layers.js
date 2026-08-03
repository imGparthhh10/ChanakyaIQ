/**
 * layers.js — Leaflet loader, tile layers, and GeoJSON fetching.
 *
 * Dynamically loads Leaflet + plugins from CDN (no build step).
 * Provides tile layer presets and India state boundary GeoJSON.
 */

import { bus } from '../utils/eventBus.js';

const CDN = {
  leafletCSS:    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  leafletJS:     'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  clusterCSS:    'https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.css',
  clusterDefCSS: 'https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.Default.css',
  clusterJS:     'https://unpkg.com/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js',
  heatJS:        'https://unpkg.com/leaflet.heat@0.2.0/dist/leaflet-heat.js',
};

/**
 * India state boundaries source (in preference order):
 *   1. Local file  data/india-states.geojson   (drop your own map here — this
 *      is the recommended source for Government-of-India-conformant boundaries
 *      including full J&K, Ladakh, Aksai Chin, and Gilgit-Baltistan)
 *   2. Local file  data/india_states.geojson   (underscore variant)
 *   3. Local file  data/india.geojson
 *   4. Remote fallback (UN-line boundary — NOT authoritative for India)
 *
 * To use the correct Indian political map, place a GeoJSON file at
 * data/india-states.geojson with a FeatureCollection whose features carry a
 * `properties.NAME_1` or `properties.st_nm` or `properties.name` matching
 * Indian state names (e.g. "Jammu and Kashmir", "Ladakh").
 */
const GEOJSON_SOURCES = [
  'data/india-states.geojson',
  'data/india_states.geojson',
  'data/india.geojson',
  // Remote fallback — this does NOT show Indian government boundaries.
  // Replace with your own local file to get the correct political map.
  'https://raw.githubusercontent.com/Subhash9325/GeoJson-Data-of-Indian-States/master/Indian_States',
];

let L = null;

function loadCSS(href) {
  if (document.querySelector(`link[href="${href}"]`)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  document.head.appendChild(link);
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(s);
  });
}

export async function ensureLeaflet() {
  if (L) return L;
  if (window.L) { L = window.L; return L; }

  loadCSS(CDN.leafletCSS);
  loadCSS(CDN.clusterCSS);
  loadCSS(CDN.clusterDefCSS);

  await loadScript(CDN.leafletJS);
  L = window.L;

  await Promise.all([
    loadScript(CDN.clusterJS),
    loadScript(CDN.heatJS),
  ]);

  return L;
}

export function getL() { return L || window.L; }

// ─── Tile Layer Presets ────────────────────────

const TILE_LAYERS = {
  road: {
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    options: {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    },
  },
  dark: {
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    options: {
      attribution: '&copy; <a href="https://carto.com/">CARTO</a>',
      maxZoom: 20,
    },
  },
  light: {
    url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    options: {
      attribution: '&copy; <a href="https://carto.com/">CARTO</a>',
      maxZoom: 20,
    },
  },
  terrain: {
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    options: {
      attribution: '&copy; <a href="https://opentopomap.org">OpenTopoMap</a>',
      maxZoom: 17,
    },
  },
  satellite: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    options: {
      attribution: '&copy; Esri',
      maxZoom: 18,
    },
  },
};

export function createTileLayer(name) {
  const cfg = TILE_LAYERS[name] || TILE_LAYERS.road;
  return getL().tileLayer(cfg.url, cfg.options);
}

export function getTileLayerNames() {
  return Object.keys(TILE_LAYERS);
}

// ─── India State Boundaries GeoJSON ────────────

let _statesGeoJSON = null;

export async function fetchIndiaStates() {
  if (_statesGeoJSON) return _statesGeoJSON;

  for (const src of GEOJSON_SOURCES) {
    const isLocal = !src.startsWith('http');
    try {
      const resp = await fetch(src, { cache: 'default' });
      if (!resp.ok) continue;                  // 404 on local file → try next
      const json = await resp.json();
      // Sanity check: must be a FeatureCollection with at least a few features
      if (!json || !json.features || !Array.isArray(json.features) || json.features.length < 5) continue;

      _statesGeoJSON = json;
      const kind = isLocal ? 'local' : 'remote';
      console.log(`[layers] India states loaded from ${kind} source: ${src} (${json.features.length} features)`);
      bus.emit('map:geodata', { type: 'states', status: 'loaded', source: src, kind });
      return _statesGeoJSON;
    } catch (err) {
      // Silent for local sources (expected 404 when file not present);
      // logged for remote fallback failure.
      if (!isLocal) console.warn(`[layers] Remote India states GeoJSON failed: ${err.message}`);
    }
  }

  console.warn('[layers] Could not load any India states GeoJSON source.');
  bus.emit('map:geodata', { type: 'states', status: 'failed' });
  return null;
}
