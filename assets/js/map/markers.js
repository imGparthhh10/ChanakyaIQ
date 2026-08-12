/**
 * markers.js — Company marker management with clustering.
 *
 * Creates Leaflet markers from company data, groups them into
 * MarkerClusterGroup for performance, and provides tooltip/click
 * interactions. Supports cluster, pins, and viewport-based rendering.
 */

import { bus } from '../utils/eventBus.js';
import { getL } from './layers.js';
import { getCoords } from './cityCoords.js';

const CATEGORY_COLORS = {
  'Public Sector Bank':    '#1E40AF',
  'Private Bank':          '#7C3AED',
  'Foreign Bank':          '#0891B2',
  'Small Finance Bank':    '#0D9488',
  'Payments Bank':         '#059669',
  'Cooperative Bank':      '#16A34A',
  'Regional Rural Bank':   '#65A30D',
  'NBFC':                  '#EA580C',
  'Housing Finance':       '#D97706',
  'Microfinance':          '#CA8A04',
  'Gold Loan':             '#EAB308',
  'Vehicle Finance':       '#F97316',
  'Infrastructure Finance':'#DC2626',
  'ARC':                   '#E11D48',
  'Life Insurance':        '#DB2777',
  'General Insurance':     '#C026D3',
  'Health Insurance':      '#9333EA',
  'Reinsurance':           '#7C3AED',
  'AMC':                   '#6366F1',
  'Wealth Management':     '#4F46E5',
  'Stock Broking':         '#2563EB',
  'FinTech':               '#06B6D4',
  'Market Infrastructure': '#0EA5E9',
  'Other':                 '#64748B',
};

const CATEGORY_GROUPS = {
  'Banks':     ['Public Sector Bank', 'Private Bank', 'Foreign Bank', 'Small Finance Bank', 'Payments Bank', 'Cooperative Bank', 'Regional Rural Bank'],
  'NBFCs':     ['NBFC', 'Housing Finance', 'Microfinance', 'Gold Loan', 'Vehicle Finance', 'Infrastructure Finance', 'ARC'],
  'Insurance': ['Life Insurance', 'General Insurance', 'Health Insurance', 'Reinsurance'],
  'Capital Markets': ['AMC', 'Wealth Management', 'Stock Broking', 'Market Infrastructure'],
  'FinTech':   ['FinTech'],
};

function getGroupColor(category) {
  for (const [group, cats] of Object.entries(CATEGORY_GROUPS)) {
    if (cats.includes(category)) {
      const colors = { Banks: '#1E40AF', NBFCs: '#EA580C', Insurance: '#9333EA', 'Capital Markets': '#6366F1', FinTech: '#06B6D4' };
      return colors[group] || '#64748B';
    }
  }
  return '#64748B';
}

function createMarkerIcon(category, colorOverride) {
  const L = getL();
  const color = colorOverride || CATEGORY_COLORS[category] || '#64748B';

  return L.divIcon({
    className: 'esds-marker',
    html: `<div class="esds-marker-dot" style="background:${color};box-shadow:0 0 8px ${color}80"></div>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  });
}

function createPinIcon(category, colorOverride) {
  const L = getL();
  const color = colorOverride || CATEGORY_COLORS[category] || '#64748B';

  return L.divIcon({
    className: 'esds-pin',
    html: `
      <svg width="28" height="36" viewBox="0 0 28 36" fill="none">
        <path d="M14 0C6.268 0 0 6.268 0 14c0 10.5 14 22 14 22s14-11.5 14-22C28 6.268 21.732 0 14 0z" fill="${color}"/>
        <circle cx="14" cy="13" r="5" fill="white" fill-opacity="0.9"/>
      </svg>`,
    iconSize: [28, 36],
    iconAnchor: [14, 36],
    popupAnchor: [0, -36],
  });
}

function formatTooltip(rec) {
  const rev = rec.revenue != null ? `₹${rec.revenue.toLocaleString('en-IN')} Cr` : '—';
  return `
    <div class="esds-tooltip">
      <div class="esds-tooltip-name">${rec.companyName}</div>
      <div class="esds-tooltip-cat">${rec.category || '—'}</div>
      <div class="esds-tooltip-row">
        <span>${rec.hqCity || ''}${rec.hqCity && rec.state ? ', ' : ''}${rec.state || ''}</span>
        <span>Rev: ${rev}</span>
      </div>
      ${rec.ceo ? `<div class="esds-tooltip-ceo">CEO: ${rec.ceo}</div>` : ''}
    </div>`;
}

/**
 * Deterministic pseudo-jitter for a branch — same branch id always gets the
 * same tiny offset. Prevents 50 branches in Mumbai from stacking exactly.
 * Range: ±0.04° (~4 km) so markers spread inside a city but stay in it.
 */
function branchJitter(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = ((h << 5) - h) + id.charCodeAt(i);
  const rx = ((h & 0xffff) / 0xffff - 0.5) * 0.08;
  const ry = (((h >> 16) & 0xffff) / 0xffff - 0.5) * 0.08;
  return [rx, ry];
}

function formatBranchTooltip(br) {
  return `
    <div class="esds-tooltip">
      <div class="esds-tooltip-name">${br.branchName}</div>
      <div class="esds-tooltip-cat">${br.parentName}${br.subSector ? ' · ' + br.subSector : ''}</div>
      <div class="esds-tooltip-row">
        <span>${[br.city, br.state].filter(Boolean).join(', ')}</span>
        ${br.ifsc ? '<span style="font-family:monospace">' + br.ifsc + '</span>' : ''}
      </div>
    </div>`;
}

function formatBranchPopup(br) {
  const encoded = encodeURIComponent(br.parentKey);
  return `
    <div class="esds-branch-popup">
      <div class="ebp-title">${br.branchName}</div>
      <div class="ebp-parent">${br.parentName}</div>
      <div class="ebp-meta">
        ${br.subSector ? '<span class="ebp-chip">' + br.subSector + '</span>' : ''}
        ${br.ownership ? '<span class="ebp-chip">' + br.ownership + '</span>' : ''}
      </div>
      <table class="ebp-table">
        ${br.ifsc     ? '<tr><td>IFSC</td><td><code>' + br.ifsc + '</code></td></tr>' : ''}
        ${br.address  ? '<tr><td>Address</td><td>' + br.address + '</td></tr>' : ''}
        ${br.city     ? '<tr><td>City</td><td>' + br.city + '</td></tr>' : ''}
        ${br.district ? '<tr><td>District</td><td>' + br.district + '</td></tr>' : ''}
        ${br.state    ? '<tr><td>State</td><td>' + br.state + '</td></tr>' : ''}
        ${br.region   ? '<tr><td>Region</td><td>' + br.region + '</td></tr>' : ''}
        ${br.hqLocation ? '<tr><td>Parent HQ</td><td>' + br.hqLocation + '</td></tr>' : ''}
      </table>
      <div class="ebp-actions">
        <button type="button" class="ebp-btn ebp-btn-primary" data-focus-branch="${br.id}" data-focus-ifsc="${br.ifsc || ''}" data-open-branch-company="${encoded}">Open Company 360 →</button>
        ${br.website ? '<a href="' + (br.website.startsWith('http') ? br.website : 'https://' + br.website) + '" target="_blank" rel="noopener" class="ebp-btn">Website</a>' : ''}
      </div>
    </div>`;
}

// Delegated listener: when a branch popup's "Open Company 360" button is
// clicked, stash the branch to focus (so focusBranchIfRequested can scroll
// to and highlight it once rendered) and open the split-view panel in
// place — no navigation. Installed once at module load.
if (typeof document !== 'undefined' && !window.__esdsBranchFocusWired) {
  window.__esdsBranchFocusWired = true;
  document.addEventListener('click', (e) => {
    const btn = e.target.closest?.('[data-open-branch-company]');
    if (!btn) return;
    const id = btn.getAttribute('data-focus-branch');
    const ifsc = btn.getAttribute('data-focus-ifsc');
    try {
      sessionStorage.setItem('boip_branch_focus', JSON.stringify({ id, ifsc }));
    } catch { /* sessionStorage unavailable — silently skip highlight */ }
    const parentKey = decodeURIComponent(btn.getAttribute('data-open-branch-company') || '');
    bus.emit('map:branch-popup-open', { parentKey });
  });
}

/**
 * Manages a branch-marker cluster layer, distinct from the HQ layer.
 * Branch markers are small blue dots; the cluster color reflects branch density.
 */
export class BranchLayer {
  constructor(map) {
    this._map = map;
    this._L = getL();
    this._cluster = null;
    this._branches = [];
    this._visible = false;
  }

  init() {
    this._cluster = this._L.markerClusterGroup({
      chunkedLoading: true,
      chunkInterval: 100,
      chunkDelay: 10,
      maxClusterRadius: 60,
      spiderfyOnMaxZoom: true,
      showCoverageOnHover: false,
      zoomToBoundsOnClick: true,
      disableClusteringAtZoom: 12,
      iconCreateFunction: (cluster) => {
        const count = cluster.getChildCount();
        let size = 'small';
        if (count > 200) size = 'large';
        else if (count > 40) size = 'medium';
        return this._L.divIcon({
          html: `<div class="esds-branch-cluster esds-branch-cluster-${size}"><span>${count}</span></div>`,
          className: 'esds-cluster-icon',
          iconSize: this._L.point(36, 36),
        });
      },
    });
  }

  load(branches) {
    if (!this._cluster) this.init();
    this._branches = branches;
    this._cluster.clearLayers();

    // Batch markers to avoid a giant sync loop on 5k+ items
    const batch = [];
    for (const br of branches) {
      const base = getCoords(br.city, br.state);
      if (!base) continue;
      const [jx, jy] = branchJitter(br.id);
      const lat = base[0] + jy;
      const lng = base[1] + jx;

      const marker = this._L.circleMarker([lat, lng], {
        radius: 4,
        color: '#22D3EE',
        weight: 1.5,
        fillColor: '#0891B2',
        fillOpacity: 0.75,
        _branch: br,
      });

      marker.bindTooltip(formatBranchTooltip(br), {
        direction: 'top',
        offset: [0, -4],
        className: 'esds-leaflet-tooltip',
      });

      // Clicking a branch dot opens the parent company in the split-view
      // panel in place (companyPanel.js) — no navigation, no separate
      // popup/page. The sessionStorage flag still drives
      // focusBranchIfRequested's scroll-to-branch highlight, which
      // renderCompanyDetail calls regardless of standalone-page vs. panel.
      marker.on('click', () => {
        bus.emit('map:branch-click', { branch: br, latlng: [lat, lng] });
        try {
          sessionStorage.setItem('boip_branch_focus', JSON.stringify({ id: br.id, ifsc: br.ifsc || '' }));
        } catch { /* sessionStorage unavailable — skip highlight */ }
      });

      batch.push(marker);
    }
    this._cluster.addLayers(batch);
  }

  show() {
    if (!this._cluster) return;
    if (!this._visible) {
      this._map.addLayer(this._cluster);
      this._visible = true;
    }
  }

  hide() {
    if (!this._cluster) return;
    if (this._visible) {
      this._map.removeLayer(this._cluster);
      this._visible = false;
    }
  }

  get isVisible() { return this._visible; }
  get branchCount() { return this._branches.length; }
}

export class MarkerManager {
  constructor(map) {
    this._map = map;
    this._L = getL();
    this._markers = [];
    this._clusterGroup = null;
    this._rawGroup = null;
    this._mode = 'cluster'; // cluster | pins
    this._records = [];
  }

  init() {
    this._clusterGroup = this._L.markerClusterGroup({
      chunkedLoading: true,
      chunkInterval: 100,
      chunkDelay: 10,
      maxClusterRadius: 50,
      spiderfyOnMaxZoom: true,
      showCoverageOnHover: false,
      zoomToBoundsOnClick: true,
      animate: true,
      animateAddingMarkers: false,
      disableClusteringAtZoom: 14,
      iconCreateFunction: (cluster) => {
        const count = cluster.getChildCount();
        let size = 'small';
        if (count > 50) size = 'large';
        else if (count > 10) size = 'medium';

        const colors = {};
        cluster.getAllChildMarkers().forEach(m => {
          const g = m.options._categoryGroup || 'Other';
          colors[g] = (colors[g] || 0) + 1;
        });

        const dominant = Object.entries(colors).sort((a, b) => b[1] - a[1])[0];
        const color = { Banks: '#1E40AF', NBFCs: '#EA580C', Insurance: '#9333EA', 'Capital Markets': '#6366F1', FinTech: '#06B6D4' }[dominant?.[0]] || '#64748B';

        return this._L.divIcon({
          html: `<div class="esds-cluster esds-cluster-${size}" style="--cluster-color:${color}"><span>${count}</span></div>`,
          className: 'esds-cluster-icon',
          iconSize: this._L.point(40, 40),
        });
      },
    });

    this._rawGroup = this._L.layerGroup();
  }

  load(records) {
    this._records = records;
    this._markers = [];
    this._clusterGroup.clearLayers();
    this._rawGroup.clearLayers();

    for (const rec of records) {
      const [lat, lng] = getCoords(rec.hqCity, rec.state);
      const group = this._getCategoryGroup(rec.category);

      const marker = this._L.marker([lat, lng], {
        icon: this._mode === 'pins'
          ? createPinIcon(rec.category, rec.markerColor)
          : createMarkerIcon(rec.category, rec.markerColor),
        _record: rec,
        _categoryGroup: group,
      });

      marker.bindTooltip(formatTooltip(rec), {
        direction: 'top',
        offset: [0, -8],
        className: 'esds-leaflet-tooltip',
      });

      marker.on('click', () => {
        // Opens the Company 360 detail in the split-view panel next to the
        // map (companyPanel.js listens for this) instead of navigating
        // away — keeps the map in view so the next company can be picked
        // immediately. Falls back to the drawer preview if there's no
        // dedupe key to key the panel off of.
        bus.emit('map:marker-click', { record: rec, latlng: [lat, lng] });
        if (!rec._dedupeKey) {
          bus.emit('company:select', rec);
        }
      });

      marker.on('mouseover', () => {
        bus.emit('map:marker-hover', { record: rec });
      });

      this._markers.push(marker);
      this._clusterGroup.addLayer(marker);
      this._rawGroup.addLayer(marker);
    }
  }

  show(mode) {
    this._mode = mode || this._mode;
    this._map.removeLayer(this._clusterGroup);
    this._map.removeLayer(this._rawGroup);

    if (this._mode === 'cluster') {
      this._map.addLayer(this._clusterGroup);
    } else if (this._mode === 'pins') {
      this._markers.forEach(m => {
        m.setIcon(createPinIcon(m.options._record.category, m.options._record.markerColor));
      });
      this._map.addLayer(this._rawGroup);
    }
  }

  hide() {
    this._map.removeLayer(this._clusterGroup);
    this._map.removeLayer(this._rawGroup);
  }

  updateFilter(records) {
    this.load(records);
    this.show(this._mode);
  }

  _getCategoryGroup(category) {
    for (const [group, cats] of Object.entries(CATEGORY_GROUPS)) {
      if (cats.includes(category)) return group;
    }
    return 'Other';
  }

  get markerCount() { return this._markers.length; }
}

export { CATEGORY_COLORS, CATEGORY_GROUPS };
