/**
 * controls.js — Custom Leaflet controls.
 *
 * Legend, MiniMap, Scale, Compass, Fullscreen, Locate, Layer Switcher.
 * All controls use glassmorphism styling via CSS classes.
 */

import { getL, createTileLayer } from './layers.js';
import { CATEGORY_COLORS } from './markers.js';

// ─── Legend Control ────────────────────────────

export function createLegend() {
  const L = getL();
  const legend = L.control({ position: 'bottomleft' });

  legend.onAdd = () => {
    const div = L.DomUtil.create('div', 'esds-map-legend glass-card');

    const groups = {
      'Banks':           '#1E40AF',
      'NBFCs':           '#EA580C',
      'Insurance':       '#9333EA',
      'Capital Markets': '#6366F1',
      'FinTech':         '#06B6D4',
    };

    div.innerHTML = `
      <div class="esds-legend-title">Sector Groups</div>
      ${Object.entries(groups).map(([name, color]) =>
        `<div class="esds-legend-item">
          <span class="esds-legend-dot" style="background:${color}"></span>
          ${name}
        </div>`
      ).join('')}
    `;

    L.DomEvent.disableClickPropagation(div);
    return div;
  };

  return legend;
}

// ─── Choropleth Legend ─────────────────────────

export function createChoroplethLegend(colorScale, maxValue, metric) {
  const L = getL();
  const legend = L.control({ position: 'bottomright' });

  legend.onAdd = () => {
    const div = L.DomUtil.create('div', 'esds-map-legend esds-choropleth-legend glass-card');
    const label = metric === 'count' ? 'Companies' : 'Revenue (₹ Cr)';

    const grades = colorScale.map((c, i) => {
      const val = Math.round((i / (colorScale.length - 1)) * maxValue);
      return `<span class="esds-scale-step" style="background:${c}"></span>`;
    });

    div.innerHTML = `
      <div class="esds-legend-title">${label}</div>
      <div class="esds-scale-bar">${grades.join('')}</div>
      <div class="esds-scale-labels">
        <span>0</span>
        <span>${maxValue > 1000 ? Math.round(maxValue / 1000) + 'k' : maxValue}</span>
      </div>`;

    L.DomEvent.disableClickPropagation(div);
    return div;
  };

  return legend;
}

// ─── Compass / North Arrow ─────────────────────

export function createCompass() {
  const L = getL();
  const compass = L.control({ position: 'topright' });

  compass.onAdd = () => {
    const div = L.DomUtil.create('div', 'esds-map-ctrl esds-compass');
    div.innerHTML = `
      <svg width="28" height="28" viewBox="0 0 28 28">
        <polygon points="14,2 18,14 14,12 10,14" fill="#EF4444"/>
        <polygon points="14,26 18,14 14,16 10,14" fill="#94A3B8"/>
        <text x="14" y="8" text-anchor="middle" fill="white" font-size="6" font-weight="700">N</text>
      </svg>`;
    div.title = 'North';
    L.DomEvent.disableClickPropagation(div);
    return div;
  };

  return compass;
}

// ─── Fullscreen Toggle ─────────────────────────

export function createFullscreen(mapContainer) {
  const L = getL();
  const ctrl = L.control({ position: 'topleft' });

  ctrl.onAdd = () => {
    const btn = L.DomUtil.create('div', 'esds-map-ctrl esds-fullscreen-btn');
    btn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
        <path d="M1.5 1h4v1.5h-2.5v2.5h-1.5v-4zM10.5 1h4v4h-1.5v-2.5h-2.5v-1.5zM1.5 11v4h4v-1.5h-2.5v-2.5h-1.5zM13 11v2.5h-2.5v1.5h4v-4h-1.5z"/>
      </svg>`;
    btn.title = 'Fullscreen';

    let isFullscreen = false;

    L.DomEvent.on(btn, 'click', () => {
      isFullscreen = !isFullscreen;
      if (isFullscreen) {
        mapContainer.classList.add('esds-map-fullscreen');
        btn.innerHTML = `
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M5.5 1v1.5h-2.5v2.5h-1.5l.01-4h3.99zM10.5 1h4l.01 4h-1.51v-2.5h-2.5v-1.5zM1.5 11h1.5v2.5h2.5v1.5h-4v-4zM14.01 11v4h-4v-1.5h2.5v-2.5h1.5z"/>
          </svg>`;
      } else {
        mapContainer.classList.remove('esds-map-fullscreen');
        btn.innerHTML = `
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M1.5 1h4v1.5h-2.5v2.5h-1.5v-4zM10.5 1h4v4h-1.5v-2.5h-2.5v-1.5zM1.5 11v4h4v-1.5h-2.5v-2.5h-1.5zM13 11v2.5h-2.5v1.5h4v-4h-1.5z"/>
          </svg>`;
      }

      setTimeout(() => window.dispatchEvent(new Event('resize')), 200);
    });

    L.DomEvent.disableClickPropagation(btn);
    return btn;
  };

  return ctrl;
}

// ─── Locate Button ─────────────────────────────

export function createLocate(map) {
  const L = getL();
  const ctrl = L.control({ position: 'topleft' });

  ctrl.onAdd = () => {
    const btn = L.DomUtil.create('div', 'esds-map-ctrl esds-locate-btn');
    btn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
        <path d="M8 0v2a6 6 0 00-6 6H0a8 8 0 018-8zm0 16v-2a6 6 0 006-6h2a8 8 0 01-8 8zm0-4a4 4 0 110-8 4 4 0 010 8zm0-2a2 2 0 100-4 2 2 0 000 4z"/>
      </svg>`;
    btn.title = 'My Location';

    L.DomEvent.on(btn, 'click', () => {
      if (!navigator.geolocation) return;
      navigator.geolocation.getCurrentPosition(
        (pos) => map.setView([pos.coords.latitude, pos.coords.longitude], 10),
        () => {},
        { enableHighAccuracy: false, timeout: 5000 }
      );
    });

    L.DomEvent.disableClickPropagation(btn);
    return btn;
  };

  return ctrl;
}

// ─── MiniMap ───────────────────────────────────

export function createMiniMap() {
  const L = getL();
  const ctrl = L.control({ position: 'bottomright' });

  ctrl.onAdd = (map) => {
    const container = L.DomUtil.create('div', 'esds-minimap glass-card');
    container.style.cssText = 'width:140px;height:100px;border-radius:8px;overflow:hidden;cursor:pointer;';

    setTimeout(() => {
      const mini = L.map(container, {
        zoomControl: false,
        attributionControl: false,
        dragging: false,
        scrollWheelZoom: false,
        doubleClickZoom: false,
        touchZoom: false,
        boxZoom: false,
        keyboard: false,
      }).setView([22.5, 82], 3);

      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        maxZoom: 5,
      }).addTo(mini);

      const rect = L.rectangle(map.getBounds(), {
        color: '#6366F1',
        weight: 2,
        fillOpacity: 0.2,
      }).addTo(mini);

      map.on('moveend zoomend', () => {
        rect.setBounds(map.getBounds());
      });

      container.addEventListener('click', () => {
        map.setView([22.5, 82], 5);
      });
    }, 500);

    L.DomEvent.disableClickPropagation(container);
    return container;
  };

  return ctrl;
}

// ─── Layer Switcher ────────────────────────────

export function createLayerSwitcher(map, currentLayer) {
  const L = getL();
  const ctrl = L.control({ position: 'topright' });

  const layers = ['road', 'dark', 'light', 'terrain', 'satellite'];
  let active = currentLayer || 'dark';

  ctrl.onAdd = () => {
    const div = L.DomUtil.create('div', 'esds-map-ctrl esds-layer-switcher');
    div.innerHTML = `
      <div class="esds-layer-toggle">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <path d="M8 0L0 6l8 4 8-4L8 0zM0 10l8 4 8-4-2-1-6 3-6-3-2 1z"/>
        </svg>
      </div>
      <div class="esds-layer-menu" style="display:none">
        ${layers.map(name =>
          `<button class="esds-layer-opt${name === active ? ' active' : ''}" data-layer="${name}">
            ${name.charAt(0).toUpperCase() + name.slice(1)}
          </button>`
        ).join('')}
      </div>`;

    const toggle = div.querySelector('.esds-layer-toggle');
    const menu = div.querySelector('.esds-layer-menu');

    L.DomEvent.on(toggle, 'click', () => {
      menu.style.display = menu.style.display === 'none' ? 'flex' : 'none';
    });

    div.querySelectorAll('.esds-layer-opt').forEach(btn => {
      L.DomEvent.on(btn, 'click', () => {
        const name = btn.dataset.layer;
        if (name === active) return;

        map.eachLayer(l => { if (l._url) map.removeLayer(l); });
        createTileLayer(name).addTo(map);
        active = name;

        div.querySelectorAll('.esds-layer-opt').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        menu.style.display = 'none';
      });
    });

    L.DomEvent.disableClickPropagation(div);
    return div;
  };

  ctrl._setActive = (name) => { active = name; };
  return ctrl;
}
