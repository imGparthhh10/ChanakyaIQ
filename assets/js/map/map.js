/**
 * map.js — GIS Map orchestrator.
 *
 * Initializes a Leaflet map on #map-canvas, coordinates all
 * sub-modules (markers, choropleth, heatmap, controls), handles
 * view switching (cluster/heat/pins), and listens for data events.
 */

import { bus }                         from '../utils/eventBus.js';
import { qs, qsa }                    from '../utils/dom.js';
import { ensureLeaflet, getL, createTileLayer, fetchIndiaStates } from './layers.js';
import { MarkerManager, BranchLayer }  from './markers.js';
import { ChoroplethLayer }             from './choropleth.js';
import { HeatmapLayer }                from './heatmap.js';
import {
  createLegend, createChoroplethLegend, createCompass,
  createFullscreen, createLocate, createMiniMap, createLayerSwitcher,
} from './controls.js';

const INDIA_CENTER = [22.5, 82.0];
const INDIA_ZOOM = 5;
const INDIA_BOUNDS = [[6.5, 68.0], [37.5, 97.5]];

let _map = null;
let _markers = null;
let _branchLayer = null;
let _choropleth = null;
let _heatmap = null;
let _currentView = 'cluster';
let _branchesVisible = false;
let _statesGeoJSON = null;
let _choroplethLegendCtrl = null;
let _cache = null;
let _branches = [];

function clearPlaceholder() {
  const ph = qs('.map-placeholder');
  if (ph) ph.remove();
  const canvas = qs('#map-canvas');
  if (canvas) canvas.classList.remove('skeleton-map');
}

function initLeafletMap() {
  const L = getL();
  const el = qs('#map-canvas');
  if (!el) throw new Error('Map container #map-canvas not found');

  clearPlaceholder();

  _map = L.map(el, {
    center: INDIA_CENTER,
    zoom: INDIA_ZOOM,
    minZoom: 4,
    maxZoom: 18,
    maxBounds: L.latLngBounds(INDIA_BOUNDS).pad(0.2),
    maxBoundsViscosity: 0.8,
    zoomControl: false,
    zoomAnimation: true,
    markerZoomAnimation: true,
    fadeAnimation: true,
    attributionControl: true,
  });

  // Detect theme for default tile layer
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const defaultTile = isDark ? 'dark' : 'light';
  createTileLayer(defaultTile).addTo(_map);

  // Zoom controls — bottom right
  L.control.zoom({ position: 'topleft' }).addTo(_map);

  // Scale bar
  L.control.scale({ position: 'bottomleft', imperial: false }).addTo(_map);

  return { defaultTile };
}

function initControls(defaultTile) {
  const container = qs('#map-container') || qs('.map-container');

  createCompass().addTo(_map);
  createFullscreen(container).addTo(_map);
  createLocate(_map).addTo(_map);
  createMiniMap().addTo(_map);
  createLegend().addTo(_map);
  createLayerSwitcher(_map, defaultTile).addTo(_map);
}

function initSubLayers() {
  _markers = new MarkerManager(_map);
  _markers.init();

  _branchLayer = new BranchLayer(_map);
  _branchLayer.init();

  _choropleth = new ChoroplethLayer(_map);
  _heatmap = new HeatmapLayer(_map);
}

function switchView(view) {
  _currentView = view;

  _markers.hide();
  _heatmap.remove();
  _choropleth.remove();
  removeChoroplethLegend();

  if (view === 'cluster') {
    _markers.show('cluster');
    if (_statesGeoJSON && _cache) {
      _choropleth.setData(_cache, 'count');
      _choropleth.render(_statesGeoJSON);
    }
  } else if (view === 'heat') {
    if (_cache) {
      _heatmap.render(_cache.getAll(), 'revenue');
    }
    if (_statesGeoJSON && _cache) {
      _choropleth.setData(_cache, 'count');
      _choropleth.render(_statesGeoJSON);
      showChoroplethLegend();
    }
  } else if (view === 'pins') {
    _markers.show('pins');
  }
}

function showChoroplethLegend() {
  removeChoroplethLegend();
  _choroplethLegendCtrl = createChoroplethLegend(
    _choropleth.colorScale, _choropleth.maxValue, _choropleth.metric
  );
  _choroplethLegendCtrl.addTo(_map);
}

function removeChoroplethLegend() {
  if (_choroplethLegendCtrl) {
    _map.removeControl(_choroplethLegendCtrl);
    _choroplethLegendCtrl = null;
  }
}

function wireViewButtons() {
  const btns = qsa('[data-map-view]');
  btns.forEach(btn => {
    btn.addEventListener('click', () => {
      btns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      switchView(btn.dataset.mapView);
    });
  });

  // Inject Branches toggle button into the map-controls bar if not present
  const controlsBar = qs('.map-controls');
  if (controlsBar && !qs('[data-map-branches]', controlsBar)) {
    const sep = document.createElement('span');
    sep.className = 'chip-btn-sep';
    sep.style.cssText = 'width:1px;background:var(--border-1);margin:0 6px';
    controlsBar.appendChild(sep);

    const btn = document.createElement('button');
    btn.className = 'chip-btn' + (_branchesVisible ? ' active' : '');
    btn.setAttribute('data-map-branches', '1');
    btn.title = 'Show / hide branch markers';
    btn.textContent = 'Branches';
    btn.addEventListener('click', () => {
      const next = !_branchesVisible;
      btn.classList.toggle('active', next);
      toggleBranches(next);
    });
    controlsBar.appendChild(btn);
  }
}

function onDataReady({ cache, branches }) {
  _cache = cache;
  _branches = Array.isArray(branches) ? branches : [];
  const records = cache.getAll();

  _markers.load(records);
  switchView(_currentView);

  // Load branches AND show them by default so every location appears on
  // the India map at first load. Users can still toggle them off via the
  // Branches control.
  if (_branches.length && _branchLayer) {
    _branchLayer.load(_branches);
    _branchLayer.show();
    _branchesVisible = true;
    const btn = qs('[data-map-branches]');
    if (btn) btn.classList.add('active');
  }

  console.log(`[Map] Loaded ${records.length} company HQ markers + ${_branches.length.toLocaleString('en-IN')} branches`);
}

/** Show/hide the branch layer independently of the HQ view. */
function toggleBranches(visible) {
  if (!_branchLayer) return;
  _branchesVisible = visible;
  if (visible) _branchLayer.show();
  else         _branchLayer.hide();
}

function wireFilterEvents() {
  bus.on('filter:apply', (filters) => {
    if (!_cache) return;
    const filtered = _cache.query(filters);

    _markers.updateFilter(filtered);
    switchView(_currentView);
  });

  bus.on('filter:reset', () => {
    if (!_cache) return;
    _markers.updateFilter(_cache.getAll());
    switchView(_currentView);
  });
}

function wireThemeEvents() {
  bus.on('theme:change', ({ theme }) => {
    const tile = theme === 'dark' ? 'dark' : 'light';
    _map.eachLayer(l => { if (l._url) _map.removeLayer(l); });
    createTileLayer(tile).addTo(_map);
  });
}

// ─── Public API ────────────────────────────────

export const mapEngine = {
  async init() {
    try {
      bus.emit('map:status', { phase: 'loading', message: 'Loading map libraries…' });
      await ensureLeaflet();

      bus.emit('map:status', { phase: 'init', message: 'Initializing map…' });
      const { defaultTile } = initLeafletMap();
      initControls(defaultTile);
      initSubLayers();
      wireViewButtons();
      wireFilterEvents();
      wireThemeEvents();

      // Fetch state boundaries in background
      fetchIndiaStates().then(geojson => {
        _statesGeoJSON = geojson;
        if (_cache && _currentView !== 'pins') {
          _choropleth.setData(_cache, 'count');
          _choropleth.render(geojson);
        }
      });

      bus.on('data:ready', onDataReady);

      bus.emit('map:status', { phase: 'ready', message: 'Map ready.' });
      console.log('[Map] Initialized');

    } catch (err) {
      console.error('[Map] Init failed:', err);
      bus.emit('map:status', { phase: 'error', message: err.message });
    }
  },

  get map()       { return _map; },
  get view()      { return _currentView; },
  switchView,

  fitIndia() {
    if (_map) _map.setView(INDIA_CENTER, INDIA_ZOOM);
  },

  fitBounds(bounds) {
    if (_map) _map.fitBounds(bounds, { padding: [30, 30] });
  },

  invalidateSize() {
    if (_map) setTimeout(() => _map.invalidateSize(), 100);
  },
};
