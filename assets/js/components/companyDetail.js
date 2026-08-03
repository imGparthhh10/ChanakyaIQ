/**
 * companyDetail.js — Company intelligence profile drawer content.
 *
 * Listens for 'company:select' events, populates the drawer
 * with full company data in a rich card-based layout with
 * progress bars, badges, icons, and animations.
 */

import { bus }         from '../utils/eventBus.js';
import { qs }          from '../utils/dom.js';
import { Icon }        from './icons.js';
import { drawer }      from './drawer.js';
import { opportunityValue } from '../workspace/scoring.js';

// ─── Score / Maturity helpers ──────────────

function maturityToPercent(level) {
  if (!level) return 0;
  const l = level.toLowerCase();
  if (l === 'high' || l === 'advanced')   return 85;
  if (l === 'medium' || l === 'moderate') return 55;
  if (l === 'low' || l === 'basic')       return 25;
  return 40;
}

function maturityColor(level) {
  if (!level) return 'var(--text-muted)';
  const l = level.toLowerCase();
  if (l === 'high' || l === 'advanced')   return 'var(--esds-green)';
  if (l === 'medium' || l === 'moderate') return 'var(--amber)';
  if (l === 'low' || l === 'basic')       return 'var(--esds-red)';
  return 'var(--text-muted)';
}

function maturityBadgeClass(level) {
  if (!level) return 'badge-muted';
  const l = level.toLowerCase();
  if (l === 'high' || l === 'advanced')   return 'badge-green';
  if (l === 'medium' || l === 'moderate') return 'badge-amber';
  if (l === 'low' || l === 'basic')       return 'badge-red';
  return 'badge-muted';
}

function buyingPotentialLabel(val) {
  if (val == null) return { label: 'Unknown', cls: 'badge-muted' };
  if (val >= 50)   return { label: 'Very High', cls: 'badge-green' };
  if (val >= 20)   return { label: 'High', cls: 'badge-teal' };
  if (val >= 5)    return { label: 'Medium', cls: 'badge-amber' };
  return { label: 'Low', cls: 'badge-red' };
}

function cyberScore(rec) {
  let s = 50;
  if (rec.cyberMaturity === 'High')   s = 85;
  if (rec.cyberMaturity === 'Medium') s = 55;
  if (rec.cyberMaturity === 'Low')    s = 25;
  if (rec.cyberSpend && rec.cyberSpend > 50) s += 10;
  return Math.min(s, 100);
}

function leadPriority(rec) {
  const opp = opportunityValue(rec);
  if (opp >= 65) return { label: 'Hot Lead',  cls: 'badge-red',   icon: 'zap' };
  if (opp >= 40) return { label: 'Warm Lead', cls: 'badge-amber', icon: 'trendUp' };
  return { label: 'Nurture',   cls: 'badge-muted', icon: 'target' };
}

function formatCurrency(n) {
  if (n == null || n === 0) return '—';
  if (n >= 100000) return `₹${(n / 10000000 * 100).toFixed(1)} Cr`;
  if (n >= 100)    return `₹${n.toLocaleString('en-IN')} Cr`;
  return `₹${n.toFixed(1)} Cr`;
}

function formatCount(n) {
  if (n == null) return '—';
  if (n >= 100000) return `${(n / 100000).toFixed(1)}L`;
  if (n >= 1000)   return `${(n / 1000).toFixed(1)}K`;
  return n.toLocaleString('en-IN');
}

function generateInitials(name) {
  if (!name) return 'CO';
  return name.split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
}

function categoryColor(cat) {
  const map = {
    'Public Sector Bank': '#1E40AF', 'Private Bank': '#7C3AED', 'Foreign Bank': '#0891B2',
    'Small Finance Bank': '#0D9488', 'Payments Bank': '#059669', 'Cooperative Bank': '#16A34A',
    'NBFC': '#EA580C', 'Housing Finance': '#D97706', 'Microfinance': '#CA8A04',
    'Gold Loan': '#EAB308', 'Life Insurance': '#DB2777', 'General Insurance': '#C026D3',
    'Health Insurance': '#9333EA', 'AMC': '#6366F1', 'FinTech': '#06B6D4',
    'Stock Broking': '#2563EB', 'Wealth Management': '#4F46E5',
    'Market Infrastructure': '#0EA5E9',
  };
  return map[cat] || '#64748B';
}

// ─── SVG icon markup (inline, no import needed for template) ─

function svgIcon(name) {
  const el = Icon(name);
  const tmp = document.createElement('div');
  tmp.appendChild(el);
  return tmp.innerHTML;
}

// ─── Section Builders ──────────────────────

function buildHeader(rec) {
  const color = categoryColor(rec.category);
  const initials = generateInitials(rec.companyName);
  const lead = leadPriority(rec);

  return `
    <div class="cd-header" style="--cat-color:${color}">
      <div class="cd-logo-wrap">
        <div class="cd-logo" style="background:linear-gradient(135deg, ${color}40, ${color}20);border-color:${color}50">
          <span class="cd-initials" style="color:${color}">${initials}</span>
        </div>
        <div class="cd-lead-badge cd-badge ${lead.cls}">${svgIcon(lead.icon)} ${lead.label}</div>
      </div>
      <h2 class="cd-company-name">${rec.companyName || '—'}</h2>
      <div class="cd-meta-row">
        <span class="cd-badge cd-badge-cat" style="background:${color}20;color:${color};border-color:${color}40">${rec.category || '—'}</span>
        ${rec.subSector ? `<span class="cd-badge badge-muted">${rec.subSector}</span>` : ''}
        ${rec.listedStatus ? `<span class="cd-badge ${rec.listedStatus === 'Listed' ? 'badge-green' : 'badge-muted'}">${rec.listedStatus}</span>` : ''}
      </div>
    </div>`;
}

function buildLocationCard(rec) {
  return `
    <div class="cd-card cd-anim-card">
      <div class="cd-card-head">
        <span class="cd-card-icon">${svgIcon('map')}</span>
        <span class="cd-card-title">Location</span>
      </div>
      <div class="cd-info-grid">
        ${infoRow('City', rec.hqCity)}
        ${infoRow('State', rec.state)}
        ${infoRow('Region', rec.region)}
      </div>
    </div>`;
}

function buildFinancialsCard(rec) {
  return `
    <div class="cd-card cd-anim-card">
      <div class="cd-card-head">
        <span class="cd-card-icon">${svgIcon('dollar')}</span>
        <span class="cd-card-title">Financials</span>
      </div>
      <div class="cd-stats-grid">
        ${statTile('Revenue', formatCurrency(rec.revenue), 'var(--esds-green)')}
        ${statTile('Net Profit', formatCurrency(rec.netProfit), 'var(--esds-blue)')}
        ${statTile('Market Cap', formatCurrency(rec.marketCap), 'var(--esds-purple)')}
        ${statTile('AUM', formatCurrency(rec.aum), 'var(--esds-teal)')}
      </div>
      <div class="cd-info-grid cd-mt">
        ${infoRow('Employees', formatCount(rec.employeeCount))}
        ${infoRow('Branches', formatCount(rec.branchCount))}
        ${infoRow('Customers', rec.customerBase || '—')}
      </div>
    </div>`;
}

function buildLeadershipCard(rec) {
  const leaders = [
    { role: 'CEO / MD',  name: rec.ceo },
    { role: 'Chairman',  name: rec.chairman },
    { role: 'CTO',       name: rec.cto },
    { role: 'CIO',       name: rec.cio },
    { role: 'CFO',       name: rec.cfo },
    { role: 'CISO',      name: rec.ciso },
  ].filter(l => l.name);

  if (leaders.length === 0) return '';

  return `
    <div class="cd-card cd-anim-card">
      <div class="cd-card-head">
        <span class="cd-card-icon">${svgIcon('user')}</span>
        <span class="cd-card-title">Leadership</span>
      </div>
      <div class="cd-leaders">
        ${leaders.map(l => `
          <div class="cd-leader">
            <div class="cd-leader-avatar">${l.name.charAt(0)}</div>
            <div class="cd-leader-info">
              <div class="cd-leader-name">${l.name}</div>
              <div class="cd-leader-role">${l.role}</div>
            </div>
          </div>
        `).join('')}
      </div>
    </div>`;
}

function buildITSpendCard(rec) {
  const spends = [
    { label: 'IT Spend',    value: rec.itSpend,    color: 'var(--esds-blue)' },
    { label: 'Cloud Spend', value: rec.cloudSpend,  color: 'var(--esds-teal)' },
    { label: 'Cyber Spend', value: rec.cyberSpend,  color: 'var(--esds-purple)' },
    { label: 'DC Spend',    value: rec.dcSpend,     color: 'var(--esds-orange)' },
    { label: 'AI Spend',    value: rec.aiSpend,     color: 'var(--violet)' },
  ].filter(s => s.value != null && s.value > 0);

  if (spends.length === 0) return '';

  const maxSpend = Math.max(...spends.map(s => s.value));

  return `
    <div class="cd-card cd-anim-card">
      <div class="cd-card-head">
        <span class="cd-card-icon">${svgIcon('chart')}</span>
        <span class="cd-card-title">Technology Spend</span>
      </div>
      <div class="cd-spend-bars">
        ${spends.map(s => `
          <div class="cd-spend-row">
            <div class="cd-spend-label">${s.label}</div>
            <div class="cd-spend-bar-wrap">
              <div class="cd-spend-bar" style="width:${Math.round((s.value / maxSpend) * 100)}%;background:${s.color}"></div>
            </div>
            <div class="cd-spend-val">${formatCurrency(s.value)}</div>
          </div>
        `).join('')}
      </div>
    </div>`;
}

function buildMaturityCard(rec) {
  const maturity = [
    { label: 'Digital Maturity',     value: rec.digitalMaturity },
    { label: 'Cloud Adoption',       value: rec.cloudMaturity },
    { label: 'AI Readiness',         value: rec.aiReadiness },
    { label: 'Cybersecurity Maturity', value: rec.cyberMaturity },
  ];

  const oppScore  = opportunityValue(rec);
  const cybScore  = cyberScore(rec);
  const buying    = buyingPotentialLabel(rec.buyingPotential);

  return `
    <div class="cd-card cd-anim-card">
      <div class="cd-card-head">
        <span class="cd-card-icon">${svgIcon('target')}</span>
        <span class="cd-card-title">Maturity & Scores</span>
      </div>

      <div class="cd-score-row">
        ${circularProgress('Opportunity', oppScore, oppScore >= 65 ? 'var(--esds-green)' : oppScore >= 40 ? 'var(--amber)' : 'var(--esds-red)')}
        ${circularProgress('Cyber Score', cybScore, cybScore >= 65 ? 'var(--esds-green)' : cybScore >= 40 ? 'var(--amber)' : 'var(--esds-red)')}
      </div>

      <div class="cd-maturity-list">
        ${maturity.map(m => `
          <div class="cd-maturity-item">
            <div class="cd-maturity-label">${m.label}</div>
            <div class="cd-maturity-bar-wrap">
              <div class="cd-maturity-bar" style="width:${maturityToPercent(m.value)}%;background:${maturityColor(m.value)}"></div>
            </div>
            <span class="cd-badge ${maturityBadgeClass(m.value)}">${m.value || 'N/A'}</span>
          </div>
        `).join('')}
      </div>

      <div class="cd-info-grid cd-mt">
        ${infoRow('Buying Potential', rec.buyingPotential ? `₹${rec.buyingPotential} Cr/yr` : '—')}
        <div class="cd-info-row">
          <span class="cd-info-label">Lead Priority</span>
          <span class="cd-badge ${leadPriority(rec).cls}">${leadPriority(rec).label}</span>
        </div>
        <div class="cd-info-row">
          <span class="cd-info-label">Buying Signal</span>
          <span class="cd-badge ${buying.cls}">${buying.label}</span>
        </div>
      </div>
    </div>`;
}

function buildTechCard(rec) {
  const hasTech = rec.corePlatform || rec.techStack;
  if (!hasTech) return '';

  return `
    <div class="cd-card cd-anim-card">
      <div class="cd-card-head">
        <span class="cd-card-icon">${svgIcon('layers')}</span>
        <span class="cd-card-title">Technology Stack</span>
      </div>
      ${rec.corePlatform ? `
        <div class="cd-tech-section">
          <div class="cd-tech-label">Core Platform</div>
          <div class="cd-tech-tags">${renderTags(rec.corePlatform)}</div>
        </div>` : ''}
      ${rec.techStack ? `
        <div class="cd-tech-section">
          <div class="cd-tech-label">Stack</div>
          <div class="cd-tech-tags">${renderTags(rec.techStack)}</div>
        </div>` : ''}
    </div>`;
}

function buildInsightsCard(rec) {
  const hasPain = rec.painPoints;
  const hasInit = rec.initiatives;
  if (!hasPain && !hasInit) return '';

  return `
    <div class="cd-card cd-anim-card">
      <div class="cd-card-head">
        <span class="cd-card-icon">${svgIcon('alertCircle')}</span>
        <span class="cd-card-title">Insights & Pain Points</span>
      </div>
      ${hasPain ? `
        <div class="cd-insight-section">
          <div class="cd-insight-label">Pain Points</div>
          <div class="cd-insight-text">${rec.painPoints}</div>
        </div>` : ''}
      ${hasInit ? `
        <div class="cd-insight-section">
          <div class="cd-insight-label">Digital Initiatives</div>
          <div class="cd-insight-text">${rec.initiatives}</div>
        </div>` : ''}
    </div>`;
}

function buildNotesCard(rec) {
  const hasNotes = rec.notes || rec.esdsFitNotes;
  if (!hasNotes) return '';

  return `
    <div class="cd-card cd-anim-card">
      <div class="cd-card-head">
        <span class="cd-card-icon">${svgIcon('edit')}</span>
        <span class="cd-card-title">Notes & Updates</span>
      </div>
      ${rec.notes ? `
        <div class="cd-insight-section">
          <div class="cd-insight-label">Notes</div>
          <div class="cd-insight-text">${rec.notes}</div>
        </div>` : ''}
      ${rec.esdsFitNotes ? `
        <div class="cd-insight-section">
          <div class="cd-insight-label">ESDS Fit Notes</div>
          <div class="cd-insight-text">${rec.esdsFitNotes}</div>
        </div>` : ''}
      ${rec.verificationSources ? `
        <div class="cd-insight-section">
          <div class="cd-insight-label">Sources</div>
          <div class="cd-insight-text cd-sources">${rec.verificationSources}</div>
        </div>` : ''}
    </div>`;
}

function buildWebsiteCard(rec) {
  if (!rec.website) return '';
  const url = rec.website.startsWith('http') ? rec.website : `https://${rec.website}`;

  return `
    <div class="cd-card cd-anim-card cd-card-link">
      <a href="${url}" target="_blank" rel="noopener noreferrer" class="cd-website-link">
        ${svgIcon('globe')}
        <span>${rec.website}</span>
        ${svgIcon('external')}
      </a>
    </div>`;
}

// ─── Template Helpers ──────────────────────

function infoRow(label, value) {
  return `
    <div class="cd-info-row">
      <span class="cd-info-label">${label}</span>
      <span class="cd-info-value">${value || '—'}</span>
    </div>`;
}

function statTile(label, value, color) {
  return `
    <div class="cd-stat-tile">
      <div class="cd-stat-value" style="color:${color}">${value}</div>
      <div class="cd-stat-label">${label}</div>
    </div>`;
}

function circularProgress(label, pct, color) {
  const r = 32;
  const c = 2 * Math.PI * r;
  const offset = c - (pct / 100) * c;

  return `
    <div class="cd-circular">
      <svg class="cd-circular-svg" viewBox="0 0 80 80">
        <circle cx="40" cy="40" r="${r}" stroke="var(--border-2)" stroke-width="6" fill="none"/>
        <circle cx="40" cy="40" r="${r}" stroke="${color}" stroke-width="6" fill="none"
                stroke-dasharray="${c}" stroke-dashoffset="${offset}"
                stroke-linecap="round" class="cd-circular-bar" style="--target-offset:${offset}"/>
      </svg>
      <div class="cd-circular-inner">
        <span class="cd-circular-pct" style="color:${color}">${pct}</span>
      </div>
      <div class="cd-circular-label">${label}</div>
    </div>`;
}

function renderTags(text) {
  if (!text) return '';
  const items = text.split(/[,;|\/]+/).map(s => s.trim()).filter(Boolean);
  return items.map(t => `<span class="cd-tag">${t}</span>`).join('');
}

// ─── Main Render ───────────────────────────

function renderCompanyDetail(rec) {
  const body = qs('.drawer-body');
  if (!body) return;

  body.innerHTML = `
    ${buildHeader(rec)}
    ${buildLocationCard(rec)}
    ${buildFinancialsCard(rec)}
    ${buildLeadershipCard(rec)}
    ${buildITSpendCard(rec)}
    ${buildMaturityCard(rec)}
    ${buildTechCard(rec)}
    ${buildInsightsCard(rec)}
    ${buildNotesCard(rec)}
    ${buildWebsiteCard(rec)}
  `;

  // Stagger card entrance animations
  const cards = body.querySelectorAll('.cd-anim-card');
  cards.forEach((card, i) => {
    card.style.animationDelay = `${i * 60}ms`;
  });

  // Animate circular progress bars
  requestAnimationFrame(() => {
    body.querySelectorAll('.cd-circular-bar').forEach(bar => {
      bar.classList.add('cd-animate');
    });
  });
}

function updateFooter(rec) {
  const foot = qs('.drawer-foot');
  if (!foot) return;

  const url = rec.website
    ? (rec.website.startsWith('http') ? rec.website : `https://${rec.website}`)
    : '#';

  const c360Href = rec._dedupeKey ? `#/company/${encodeURIComponent(rec._dedupeKey)}` : '#/';
  foot.innerHTML = `
    <a href="${c360Href}" class="btn btn-primary btn-sm cd-btn-c360">
      ${svgIcon('external')} Open Full Profile
    </a>
    <button class="btn btn-ghost btn-sm cd-btn-copy" data-company="${encodeURIComponent(rec.companyName)}">
      ${svgIcon('copy')} Copy Info
    </button>
    <button class="btn btn-ghost btn-sm cd-btn-export">
      ${svgIcon('download')} Export Report
    </button>
    <a href="${url}" target="_blank" rel="noopener noreferrer"
       class="btn btn-ghost btn-sm" ${!rec.website ? 'style="pointer-events:none;opacity:0.5"' : ''}>
      ${svgIcon('external')} Visit Website
    </a>
  `;

  foot.querySelector('.cd-btn-copy')?.addEventListener('click', () => {
    const text = buildCopyText(rec);
    navigator.clipboard?.writeText(text).then(() => {
      const btn = foot.querySelector('.cd-btn-copy');
      if (btn) { btn.textContent = 'Copied!'; setTimeout(() => btn.innerHTML = `${svgIcon('copy')} Copy Info`, 1500); }
    });
  });

  foot.querySelector('.cd-btn-export')?.addEventListener('click', () => {
    bus.emit('export:company', rec);
  });
}

function buildCopyText(rec) {
  return [
    rec.companyName,
    `Category: ${rec.category || '—'}`,
    `Location: ${[rec.hqCity, rec.state].filter(Boolean).join(', ') || '—'}`,
    `Revenue: ${formatCurrency(rec.revenue)}`,
    `CEO: ${rec.ceo || '—'}`,
    `Website: ${rec.website || '—'}`,
  ].join('\n');
}

// ─── Event Wiring ──────────────────────────

export function initCompanyDetail() {
  bus.on('company:select', (rec) => {
    renderCompanyDetail(rec);
    updateFooter(rec);
    drawer.open();
  });
}
