/**
 * branding.js — Developer branding badge (bottom-right).
 *
 * Displays "Designed & Developed by Parth Analytics" as a fixed
 * bottom-right badge with a circular PA logo. Hover shows a tooltip
 * with a subtle glow; click opens an attribution modal.
 *
 * - Zero external dependencies
 * - Adapts to light/dark theme via CSS custom properties
 * - Focus-trapped modal with Escape-to-close (from a11y installGlobalKeys)
 * - Idempotent init — safe to call multiple times
 */

import { h, qs }        from '../utils/dom.js';
import { escapeHTML }   from '../utils/sanitize.js';
import { trapFocus }    from '../utils/a11y.js';

let _mounted = false;
let _releaseFocus = null;

const ATTRIBUTION = {
  brand:     'Parth Analytics',
  tagline:   'Enterprise Data Analytics & AI Solutions',
  project:   'ESDS BFSI Geo Intelligence Dashboard',
  developer: 'Parth Ghongane',
  role:      'AI & Marketing Intern',
  org:       'ESDS Software Solution Ltd.',
  tech:      ['HTML5', 'CSS3', 'JavaScript', 'Leaflet.js', 'Apache ECharts', 'SheetJS', 'GSAP'],
  version:   'v1.0',
  copyright: '© 2026 Parth Analytics',
};

// ─── Badge ────────────────────────────────────────

function renderBadge() {
  const badge = h('button', {
    class: 'pa-badge',
    'aria-label': 'Attribution — designed and developed by Parth Analytics',
    'aria-haspopup': 'dialog',
  }, [
    h('span', { class: 'pa-badge-logo', 'aria-hidden': 'true' }, [
      // Analytics-style icon layered on the PA mark
      renderLogoSVG(),
    ]),
    h('span', { class: 'pa-badge-text' }, [
      h('span', { class: 'pa-badge-line1' }, 'Designed & Developed by'),
      h('span', { class: 'pa-badge-line2' }, 'Parth Analytics'),
    ]),
  ]);

  const tooltip = h('div', {
    class: 'pa-tooltip',
    role: 'tooltip',
    id: 'pa-tooltip',
  }, `Designed & Developed by ${ATTRIBUTION.brand} for ${ATTRIBUTION.project}`);

  badge.setAttribute('aria-describedby', 'pa-tooltip');

  const wrap = h('div', { class: 'pa-wrap', id: 'pa-wrap' });
  wrap.appendChild(tooltip);
  wrap.appendChild(badge);

  badge.addEventListener('click', openModal);

  return wrap;
}

function renderLogoSVG() {
  // Circular badge with layered analytics/AI style motif:
  //   - concentric ring (analytics)
  //   - stylized "PA" monogram
  //   - a small ascending-bar accent (data-viz)
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 40 40');
  svg.setAttribute('width', '32');
  svg.setAttribute('height', '32');
  svg.setAttribute('class', 'pa-badge-svg');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = `
    <defs>
      <linearGradient id="pa-grad" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%"   stop-color="#6366F1"/>
        <stop offset="50%"  stop-color="#8B5CF6"/>
        <stop offset="100%" stop-color="#22D3EE"/>
      </linearGradient>
    </defs>
    <circle cx="20" cy="20" r="18" fill="url(#pa-grad)" opacity="0.14"/>
    <circle cx="20" cy="20" r="18" fill="none" stroke="url(#pa-grad)" stroke-width="1.4"/>
    <text x="20" y="24" text-anchor="middle" font-family="'DM Sans','Inter',sans-serif"
          font-weight="800" font-size="13" fill="url(#pa-grad)" letter-spacing="-0.02em">PA</text>
    <g stroke="url(#pa-grad)" stroke-width="1.2" stroke-linecap="round">
      <line x1="30" y1="32" x2="30" y2="29"/>
      <line x1="32.5" y1="32" x2="32.5" y2="27"/>
      <line x1="35" y1="32" x2="35" y2="25"/>
    </g>
  `;
  return svg;
}

// ─── Modal ────────────────────────────────────────

function openModal(e) {
  e?.stopPropagation?.();

  let overlay = qs('#pa-overlay');
  if (overlay) return; // idempotent

  overlay = h('div', {
    class: 'pa-overlay',
    id: 'pa-overlay',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-labelledby': 'pa-modal-title',
  });

  overlay.innerHTML = `
    <div class="pa-modal glass-panel">
      <button class="pa-modal-close" aria-label="Close attribution">✕</button>

      <div class="pa-modal-head">
        <div class="pa-modal-logo">${renderLogoMarkup()}</div>
        <div>
          <h2 class="pa-modal-title" id="pa-modal-title">${escapeHTML(ATTRIBUTION.brand)}</h2>
          <p class="pa-modal-tagline">${escapeHTML(ATTRIBUTION.tagline)}</p>
        </div>
      </div>

      <dl class="pa-modal-dl">
        <div class="pa-modal-row">
          <dt>Project</dt>
          <dd>${escapeHTML(ATTRIBUTION.project)}</dd>
        </div>
        <div class="pa-modal-row">
          <dt>Developed by</dt>
          <dd>${escapeHTML(ATTRIBUTION.developer)}</dd>
        </div>
        <div class="pa-modal-row">
          <dt>Role</dt>
          <dd>${escapeHTML(ATTRIBUTION.role)}<br/><span class="pa-modal-org">${escapeHTML(ATTRIBUTION.org)}</span></dd>
        </div>
        <div class="pa-modal-row">
          <dt>Technologies</dt>
          <dd class="pa-modal-tech">
            ${ATTRIBUTION.tech.map(t => `<span class="pa-tech-chip">${escapeHTML(t)}</span>`).join('')}
          </dd>
        </div>
        <div class="pa-modal-row">
          <dt>Version</dt>
          <dd><span class="pa-modal-version">${escapeHTML(ATTRIBUTION.version)}</span></dd>
        </div>
      </dl>

      <div class="pa-modal-foot">
        <span>${escapeHTML(ATTRIBUTION.copyright)}</span>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('open'));

  const trigger = document.activeElement;
  _releaseFocus = trapFocus(overlay, { restore: trigger });

  overlay.addEventListener('click', (ev) => {
    if (ev.target === overlay) closeModal();
  });
  overlay.querySelector('.pa-modal-close').addEventListener('click', closeModal);

  const escHandler = (ev) => {
    if (ev.key === 'Escape') { ev.stopPropagation(); closeModal(); }
  };
  overlay.addEventListener('keydown', escHandler);
}

function closeModal() {
  const overlay = qs('#pa-overlay');
  if (!overlay) return;
  overlay.classList.remove('open');
  if (_releaseFocus) { _releaseFocus(); _releaseFocus = null; }
  setTimeout(() => overlay.remove(), 200);
}

function renderLogoMarkup() {
  const tmp = document.createElement('div');
  tmp.appendChild(renderLogoSVG());
  return tmp.innerHTML.replace(/width="32"/, 'width="46"').replace(/height="32"/, 'height="46"');
}

// ─── Public init ──────────────────────────────────

export function initBranding() {
  if (_mounted) return;
  _mounted = true;
  document.body.appendChild(renderBadge());
}
