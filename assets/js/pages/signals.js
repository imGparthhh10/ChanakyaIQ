/**
 * signals.js — Signals feed page.
 *
 * URL: #/signals
 *
 * A time-ordered stream of what changed / what matters. Version 1
 * derives signals from the cache itself (buying potential, pain points,
 * maturity gaps, notes). Once external feeds are wired in (news,
 * hiring, funding), they land here without changing the page shell.
 *
 * Signals are grouped by type with a filter row.
 */

import { bus }         from '../utils/eventBus.js';
import { qs, qsa, h } from '../utils/dom.js';
import { escapeHTML }  from '../utils/sanitize.js';
import { CleanupRegistry } from '../utils/perf.js';
import { workspace }   from '../workspace/store.js';
import { dataEngine }  from '../data/data.js';
import { Icon }        from '../components/icons.js';

const TYPES = [
  { id: 'all',        label: 'All',       color: '#6366F1' },
  { id: 'buying',     label: 'Buying',    color: '#10B981' },
  { id: 'gap',        label: 'Gaps',      color: '#3B82F6' },
  { id: 'risk',       label: 'Risk',      color: '#EF4444' },
  { id: 'initiative', label: 'Initiative',color: '#F59E0B' },
  { id: 'internal',   label: 'Internal',  color: '#A855F7' },
];

function svgIcon(name) {
  const el = Icon(name);
  const tmp = document.createElement('div');
  tmp.appendChild(el);
  return tmp.innerHTML;
}

/**
 * Build signals from cache — derived, not stored. Once a real signals
 * ingestion pipeline exists, replace with `readSignalsStore()`.
 */
function deriveSignals(cache, filter = 'all', limit = 100) {
  if (!cache) return [];
  const now = Date.now();
  const out = [];

  for (const rec of cache.getAll()) {
    const push = (type, tone, text) => {
      out.push({
        type, tone, text,
        company: rec.companyName,
        key: rec._dedupeKey,
        category: rec.category,
        state: rec.state,
        at: now,
      });
    };

    if (rec.buyingPotential != null && rec.buyingPotential >= 20) {
      push('buying', 'positive', `Estimated ₹${rec.buyingPotential} Cr/yr buying potential`);
    }
    if (rec.cloudMaturity === 'Low') {
      push('gap', 'positive', 'Low cloud maturity — modernization opportunity');
    }
    if (rec.aiReadiness === 'Low' && (rec.revenue || 0) > 500) {
      push('gap', 'positive', 'Low AI readiness with material revenue base — greenfield AI play');
    }
    if (rec.cyberMaturity === 'Low') {
      push('risk', 'warn', 'Low cyber maturity — SOC / SIEM / DRaaS uplift opportunity');
    }
    if (rec.initiatives) {
      push('initiative', 'positive', 'Digital initiatives in progress');
    }
    if (out.length > limit * 10) break;
  }

  // Add workspace signals (notes are internal signals)
  const notesAll = readAllNotes();
  for (const [key, notes] of Object.entries(notesAll)) {
    const rec = cache.getAll().find(r => r._dedupeKey === key);
    if (!rec) continue;
    for (const n of notes.slice(0, 3)) {
      out.push({
        type: 'internal',
        tone: 'neutral',
        text: n.text,
        company: rec.companyName,
        key: rec._dedupeKey,
        category: rec.category,
        state: rec.state,
        at: new Date(n.createdAt).getTime(),
        author: n.author,
      });
    }
  }

  // Sort newest first (notes have real timestamps; derived get now)
  out.sort((a, b) => b.at - a.at);

  // Filter
  const filtered = filter === 'all' ? out : out.filter(s => s.type === filter);

  return filtered.slice(0, limit);
}

function readAllNotes() {
  try {
    return JSON.parse(localStorage.getItem('boip.notes.v1') || '{}') || {};
  } catch { return {}; }
}

function renderSignal(s) {
  const type = TYPES.find(t => t.id === s.type) || TYPES[0];
  return `<article class="signals-item">
    <div class="signals-item-side">
      <div class="signals-item-dot" style="background:${type.color}"></div>
      <div class="signals-item-line"></div>
    </div>
    <div class="signals-item-body">
      <div class="signals-item-head">
        <span class="signals-item-type" style="color:${type.color};border-color:${type.color}44">${escapeHTML(type.label)}</span>
        <a class="signals-item-company" href="#/company/${encodeURIComponent(s.key)}">${escapeHTML(s.company)}</a>
        ${s.category ? `<span class="signals-item-meta">${escapeHTML(s.category)}</span>` : ''}
        ${s.state ? `<span class="signals-item-meta">${escapeHTML(s.state)}</span>` : ''}
        ${s.author ? `<span class="signals-item-meta">by ${escapeHTML(s.author)}</span>` : ''}
      </div>
      <div class="signals-item-text">${escapeHTML(s.text)}</div>
    </div>
  </article>`;
}

export async function mountSignalsFeed(container) {
  const cache = dataEngine.cache;

  container.innerHTML = `
    <div class="page-container">
      <header class="page-header glass-panel">
        <div class="page-header-left">
          <span class="eyebrow">Feed</span>
          <h1 class="page-title">Signals</h1>
          <p class="page-sub">What matters in your target book — derived from the current dataset. Filters narrow the stream.</p>
        </div>
        <div class="page-header-right">
          <button class="btn btn-ghost" id="signals-refresh">${svgIcon('refresh')} Refresh</button>
        </div>
      </header>

      <nav class="signals-filter-bar" role="tablist" aria-label="Signal type filter">
        ${TYPES.map(t => `<button class="signals-filter${t.id === 'all' ? ' active' : ''}" data-type="${t.id}" role="tab" aria-selected="${t.id === 'all'}">
          <span class="signals-filter-dot" style="background:${t.color}"></span>${escapeHTML(t.label)}
        </button>`).join('')}
      </nav>

      <section class="signals-feed" id="signals-feed"></section>
    </div>`;

  const feedEl = qs('#signals-feed', container);

  const draw = (filter) => {
    if (!cache) {
      feedEl.innerHTML = '<div class="signals-empty">Waiting for data engine…</div>';
      return;
    }
    const signals = deriveSignals(cache, filter, 100);
    if (!signals.length) {
      feedEl.innerHTML = '<div class="signals-empty">No signals of this type yet. Try another filter, or add a note on a company.</div>';
      return;
    }
    feedEl.innerHTML = signals.map(renderSignal).join('');
  };

  draw('all');

  const cleanup = new CleanupRegistry();

  qsa('.signals-filter', container).forEach(btn => {
    cleanup.addListener(btn, 'click', () => {
      qsa('.signals-filter', container).forEach(b => {
        b.classList.remove('active');
        b.setAttribute('aria-selected', 'false');
      });
      btn.classList.add('active');
      btn.setAttribute('aria-selected', 'true');
      draw(btn.dataset.type);
    });
  });

  cleanup.addListener(qs('#signals-refresh', container), 'click', () => {
    const active = qs('.signals-filter.active', container)?.dataset.type || 'all';
    draw(active);
  });

  cleanup.add(bus.on('workspace:notes:change', () => {
    const active = qs('.signals-filter.active', container)?.dataset.type || 'all';
    draw(active);
  }));

  cleanup.add(bus.on('data:ready', () => draw('all')));

  return () => cleanup.dispose();
}
