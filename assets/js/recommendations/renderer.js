/**
 * renderer.js — Recommendation UI renderer.
 *
 * Renders prospect cards into #recommendation-grid and
 * opens a detail modal when a card is clicked showing
 * full recommendation breakdown with Why, Benefits,
 * ROI, Business Value, Priority, Complexity, Timeline.
 */

import { bus }          from '../utils/eventBus.js';
import { qs }           from '../utils/dom.js';
import { Icon }         from '../components/icons.js';
import { generateTopProspects, recommendForCompany, generateStrategySummary } from './engine.js';

const PRIORITY_COLORS = {
  Critical: { bg: 'rgba(220,38,38,0.12)', color: '#f87171', border: 'rgba(220,38,38,0.25)' },
  High:     { bg: 'rgba(245,158,11,0.12)', color: '#fbbf24', border: 'rgba(245,158,11,0.25)' },
  Medium:   { bg: 'rgba(99,102,241,0.12)', color: '#a5b4fc', border: 'rgba(99,102,241,0.25)' },
  Low:      { bg: 'rgba(100,116,139,0.12)', color: '#94a3b8', border: 'rgba(100,116,139,0.25)' },
};

const COMPLEXITY_ICONS = { Low: '●', Medium: '●●', High: '●●●' };

function svgIcon(name) {
  const el = Icon(name);
  const tmp = document.createElement('div');
  tmp.appendChild(el);
  return tmp.innerHTML;
}

function priorityBadge(priority) {
  const c = PRIORITY_COLORS[priority] || PRIORITY_COLORS.Medium;
  return `<span class="rc-badge" style="background:${c.bg};color:${c.color};border-color:${c.border}">${priority}</span>`;
}

function scoreRing(score, size = 44) {
  const r = (size / 2) - 4;
  const c = 2 * Math.PI * r;
  const offset = c - (score / 100) * c;
  const color = score >= 65 ? '#10B981' : score >= 40 ? '#F59E0B' : '#EF4444';

  return `
    <div class="rc-score-ring" style="width:${size}px;height:${size}px">
      <svg viewBox="0 0 ${size} ${size}">
        <circle cx="${size/2}" cy="${size/2}" r="${r}" stroke="var(--border-2)" stroke-width="3" fill="none"/>
        <circle cx="${size/2}" cy="${size/2}" r="${r}" stroke="${color}" stroke-width="3" fill="none"
                stroke-dasharray="${c}" stroke-dashoffset="${offset}" stroke-linecap="round"
                style="transform:rotate(-90deg);transform-origin:center;transition:stroke-dashoffset 0.8s var(--ease-out)"/>
      </svg>
      <span class="rc-score-num" style="color:${color}">${score}</span>
    </div>`;
}

// ─── Prospect Card ─────────────────────────

function renderProspectCard(prospect, index) {
  const { company, topProduct, topScore, topPriority, recoCount, avgScore } = prospect;
  const color = topProduct.color || '#6366F1';

  return `
    <div class="reco-card glass-card rc-anim" style="animation-delay:${index * 60}ms" data-company-idx="${company._idx}">
      <div class="rc-card-top">
        <div class="rc-company-logo" style="background:linear-gradient(135deg,${color}30,${color}10);border-color:${color}40">
          <span style="color:${color}">${(company.companyName || 'CO').slice(0,2).toUpperCase()}</span>
        </div>
        ${scoreRing(avgScore)}
      </div>

      <div class="rc-card-body">
        <h3 class="rc-company-name">${company.companyName}</h3>
        <div class="rc-company-meta">
          <span class="rc-meta-cat">${company.category || '—'}</span>
          <span class="rc-meta-loc">${[company.hqCity, company.state].filter(Boolean).join(', ') || '—'}</span>
        </div>
      </div>

      <div class="rc-card-reco">
        <div class="rc-top-product">
          <span class="rc-product-dot" style="background:${color}"></span>
          <span class="rc-product-name">${topProduct.name}</span>
        </div>
        <div class="rc-card-tags">
          ${priorityBadge(topPriority)}
          <span class="rc-badge rc-badge-count">${recoCount} product${recoCount > 1 ? 's' : ''}</span>
        </div>
      </div>

      <div class="rc-card-footer">
        <button class="btn btn-ghost btn-sm rc-view-btn">View Strategy</button>
      </div>
    </div>`;
}

// ─── Detail Modal Content ──────────────────

function renderRecoDetail(rec) {
  const recos = recommendForCompany(rec);
  if (recos.length === 0) return '<p class="rc-empty">No recommendations for this company.</p>';

  // Analyst-authored note from the source workbook's "Recommended ESDS Products"
  // free-text column, if present. Shown alongside — not in place of — the
  // engine's scored recommendations below, which remain the source of truth
  // for ranking/priority.
  const sourceNote = rec.recommendedProducts
    ? `
      <div class="rc-section rc-source-note">
        <div class="rc-section-title">${svgIcon('info')} Analyst Note (from source data)</div>
        <p class="rc-desc">${rec.recommendedProducts}</p>
      </div>`
    : '';

  return `
    <div class="rc-detail">
      <div class="rc-detail-header">
        <h3>${rec.companyName}</h3>
        <p class="rc-detail-sub">${rec.category || ''} · ${[rec.hqCity, rec.state].filter(Boolean).join(', ')}</p>
        <div class="rc-detail-stats">
          <div class="rc-detail-stat">
            <span class="rc-detail-stat-val">${recos.length}</span>
            <span class="rc-detail-stat-lbl">Products</span>
          </div>
          <div class="rc-detail-stat">
            <span class="rc-detail-stat-val">${recos.filter(r => r.priority === 'Critical').length}</span>
            <span class="rc-detail-stat-lbl">Critical</span>
          </div>
          <div class="rc-detail-stat">
            <span class="rc-detail-stat-val">${rec.buyingPotential ? '₹' + rec.buyingPotential + ' Cr' : '—'}</span>
            <span class="rc-detail-stat-lbl">Potential</span>
          </div>
        </div>
      </div>

      ${sourceNote}

      <div class="rc-detail-list">
        ${recos.map((r, i) => renderRecoItem(r, i)).join('')}
      </div>
    </div>`;
}

function renderRecoItem(reco, index) {
  const p = reco.product;
  const pc = PRIORITY_COLORS[reco.priority] || PRIORITY_COLORS.Medium;

  return `
    <div class="rc-item rc-anim" style="animation-delay:${index * 80}ms">
      <div class="rc-item-head" data-rc-toggle="${index}">
        <div class="rc-item-left">
          <div class="rc-item-icon" style="background:${p.color}20;color:${p.color}">${svgIcon(p.icon || 'layers')}</div>
          <div>
            <div class="rc-item-name">${p.name}</div>
            <div class="rc-item-tagline">${p.tagline}</div>
          </div>
        </div>
        <div class="rc-item-right">
          ${scoreRing(reco.score, 36)}
          ${priorityBadge(reco.priority)}
          <span class="rc-item-chevron">${svgIcon('chevronDown')}</span>
        </div>
      </div>

      <div class="rc-item-body" id="rc-body-${index}">
        <!-- Why -->
        <div class="rc-section">
          <div class="rc-section-title">${svgIcon('info')} Why This Recommendation</div>
          <ul class="rc-reason-list">
            ${reco.reasons.map(r => `<li>${r}</li>`).join('')}
          </ul>
          <p class="rc-desc">${p.description}</p>
        </div>

        <!-- Benefits -->
        <div class="rc-section">
          <div class="rc-section-title">${svgIcon('checkCircle')} Key Benefits</div>
          <div class="rc-benefits">
            ${reco.benefits.map(b => `
              <div class="rc-benefit">
                <span class="rc-benefit-check">✓</span>
                <span>${b}</span>
              </div>
            `).join('')}
          </div>
        </div>

        <!-- ROI & Business Value -->
        <div class="rc-section">
          <div class="rc-section-title">${svgIcon('trendUp')} Expected ROI</div>
          <div class="rc-roi-card">
            <p>${reco.expectedROI}</p>
          </div>
        </div>

        <div class="rc-section">
          <div class="rc-section-title">${svgIcon('star')} Business Value</div>
          <p class="rc-value-text">${reco.businessValue}</p>
        </div>

        <!-- Implementation Details -->
        <div class="rc-impl-grid">
          <div class="rc-impl-item">
            <div class="rc-impl-label">Priority</div>
            <div class="rc-impl-val">${priorityBadge(reco.priority)}</div>
          </div>
          <div class="rc-impl-item">
            <div class="rc-impl-label">Complexity</div>
            <div class="rc-impl-val">
              <span class="rc-complexity" data-level="${reco.complexity.toLowerCase()}">${COMPLEXITY_ICONS[reco.complexity] || '●'}</span>
              ${reco.complexity}
            </div>
          </div>
          <div class="rc-impl-item">
            <div class="rc-impl-label">Timeline</div>
            <div class="rc-impl-val rc-timeline">${svgIcon('target')} ${reco.timeline}</div>
          </div>
        </div>
      </div>
    </div>`;
}

// ─── Strategy Summary Modal ────────────────

function renderStrategySummary(records) {
  const summary = generateStrategySummary(records);

  return `
    <div class="rc-detail rc-strategy">
      <div class="rc-detail-header">
        <h3>ESDS BFSI Strategy Summary</h3>
        <p class="rc-detail-sub">Cross-portfolio opportunity analysis across ${summary.totalCompanies} companies</p>
        <div class="rc-detail-stats">
          <div class="rc-detail-stat">
            <span class="rc-detail-stat-val">${summary.companiesWithRecos}</span>
            <span class="rc-detail-stat-lbl">Addressable</span>
          </div>
          <div class="rc-detail-stat">
            <span class="rc-detail-stat-val">${summary.coveragePercent}%</span>
            <span class="rc-detail-stat-lbl">Coverage</span>
          </div>
          <div class="rc-detail-stat">
            <span class="rc-detail-stat-val">₹${Math.round(summary.totalAddressable)} Cr</span>
            <span class="rc-detail-stat-lbl">Total TAM</span>
          </div>
        </div>
      </div>

      <div class="rc-section">
        <div class="rc-section-title">${svgIcon('chart')} Product Opportunity Ranking</div>
        <div class="rc-product-ranking">
          ${summary.productRanking.slice(0, 10).map((p, i) => {
            const maxCount = summary.productRanking[0]?.count || 1;
            const pct = Math.round((p.count / maxCount) * 100);
            return `
              <div class="rc-rank-row rc-anim" style="animation-delay:${i * 50}ms">
                <div class="rc-rank-num">${i + 1}</div>
                <div class="rc-rank-info">
                  <div class="rc-rank-name">${p.product.name}</div>
                  <div class="rc-rank-bar-wrap">
                    <div class="rc-rank-bar" style="width:${pct}%;background:${p.product.color}"></div>
                  </div>
                </div>
                <div class="rc-rank-count">${p.count} companies</div>
                <div class="rc-rank-score">Avg: ${p.avgScore}</div>
              </div>`;
          }).join('')}
        </div>
      </div>

      <div class="rc-section">
        <div class="rc-section-title">${svgIcon('filter')} Category Breakdown</div>
        <div class="rc-cat-grid">
          ${Object.entries(summary.categoryBreakdown)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 12)
            .map(([cat, count]) => `
              <div class="rc-cat-chip">
                <span class="rc-cat-name">${cat}</span>
                <span class="rc-cat-count">${count}</span>
              </div>
            `).join('')}
        </div>
      </div>
    </div>`;
}

// ─── Modal Helpers ─────────────────────────

function openRecoModal(title, content) {
  let overlay = qs('#rc-modal-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'rc-modal-overlay';
    overlay.className = 'rc-modal-overlay';
    document.body.appendChild(overlay);
  }

  overlay.innerHTML = `
    <div class="rc-modal glass-panel">
      <div class="rc-modal-head">
        <h3>${title}</h3>
        <button class="icon-btn rc-modal-close" aria-label="Close">✕</button>
      </div>
      <div class="rc-modal-body">${content}</div>
    </div>`;

  requestAnimationFrame(() => overlay.classList.add('open'));

  overlay.querySelector('.rc-modal-close').addEventListener('click', closeRecoModal);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeRecoModal();
  });

  // Wire accordion toggles
  overlay.querySelectorAll('[data-rc-toggle]').forEach(head => {
    head.addEventListener('click', () => {
      const idx = head.dataset.rcToggle;
      const body = overlay.querySelector(`#rc-body-${idx}`);
      const item = head.closest('.rc-item');
      if (body && item) {
        item.classList.toggle('rc-expanded');
      }
    });
  });
}

function closeRecoModal() {
  const overlay = qs('#rc-modal-overlay');
  if (overlay) {
    overlay.classList.remove('open');
    setTimeout(() => overlay.remove(), 300);
  }
}

// ─── Public Init ───────────────────────────

let _cache = null;

export function initRecommendations() {
  bus.on('data:ready', ({ cache }) => {
    _cache = cache;
    renderProspectGrid(cache.getAll());
  });

  bus.on('filter:apply', (filters) => {
    if (!_cache) return;
    renderProspectGrid(_cache.query(filters));
  });

  bus.on('filter:reset', () => {
    if (!_cache) return;
    renderProspectGrid(_cache.getAll());
  });

  // View All button
  const viewAllBtn = qs('[data-action="view-all"]');
  viewAllBtn?.addEventListener('click', () => {
    if (!_cache) return;
    const summary = renderStrategySummary(_cache.getAll());
    openRecoModal('Strategy Overview', summary);
  });

  // Generate Strategy button
  const generateBtn = qs('[data-action="generate"]');
  generateBtn?.addEventListener('click', () => {
    if (!_cache) return;
    const summary = renderStrategySummary(_cache.getAll());
    openRecoModal('ESDS BFSI Go-To-Market Strategy', summary);
  });
}

function renderProspectGrid(records) {
  const grid = qs('#recommendation-grid');
  if (!grid) return;

  const prospects = generateTopProspects(records, 12);

  if (prospects.length === 0) {
    grid.innerHTML = '<div class="rc-empty">No recommendations available for the current filter.</div>';
    return;
  }

  grid.innerHTML = prospects.map((p, i) => renderProspectCard(p, i)).join('');

  // Wire card click events
  grid.querySelectorAll('.reco-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('.rc-view-btn')) {
        const idx = parseInt(card.dataset.companyIdx, 10);
        const rec = _cache.getByIndex(idx);
        if (rec) {
          const content = renderRecoDetail(rec);
          openRecoModal(`Strategy: ${rec.companyName}`, content);
        }
        return;
      }
      // Card click → open the Company 360 permalink page
      const idx = parseInt(card.dataset.companyIdx, 10);
      const rec = _cache.getByIndex(idx);
      if (rec && rec._dedupeKey) {
        location.hash = '#/company/' + encodeURIComponent(rec._dedupeKey);
      } else if (rec) {
        bus.emit('company:select', rec);
      }
    });
  });
}
