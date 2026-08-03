/**
 * digest.js — Weekly digest — the "why open the app today" surface.
 *
 * URL: #/digest
 *
 * Personalized to identity.current():
 *   ┌ Greeting + week summary                          ┐
 *   ├ Score movers in MY book (up + down)              ┤
 *   ├ Top 5 accounts to action this week (owned only)  ┤
 *   ├ New signals across the book                       ┤
 *   ├ Data freshness watchlist (accounts needing work)  ┤
 *   └ Print-friendly export button                      ┘
 *
 * Zero LLM — all deterministic. When a real digest scheduler + LLM
 * lands later, we replace the compute layer, not the page.
 */

import { bus }                       from '../utils/eventBus.js';
import { qs }                        from '../utils/dom.js';
import { escapeHTML }                from '../utils/sanitize.js';
import { CleanupRegistry }           from '../utils/perf.js';
import { Icon }                      from '../components/icons.js';
import { dataEngine }                from '../data/data.js';
import { identity }                  from '../workspace/identity.js';
import { territory }                 from '../workspace/territory.js';
import { workspace }                 from '../workspace/store.js';
import { opportunityValue, confidenceScore } from '../workspace/scoring.js';
import { deriveSignalTypes }         from '../workspace/signals.js';
import { topMovers, delta }          from '../workspace/scoreHistory.js';

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

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

// ─── Sections ─────────────────────────────────────

function renderHero(user, myBook) {
  const summary = workspace.summary();
  return `
    <section class="glass-panel digest-hero">
      <div class="digest-hero-avatar" style="background:${user?.color || '#6366F1'}22;color:${user?.color || '#818CF8'}">${escapeHTML(user?.initials || 'U')}</div>
      <div class="digest-hero-body">
        <h1 class="digest-hero-title">${greeting()}, ${escapeHTML((user?.name || 'there').split(' ')[0])}.</h1>
        <p class="digest-hero-sub">Here's what changed in your book this week.</p>
        <div class="digest-hero-stats">
          <span><b>${myBook.length}</b> accounts</span>
          <span><b>${summary.bookmarks}</b> bookmarks</span>
          <span><b>${summary.notes}</b> notes</span>
        </div>
      </div>
      <button class="btn btn-ghost" id="digest-print">${svgIcon('download')} Print / PDF</button>
    </section>`;
}

function renderMovers(myBook) {
  const inBook = new Set(myBook.map(r => r._dedupeKey));
  const up   = topMovers('up',   20).filter(m => inBook.has(m.key)).slice(0, 5);
  const down = topMovers('down', 20).filter(m => inBook.has(m.key)).slice(0, 5);

  const line = (m, dir) => {
    const rec = myBook.find(r => r._dedupeKey === m.key);
    if (!rec) return '';
    const arrow = dir === 'up' ? '▲' : '▼';
    const cls   = dir === 'up' ? 'exec-mover-up' : 'exec-mover-down';
    return `<a class="exec-mover" href="#/company/${encodeURIComponent(m.key)}">
      <span class="exec-mover-arrow ${cls}">${arrow} ${Math.abs(m.delta)}</span>
      <span class="exec-mover-name">${escapeHTML(rec.companyName)}</span>
      <span class="exec-mover-score">${m.current}</span>
    </a>`;
  };

  if (!up.length && !down.length) {
    return `<section class="glass-panel digest-block">
      <h3 class="exec-panel-title">${svgIcon('trendUp')} Score Movers</h3>
      <p class="c360-empty">No score changes in your book since the last data load. Deltas populate when data refreshes.</p>
    </section>`;
  }

  return `<section class="glass-panel digest-block">
    <h3 class="exec-panel-title">${svgIcon('trendUp')} Score Movers in Your Book</h3>
    <div class="exec-movers">
      <div class="exec-movers-col">
        <div class="exec-movers-title exec-mover-up">▲ Up</div>
        ${up.map(m => line(m, 'up')).join('') || '<p class="c360-empty">No upward movers.</p>'}
      </div>
      <div class="exec-movers-col">
        <div class="exec-movers-title exec-mover-down">▼ Down</div>
        ${down.map(m => line(m, 'down')).join('') || '<p class="c360-empty">No downward movers.</p>'}
      </div>
    </div>
  </section>`;
}

function renderTop5Actions(myBook) {
  const scored = myBook.map(r => ({ rec: r, score: opportunityValue(r) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  if (!scored.length) {
    return `<section class="glass-panel digest-block">
      <h3 class="exec-panel-title">${svgIcon('target')} Top Accounts to Action</h3>
      <p class="c360-empty">Nothing in your book yet. Head to <a href="#/whitespace">Whitespace</a> to pick your first 10.</p>
    </section>`;
  }

  return `<section class="glass-panel digest-block">
    <h3 class="exec-panel-title">${svgIcon('target')} Top 5 to Action This Week</h3>
    <div class="digest-actions">
      ${scored.map((it, i) => {
        const rec = it.rec;
        const status = workspace.getStatus(rec._dedupeKey);
        const nextAction = suggestNext(rec, it.score, status);
        return `<div class="digest-action">
          <div class="digest-action-num">${i + 1}</div>
          <div class="digest-action-body">
            <a class="digest-action-name" href="#/company/${encodeURIComponent(rec._dedupeKey)}">${escapeHTML(rec.companyName)}</a>
            <div class="digest-action-meta">Score ${it.score} · ${escapeHTML(status)} · ${escapeHTML(rec.category || '—')}</div>
            <div class="digest-action-next">${escapeHTML(nextAction)}</div>
          </div>
        </div>`;
      }).join('')}
    </div>
  </section>`;
}

function suggestNext(rec, score, status) {
  if (status === 'New' && score >= 65)      return 'Book a discovery call this week — hot lead.';
  if (status === 'New' && score >= 40)      return 'Send a personalized outreach citing one specific pain point.';
  if (status === 'Researching')             return 'Complete research: identify the buying committee and initiate contact.';
  if (status === 'Contacted')               return 'Follow up. If no response in 5 days, escalate or nurture.';
  if (status === 'Qualified')               return 'Prepare tailored proposal — anchor to top-fit product.';
  if (status === 'Won')                     return 'Cross-sell review: which adjacent products fit next?';
  if (status === 'Lost' || status === 'DQ') return 'Re-qualify in 90 days.';
  return 'Add first-party research note and set status.';
}

function renderNewSignals(cache, myBook) {
  const inBook = new Set(myBook.map(r => r._dedupeKey));
  const withSignals = [];
  for (const rec of cache.getAll()) {
    if (inBook.has(rec._dedupeKey)) continue; // Book handled above
    const types = deriveSignalTypes(rec);
    if (types.size === 0) continue;
    withSignals.push({ rec, types: [...types] });
    if (withSignals.length >= 8) break;
  }

  if (!withSignals.length) return '';

  return `<section class="glass-panel digest-block">
    <h3 class="exec-panel-title">${svgIcon('zap')} New Signals Across the Book</h3>
    <p class="digest-block-hint">Accounts outside your book with fresh signal activity. Consider adding to your book.</p>
    <div class="exec-signals-list">
      ${withSignals.map(({ rec, types }) => `<a class="exec-signal" href="#/company/${encodeURIComponent(rec._dedupeKey)}">
        <span class="exec-signal-type" style="background:rgba(99,102,241,0.15);color:#a5b4fc">${escapeHTML(types[0])}</span>
        <span class="exec-signal-body">
          <span class="exec-signal-company">${escapeHTML(rec.companyName)}</span>
          <span class="exec-signal-text">${escapeHTML([rec.category, rec.state].filter(Boolean).join(' · '))}</span>
        </span>
      </a>`).join('')}
    </div>
  </section>`;
}

function renderDataAlerts(myBook) {
  // Accounts with confidence below 50% — enrich to get better scoring
  const low = myBook
    .map(r => ({ rec: r, conf: confidenceScore(r) }))
    .filter(x => x.conf < 50)
    .sort((a, b) => a.conf - b.conf)
    .slice(0, 6);

  if (!low.length) return '';

  return `<section class="glass-panel digest-block">
    <h3 class="exec-panel-title">${svgIcon('alertCircle')} Enrichment Watchlist</h3>
    <p class="digest-block-hint">Accounts in your book with low data completeness — enrich to unlock accurate scoring.</p>
    <div class="digest-alerts">
      ${low.map(({ rec, conf }) => `<a class="digest-alert" href="#/company/${encodeURIComponent(rec._dedupeKey)}">
        <div class="digest-alert-info">
          <span class="digest-alert-name">${escapeHTML(rec.companyName)}</span>
          <span class="digest-alert-meta">${escapeHTML([rec.category, rec.state].filter(Boolean).join(' · '))}</span>
        </div>
        <span class="digest-alert-conf" style="color:${conf < 30 ? '#EF4444' : '#F59E0B'}">${conf}% complete</span>
      </a>`).join('')}
    </div>
  </section>`;
}

// ─── Mount ────────────────────────────────────────

export async function mountDigest(container) {
  const cache = dataEngine.cache;
  const user  = identity.current();

  if (!cache) {
    container.innerHTML = `<div class="page-container"><section class="glass-panel"><p style="padding:var(--sp-6);text-align:center;color:var(--text-muted)">Waiting for data engine…</p></section></div>`;
    const off = bus.on('data:ready', () => { off(); mountDigest(container); });
    return () => off();
  }

  const myBook = territory.myBook(cache);

  container.innerHTML = `
    <div class="page-container digest-page">
      ${renderHero(user, myBook)}
      ${renderMovers(myBook)}
      ${renderTop5Actions(myBook)}
      ${renderNewSignals(cache, myBook)}
      ${renderDataAlerts(myBook)}
    </div>`;

  const cleanup = new CleanupRegistry();
  cleanup.addListener(qs('#digest-print', container), 'click', () => {
    window.print();
  });
  cleanup.add(bus.on('identity:change', () => mountDigest(container)));
  cleanup.add(bus.on('territory:change', () => mountDigest(container)));

  return () => cleanup.dispose();
}
