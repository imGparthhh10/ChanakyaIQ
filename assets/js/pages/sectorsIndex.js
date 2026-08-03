/**
 * sectorsIndex.js — Sectors index page.
 *
 * URL: #/sectors
 *
 * Grid of all sectors in the cache with company count + TAM,
 * each card links to the sector deep-dive at #/sector/:key.
 */

import { bus }               from '../utils/eventBus.js';
import { escapeHTML }        from '../utils/sanitize.js';
import { Icon }              from '../components/icons.js';
import { dataEngine }        from '../data/data.js';
import { opportunityValue }  from '../workspace/scoring.js';

function svgIcon(name) {
  const el = Icon(name);
  const tmp = document.createElement('div');
  tmp.appendChild(el);
  return tmp.innerHTML;
}

function fmt(n) {
  if (n == null) return '—';
  if (n >= 1000) return '₹' + (n / 1000).toFixed(1) + 'K Cr';
  return '₹' + Number(n).toFixed(0) + ' Cr';
}

export async function mountSectorsIndex(container) {
  const cache = dataEngine.cache;
  if (!cache) {
    container.innerHTML = `<div class="page-container"><section class="glass-panel"><p style="padding:var(--sp-6);text-align:center;color:var(--text-muted)">Waiting for data engine…</p></section></div>`;
    const off = bus.on('data:ready', () => { off(); mountSectorsIndex(container); });
    return () => off();
  }

  const sectors = cache.categories().map(name => {
    const recs = cache.getByCategory(name);
    let tam = 0, sum = 0;
    for (const r of recs) { tam += (r.buyingPotential || 0); sum += opportunityValue(r); }
    return {
      name,
      count: recs.length,
      tam,
      avg: recs.length ? Math.round(sum / recs.length) : 0,
    };
  }).sort((a, b) => b.tam - a.tam);

  container.innerHTML = `
    <div class="page-container">
      <header class="page-header glass-panel">
        <div class="page-header-left">
          <span class="eyebrow">Market Intelligence</span>
          <h1 class="page-title">Sectors</h1>
          <p class="page-sub">Every BFSI sub-sector we track. Click through for a deep dive.</p>
        </div>
      </header>

      <section class="sectors-grid">
        ${sectors.map(s => `<a class="sectors-card glass-panel" href="#/sector/${encodeURIComponent(s.name)}">
          <div class="sectors-card-icon">${svgIcon('layers')}</div>
          <div class="sectors-card-body">
            <h3 class="sectors-card-name">${escapeHTML(s.name)}</h3>
            <div class="sectors-card-stats">
              <span><b>${s.count.toLocaleString('en-IN')}</b> companies</span>
              <span><b>${escapeHTML(fmt(s.tam))}</b> TAM</span>
              <span>Avg score <b>${s.avg}</b></span>
            </div>
          </div>
          <span class="sectors-card-arrow">${svgIcon('chevronRight')}</span>
        </a>`).join('')}
      </section>
    </div>`;

  return () => {};
}
