/**
 * company360.js — Company 360 permalink page.
 *
 * URL: #/company/:key   (:key is the record's _dedupeKey)
 *
 * Three-column enterprise layout:
 *   ┌───────── Header (name, badges, actions) ─────────┐
 *   ├── Key Facts │  Executive Summary        │ Notes ─┤
 *   │  Financials │  ESDS Fit — Top 3         │ Recent │
 *   │  Leadership │  Digital Maturity Radar   │ Related│
 *   │  Confidence │  Tech Stack               │ Sources│
 *   │             │  Pain Points              │        │
 *   └─────────────────────────────────────────────────┘
 *
 * The page is a "view" over the DataCache — no data is duplicated,
 * no state is stored here beyond ECharts instances (disposed on
 * navigation) and the current DOM.
 */

import { bus }                from '../utils/eventBus.js';
import { h, qs, qsa }        from '../utils/dom.js';
import { escapeHTML, sanitizeURL } from '../utils/sanitize.js';
import { announce, trapFocus }     from '../utils/a11y.js';
import { CleanupRegistry }         from '../utils/perf.js';
import { Icon }                    from '../components/icons.js';
import { loadECharts }             from '../charts/echartsLoader.js';
import { getChartTheme }           from '../charts/chartTheme.js';
import { recommendForCompany }     from '../recommendations/engine.js';
import { opportunityValue }        from '../workspace/scoring.js';
import { workspace }               from '../workspace/store.js';
import { territory }               from '../workspace/territory.js';
import { identity }                from '../workspace/identity.js';
import { dataEngine }              from '../data/data.js';
import { navigate }                from '../router.js';
import { generateBrief }           from '../ai/brief.js';
import { generatePrep }            from '../ai/meetingPrep.js';

// ─── Helpers ──────────────────────────────────────

function svgIcon(name, cls = '') {
  const el = Icon(name, cls);
  const tmp = document.createElement('div');
  tmp.appendChild(el);
  return tmp.innerHTML;
}

function fmt(n) {
  if (n == null) return '—';
  if (n >= 100000) return '₹' + (n / 100000).toFixed(2) + 'L Cr';
  if (n >= 1000)   return '₹' + (n / 1000).toFixed(2) + 'K Cr';
  return '₹' + Number(n).toFixed(1) + ' Cr';
}

function fmtNum(n) {
  if (n == null) return '—';
  return Number(n).toLocaleString('en-IN');
}

function maturityLevel(v) {
  if (!v) return 0;
  const s = String(v).toLowerCase();
  if (/high|advanced/.test(s))    return 90;
  if (/med|moderate/.test(s))     return 55;
  if (/low|basic/.test(s))        return 25;
  return 0;
}

function maturityClass(v) {
  const l = maturityLevel(v);
  if (l >= 70) return 'c360-badge-high';
  if (l >= 40) return 'c360-badge-med';
  if (l > 0)   return 'c360-badge-low';
  return 'c360-badge-na';
}

function scoreColor(score) {
  if (score >= 65) return '#10B981';
  if (score >= 40) return '#F59E0B';
  return '#EF4444';
}

/** Confidence heuristic — richer records = higher confidence. */
function confidenceScore(rec) {
  const fields = ['revenue', 'itSpend', 'cloudMaturity', 'cyberMaturity',
                  'aiReadiness', 'digitalMaturity', 'ceo', 'cto', 'cio',
                  'techStack', 'painPoints', 'website'];
  const present = fields.filter(f => {
    const v = rec[f];
    return v != null && v !== '' && v !== 'NA';
  }).length;
  return Math.round((present / fields.length) * 100);
}

/**
 * Freshness — based on _mergedFrom count as a weak proxy; will improve
 * once real per-field source dates flow through the parser.
 */
function freshnessMeta(rec) {
  const sources = rec._mergedFrom ? rec._mergedFrom.length + 1 : 1;
  return { sources, ageDays: 30, label: sources > 1 ? 'Multi-source verified' : 'Single source' };
}

// ─── Ownership button ─────────────────────────────

function renderOwnerButton(rec) {
  const uid = territory.ownerOf(rec._dedupeKey);
  const me = identity.current();
  if (!uid) {
    return `<button class="btn btn-ghost btn-sm" data-action="assign-me">${svgIcon('user')} Assign to me</button>`;
  }
  const owner = identity.user(uid);
  if (owner && me && owner.id === me.id) {
    return `<button class="btn btn-ghost btn-sm c360-owner-me" data-action="unassign" title="Assigned to you — click to unassign">
      ${svgIcon('user')} Mine <span class="c360-owner-x">✕</span>
    </button>`;
  }
  return `<button class="btn btn-ghost btn-sm c360-owner-other" data-action="reassign" title="Owned by ${escapeHTML(owner?.name || 'someone else')}">
    ${svgIcon('user')} ${escapeHTML(owner?.initials || '?')}
  </button>`;
}

// ─── Header ───────────────────────────────────────

function renderHeader(rec) {
  const key   = rec._dedupeKey;
  const score = opportunityValue(rec);
  const conf  = confidenceScore(rec);
  const status = workspace.getStatus(key);
  const bookmarked = workspace.isBookmarked(key);

  return `
    <header class="c360-header glass-panel">
      <div class="c360-header-top">
        <button class="c360-back btn btn-ghost btn-sm" data-action="back">
          ${svgIcon('chevronLeft')} Back
        </button>
        <nav class="c360-breadcrumb" aria-label="Breadcrumb">
          <a href="#/">Home</a> <span>/</span>
          <a href="#/companies">Companies</a> <span>/</span>
          <span class="c360-crumb-current">${escapeHTML(rec.companyName)}</span>
        </nav>
      </div>

      <div class="c360-header-main">
        <div class="c360-header-left">
          <div class="c360-logo" aria-hidden="true">
            ${escapeHTML((rec.companyName || 'CO').slice(0, 2).toUpperCase())}
          </div>
          <div class="c360-header-info">
            <h1 class="c360-title">${escapeHTML(rec.companyName)}</h1>
            <div class="c360-meta">
              <span class="c360-meta-item">${escapeHTML(rec.category || 'Uncategorized')}</span>
              ${rec.subSector ? `<span class="c360-meta-sep">·</span><span class="c360-meta-item">${escapeHTML(rec.subSector)}</span>` : ''}
              ${rec.state ? `<span class="c360-meta-sep">·</span><span class="c360-meta-item">${svgIcon('map')} ${escapeHTML([rec.hqCity, rec.state].filter(Boolean).join(', '))}</span>` : ''}
              ${rec.listedStatus ? `<span class="c360-meta-sep">·</span><span class="c360-meta-item">${escapeHTML(rec.listedStatus)}</span>` : ''}
            </div>

            <div class="c360-badges">
              <span class="c360-score-chip" style="border-color:${scoreColor(score)}44;color:${scoreColor(score)}">
                <span class="c360-score-dot" style="background:${scoreColor(score)}"></span>
                Opportunity ${score}
              </span>
              <span class="c360-badge ${maturityClass(rec.cloudMaturity)}" title="Cloud maturity">
                Cloud: ${escapeHTML(rec.cloudMaturity || 'N/A')}
              </span>
              <span class="c360-badge ${maturityClass(rec.aiReadiness)}" title="AI readiness">
                AI: ${escapeHTML(rec.aiReadiness || 'N/A')}
              </span>
              <span class="c360-badge ${maturityClass(rec.cyberMaturity)}" title="Cyber maturity">
                Cyber: ${escapeHTML(rec.cyberMaturity || 'N/A')}
              </span>
              <span class="c360-badge c360-badge-conf" title="Data completeness — how many key fields we have">
                ${svgIcon('checkCircle')} ${conf}% complete
              </span>
            </div>
          </div>
        </div>

        <div class="c360-header-right" role="group" aria-label="Company actions">
          <label class="c360-status-wrap" for="c360-status-select">
            <span class="c360-status-lbl">Status</span>
            <select class="c360-status-select" id="c360-status-select" aria-label="Engagement status">
              ${workspace.STATUS_VALUES.map(s => `<option value="${s}"${s === status ? ' selected' : ''}>${s}</option>`).join('')}
            </select>
          </label>
          <button class="btn btn-ghost btn-sm c360-bookmark${bookmarked ? ' active' : ''}" data-action="bookmark" aria-pressed="${bookmarked}">
            ${svgIcon('star')} ${bookmarked ? 'Bookmarked' : 'Bookmark'}
          </button>
          ${renderOwnerButton(rec)}
          <button class="btn btn-ghost btn-sm" data-action="add-to-list">
            ${svgIcon('plus')} Add to List
          </button>
          <button class="btn btn-ghost btn-sm" data-action="compare">
            ${svgIcon('layers')} Compare
          </button>
          <button class="btn btn-ghost btn-sm" data-action="meeting-prep">
            ${svgIcon('target')} Prep Meeting
          </button>
          <button class="btn btn-primary btn-sm" data-action="export">
            ${svgIcon('download')} Export Report
          </button>
        </div>
      </div>
    </header>`;
}

// ─── Left column ──────────────────────────────────

function statTile(label, value, sub) {
  return `<div class="c360-stat">
    <div class="c360-stat-label">${escapeHTML(label)}</div>
    <div class="c360-stat-value">${escapeHTML(String(value))}</div>
    ${sub ? `<div class="c360-stat-sub">${escapeHTML(sub)}</div>` : ''}
  </div>`;
}

function factRow(label, value) {
  return `<div class="c360-fact-row">
    <span class="c360-fact-label">${escapeHTML(label)}</span>
    <span class="c360-fact-value">${escapeHTML(String(value ?? '—'))}</span>
  </div>`;
}

function personRow(role, name) {
  if (!name) return '';
  const initials = String(name).split(/\s+/).map(w => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
  return `<div class="c360-person">
    <div class="c360-person-avatar" aria-hidden="true">${escapeHTML(initials || '?')}</div>
    <div class="c360-person-info">
      <div class="c360-person-role">${escapeHTML(role)}</div>
      <div class="c360-person-name">${escapeHTML(name)}</div>
    </div>
  </div>`;
}

/**
 * Karnataka co-operative details panel — renders ONLY fields present in the
 * Karnataka workbook, and only for records that came from it. Missing values
 * are omitted (the row simply doesn't render), never fabricated.
 */
function renderKarnatakaDetails(rec) {
  if (!rec.isKarnataka) return '';
  const rows = [
    ['RO Name',            rec.roName],
    ['Head Office',        rec.hqAddress],
    ['Pincode',            rec.pincode],
    ['Sector',             rec.sector],
    ['Area of Operations', rec.areaOfOperations],
    ['Contact Person',     rec.contactPerson],
    ['Mobile',             rec.contactMobile],
    ['Email',              rec.contactEmail],
  ].filter(([, v]) => v != null && v !== '');

  if (rows.length === 0) return '';

  return `<div class="c360-panel glass-panel">
    <h3 class="c360-panel-title">${svgIcon('info')} Co-operative Details</h3>
    <div class="c360-facts">
      ${rows.map(([label, val]) => `<div class="c360-fact-row">
        <span class="c360-fact-label">${escapeHTML(label)}</span>
        <span class="c360-fact-value">${
          label === 'Email' && val
            ? `<a class="c360-link" href="mailto:${escapeHTML(val)}">${escapeHTML(val)}</a>`
            : escapeHTML(String(val))
        }</span>
      </div>`).join('')}
    </div>
  </div>`;
}

/**
 * Gujarat co-operative details panel — unlike Karnataka's, this ALWAYS
 * renders every field (Chairman/CEO/President/Vice-President/IT Spend
 * included), showing "N/A" for anything absent rather than omitting the
 * row, per the Gujarat integration's stricter display requirement.
 */
function renderGujaratDetails(rec) {
  if (!rec.isGujarat) return '';
  const na = v => (v == null || v === '') ? 'N/A' : String(v);
  const rows = [
    ['Chairman',                        rec.chairman],
    ['CEO',                             rec.ceo],
    ['President',                       rec.president],
    ['Vice-President',                  rec.vicePresident],
    ['IT Spend / Cyber Security Fund',  rec.itSpendRaw],
    ['RO Name',                         rec.roName],
    ['Head Office',                     rec.hqAddress],
    ['Pincode',                         rec.pincode],
    ['Sector',                          rec.sector],
    ['Area of Operations',              rec.areaOfOperations],
    ['Contact Person',                  rec.contactPerson],
    ['Mobile',                          rec.contactMobile],
    ['Email',                           rec.contactEmail],
  ];

  return `<div class="c360-panel glass-panel">
    <h3 class="c360-panel-title">${svgIcon('info')} Gujarat Co-operative Details</h3>
    <div class="c360-facts">
      ${rows.map(([label, val]) => `<div class="c360-fact-row">
        <span class="c360-fact-label">${escapeHTML(label)}</span>
        <span class="c360-fact-value">${
          label === 'Email' && val
            ? `<a class="c360-link" href="mailto:${escapeHTML(val)}">${escapeHTML(val)}</a>`
            : escapeHTML(na(val))
        }</span>
      </div>`).join('')}
    </div>
  </div>`;
}

function renderLeftColumn(rec) {
  const fresh = freshnessMeta(rec);
  const web = rec.website ? sanitizeURL(rec.website) : null;

  return `
    <div class="c360-panel glass-panel">
      <h3 class="c360-panel-title">${svgIcon('chart')} Financials</h3>
      <div class="c360-stat-grid">
        ${statTile('Revenue', fmt(rec.revenue))}
        ${statTile('Market Cap', fmt(rec.marketCap))}
        ${statTile('Net Profit', fmt(rec.netProfit))}
        ${statTile('IT Spend', fmt(rec.itSpend))}
        ${statTile('Cloud Spend', fmt(rec.cloudSpend))}
        ${statTile('Cyber Spend', fmt(rec.cyberSpend))}
      </div>
    </div>

    <div class="c360-panel glass-panel">
      <h3 class="c360-panel-title">${svgIcon('building')} Key Facts</h3>
      <div class="c360-facts">
        ${factRow('Ownership', rec.ownership || '—')}
        ${rec.govtShareholding ? factRow('Govt. Stake', rec.govtShareholding + '%') : ''}
        ${rec.parentCompany ? factRow('Sponsor / Parent', rec.parentCompany) : ''}
        ${rec.countryOfOrigin ? factRow('Country of Origin', rec.countryOfOrigin) : ''}
        ${rec.formOfPresence ? factRow('Form of Presence', rec.formOfPresence) : ''}
        ${factRow('Listed', rec.listedStatus || '—')}
        ${factRow('Founded', rec.yearFounded || '—')}
        ${factRow('Employees', fmtNum(rec.employeeCount))}
        ${factRow('Branches', fmtNum(rec.branchCount))}
        ${factRow('HQ', [rec.hqCity, rec.state].filter(Boolean).join(', ') || '—')}
        ${factRow('Region', rec.region || '—')}
        ${rec.sourceAsOfDate ? factRow('As of', rec.sourceAsOfDate) : ''}
        ${web ? `<div class="c360-fact-row"><span class="c360-fact-label">Website</span>
          <a class="c360-fact-value c360-link" href="${web}" target="_blank" rel="noopener noreferrer">${escapeHTML(rec.website)} ${svgIcon('external')}</a></div>` : ''}
      </div>
    </div>

    <div class="c360-panel glass-panel">
      <h3 class="c360-panel-title">${svgIcon('user')} Leadership</h3>
      <div class="c360-people">
        ${personRow('CEO / MD', rec.ceo)}
        ${personRow('President', rec.president)}
        ${personRow('Vice-President', rec.vicePresident)}
        ${personRow('Chairman', rec.chairman)}
        ${personRow('CTO', rec.cto)}
        ${personRow('CIO', rec.cio)}
        ${personRow('CISO', rec.ciso)}
        ${personRow('CFO', rec.cfo)}
      </div>
      ${!rec.ceo && !rec.president && !rec.vicePresident && !rec.cto && !rec.cio ? '<p class="c360-empty">No leadership data available for this company.</p>' : ''}
    </div>

    ${renderKarnatakaDetails(rec)}
    ${renderGujaratDetails(rec)}

    <div class="c360-panel glass-panel c360-verify">
      <h3 class="c360-panel-title">${svgIcon('checkCircle')} Verification</h3>
      <div class="c360-verify-rows">
        <div class="c360-verify-row">
          <span class="c360-verify-label">Data completeness</span>
          <span class="c360-verify-value">${confidenceScore(rec)}%</span>
        </div>
        <div class="c360-verify-row">
          <span class="c360-verify-label">Sources</span>
          <span class="c360-verify-value">${fresh.sources}</span>
        </div>
        <div class="c360-verify-row">
          <span class="c360-verify-label">Status</span>
          <span class="c360-verify-value c360-verify-badge">${escapeHTML(fresh.label)}</span>
        </div>
      </div>
    </div>`;
}

// ─── Center column ────────────────────────────────

function renderExecSummary(rec) {
  const brief = generateBrief(rec);

  const sectionHtml = brief.sections.map(sec => `
    <div class="c360-brief-section">
      <h4 class="c360-brief-h">${escapeHTML(sec.title)}</h4>
      ${sec.paragraphs.map(p => `
        <p class="c360-brief-para">${escapeHTML(p.text)}</p>
        ${p.cites.length ? `<div class="c360-brief-cites">
          ${p.cites.map(c => `<span class="c360-brief-cite" title="${escapeHTML(c.value)}"><b>${escapeHTML(c.label)}:</b> ${escapeHTML(c.value)}</span>`).join('')}
        </div>` : ''}
      `).join('')}
    </div>
  `).join('');

  return `
    <div class="c360-panel glass-panel">
      <div class="c360-summary-head">
        <h3 class="c360-panel-title">${svgIcon('info')} Account Brief</h3>
        <span class="c360-ai-tag">AI-generated · Every claim cites the source field</span>
      </div>
      <div class="c360-brief">${sectionHtml}</div>
    </div>`;
}

function renderESDSFit(rec) {
  const recos = recommendForCompany(rec, 15).slice(0, 3);
  if (recos.length === 0) {
    return `<div class="c360-panel glass-panel">
      <h3 class="c360-panel-title">${svgIcon('star')} ESDS Fit</h3>
      <p class="c360-empty">No ESDS product recommendations meet the confidence threshold for this company yet.</p>
    </div>`;
  }

  const items = recos.map(r => {
    const p = r.product;
    const color = p.color || '#6366F1';
    return `<div class="c360-fit-item" style="--fit-color:${color}">
      <div class="c360-fit-head">
        <div class="c360-fit-name">${escapeHTML(p.name)}</div>
        <div class="c360-fit-score" style="color:${color}">${r.score}</div>
      </div>
      <div class="c360-fit-tagline">${escapeHTML(p.tagline || '')}</div>
      <div class="c360-fit-reason">
        <strong>Why now:</strong> ${escapeHTML(r.reasons[0] || '')}
      </div>
      ${r.reasons[1] ? `<div class="c360-fit-reason"><strong>Also:</strong> ${escapeHTML(r.reasons[1])}</div>` : ''}
      <div class="c360-fit-meta">
        <span>Priority: <b>${escapeHTML(r.priority)}</b></span>
        <span>Complexity: <b>${escapeHTML(r.complexity)}</b></span>
        <span>Timeline: <b>${escapeHTML(r.timeline)}</b></span>
      </div>
    </div>`;
  }).join('');

  return `<div class="c360-panel glass-panel">
    <h3 class="c360-panel-title">${svgIcon('star')} ESDS Fit — Top ${recos.length}</h3>
    <div class="c360-fit-list">${items}</div>
  </div>`;
}

function renderTechStack(rec) {
  const raw = rec.techStack || rec.corePlatform || '';
  if (!raw) return '';
  const tags = String(raw)
    .split(/[,;|]+/)
    .map(s => s.trim())
    .filter(s => s.length > 1 && s.length < 40);

  if (!tags.length) return '';

  return `<div class="c360-panel glass-panel">
    <h3 class="c360-panel-title">${svgIcon('layers')} Technology Stack</h3>
    <div class="c360-tags">
      ${tags.map(t => `<span class="c360-tag">${escapeHTML(t)}</span>`).join('')}
    </div>
  </div>`;
}

function renderBranchNetwork(rec) {
  if (!rec.branchTotal && !rec.branchesByState && (!rec.branchCount || rec.branchCount < 5)) return '';

  const total   = rec.branchTotal || rec.branchCount || 0;
  const byState = rec.branchesByState || {};
  const stateEntries = Object.entries(byState).sort((a, b) => b[1] - a[1]);
  const topStates = stateEntries.slice(0, 8);
  const maxCount  = topStates.length ? topStates[0][1] : 1;
  const cities    = rec.topBranchCities || [];
  const ifsc      = rec.ifscSample || [];

  // Pull actual branch records for this bank (if any live in the branch store)
  const allBranches = dataEngine.branchesFor(rec._dedupeKey);

  const stateRows = topStates.length
    ? topStates.map(([name, count]) => {
        const pct = Math.max((count / maxCount) * 100, 4);
        return `<div class="c360-branch-row">
          <span class="c360-branch-state">${escapeHTML(name)}</span>
          <div class="c360-branch-bar-wrap">
            <div class="c360-branch-bar" style="width:${pct}%"></div>
          </div>
          <span class="c360-branch-count">${Number(count).toLocaleString('en-IN')}</span>
        </div>`;
      }).join('')
    : '<p class="c360-empty">State-level branch breakdown not available.</p>';

  const branchListMarkup = allBranches.length > 0
    ? `<div class="c360-branch-sub">
        <div class="c360-branch-list-head">
          <div class="c360-panel-subtitle">Branches on file (${allBranches.length.toLocaleString('en-IN')})</div>
          <input class="c360-branch-search" type="text" placeholder="Filter by name, city, IFSC…" id="c360-branch-search"/>
        </div>
        <div class="c360-branch-table-wrap" id="c360-branch-table-wrap">
          ${renderBranchTable(allBranches.slice(0, 25))}
        </div>
        ${allBranches.length > 25 ? `<div class="c360-branch-table-more">Showing 25 of ${allBranches.length.toLocaleString('en-IN')} · use filter to search</div>` : ''}
      </div>`
    : '';

  return `<div class="c360-panel glass-panel">
    <div class="c360-summary-head">
      <h3 class="c360-panel-title">${svgIcon('building')} Branch Network</h3>
      <span class="c360-ai-tag">${Number(total).toLocaleString('en-IN')} branches on file</span>
    </div>
    <div class="c360-branch-list">${stateRows}</div>
    ${stateEntries.length > topStates.length ? `<p class="c360-branch-more">+ ${stateEntries.length - topStates.length} more states</p>` : ''}
    ${cities.length ? `<div class="c360-branch-sub">
      <div class="c360-panel-subtitle">Top cities</div>
      <div class="c360-tags">${cities.slice(0, 8).map(([c, n]) => `<span class="c360-tag">${escapeHTML(c)} · ${n}</span>`).join('')}</div>
    </div>` : ''}
    ${ifsc.length && !allBranches.length ? `<div class="c360-branch-sub">
      <div class="c360-panel-subtitle">Sample IFSC codes</div>
      <div class="c360-tags">${ifsc.map(i => `<span class="c360-tag" style="font-family:var(--font-mono);font-size:10px">${escapeHTML(i)}</span>`).join('')}</div>
    </div>` : ''}
    ${branchListMarkup}
  </div>`;
}

function renderBranchTable(branches) {
  if (!branches.length) {
    return '<div class="c360-branch-none">No branches match your filter.</div>';
  }
  // Karnataka Apex branches carry manager/telephone/mobile — show those columns.
  const hasManager = branches.some(b => b.managerName || b.telephone || b.mobile);

  if (hasManager) {
    return `<table class="c360-branch-table">
      <thead><tr><th>Branch</th><th>Manager</th><th>Telephone</th><th>Mobile</th><th>IFSC</th></tr></thead>
      <tbody>
        ${branches.map(b => `<tr>
          <td class="c360-branch-name" title="${escapeHTML(b.address || b.branchName)}">${escapeHTML(b.branchName)}</td>
          <td>${escapeHTML(b.managerName || '—')}</td>
          <td>${escapeHTML(b.telephone || '—')}</td>
          <td>${escapeHTML(b.mobile || '—')}</td>
          <td class="c360-branch-ifsc">${escapeHTML(b.ifsc || '—')}</td>
        </tr>`).join('')}
      </tbody>
    </table>`;
  }

  return `<table class="c360-branch-table">
    <thead><tr><th>Branch</th><th>City</th><th>State</th><th>IFSC</th></tr></thead>
    <tbody>
      ${branches.map(b => `<tr>
        <td class="c360-branch-name" title="${escapeHTML(b.address || b.branchName)}">${escapeHTML(b.branchName)}</td>
        <td>${escapeHTML(b.city || '—')}</td>
        <td>${escapeHTML(b.state || '—')}</td>
        <td class="c360-branch-ifsc">${escapeHTML(b.ifsc || '—')}</td>
      </tr>`).join('')}
    </tbody>
  </table>`;
}

function renderPainPoints(rec) {
  if (!rec.painPoints) return '';
  const items = String(rec.painPoints).split(/[,;•]|\bthen\b|\band\b/i).map(s => s.trim()).filter(s => s.length > 4);
  if (!items.length) return '';

  return `<div class="c360-panel glass-panel">
    <h3 class="c360-panel-title">${svgIcon('alertCircle')} Pain Points & Initiatives</h3>
    <ul class="c360-pain-list">
      ${items.slice(0, 8).map(p => `<li>${escapeHTML(p)}</li>`).join('')}
    </ul>
    ${rec.initiatives ? `<div class="c360-initiatives">
      <div class="c360-panel-subtitle">Ongoing Initiatives</div>
      <p>${escapeHTML(rec.initiatives)}</p>
    </div>` : ''}
  </div>`;
}

function renderRadar(container, rec) {
  loadECharts().then(ec => {
    const t = getChartTheme();
    const mount = container.querySelector('#c360-radar');
    if (!mount) return;
    const chart = ec.init(mount, null, { renderer: 'canvas' });

    chart.setOption({
      tooltip: t.tooltip(),
      radar: {
        indicator: [
          { name: 'Cloud',    max: 100 },
          { name: 'AI',       max: 100 },
          { name: 'Cyber',    max: 100 },
          { name: 'Digital',  max: 100 },
          { name: 'IT Spend', max: 100 },
          { name: 'Revenue',  max: 100 },
        ],
        center: ['50%', '50%'],
        radius: '68%',
        splitNumber: 4,
        axisName: { color: t.textMuted, fontSize: 11, fontFamily: "'DM Sans',sans-serif" },
        splitLine: { lineStyle: { color: t.splitLine } },
        splitArea: { areaStyle: { color: ['transparent', t.darkMode ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)'] } },
        axisLine: { lineStyle: { color: t.border } },
      },
      series: [{
        type: 'radar',
        data: [{
          value: [
            maturityLevel(rec.cloudMaturity),
            maturityLevel(rec.aiReadiness),
            maturityLevel(rec.cyberMaturity),
            maturityLevel(rec.digitalMaturity),
            Math.min((rec.itSpend || 0) / 5, 100),
            Math.min((rec.revenue || 0) / 500, 100),
          ],
          name: rec.companyName,
          lineStyle: { width: 2, color: '#6366F1' },
          areaStyle: { color: 'rgba(99,102,241,0.2)' },
          itemStyle: { color: '#6366F1' },
          symbol: 'circle',
          symbolSize: 5,
        }],
        animationDuration: 700,
      }],
    });

    // Register for disposal
    container._radar = chart;
  }).catch(() => { /* silent — panel just stays as a placeholder */ });
}

function renderMaturitySection() {
  return `<div class="c360-panel glass-panel">
    <h3 class="c360-panel-title">${svgIcon('target')} Digital Maturity Radar</h3>
    <div id="c360-radar" class="c360-radar-mount"></div>
  </div>`;
}

// ─── Right column ─────────────────────────────────

function renderNotesPanel(rec) {
  const key = rec._dedupeKey;
  const notes = workspace.getNotes(key);

  return `<div class="c360-panel glass-panel">
    <h3 class="c360-panel-title">${svgIcon('edit')} Notes & Activity</h3>
    <div class="c360-note-composer">
      <textarea class="c360-note-input" placeholder="Add a research note, meeting summary, or signal…" rows="3" maxlength="2000" aria-label="Add note"></textarea>
      <button class="btn btn-primary btn-sm c360-note-add">${svgIcon('plus')} Add Note</button>
    </div>
    <div class="c360-notes-list" id="c360-notes-list">
      ${renderNotesList(notes)}
    </div>
  </div>`;
}

function renderNotesList(notes) {
  if (!notes.length) {
    return '<p class="c360-empty">No notes yet. Start with a first research finding or meeting outcome.</p>';
  }
  return notes.map(n => `<div class="c360-note" data-note-id="${escapeHTML(n.id)}">
    <div class="c360-note-head">
      <span class="c360-note-author">${escapeHTML(n.author)}</span>
      <time class="c360-note-time">${new Date(n.createdAt).toLocaleString()}</time>
      <button class="c360-note-del" aria-label="Delete note">✕</button>
    </div>
    <div class="c360-note-text">${escapeHTML(n.text)}</div>
  </div>`).join('');
}

function renderSignalsPanel(rec) {
  // Signals derived from the record fields — the beginning of the real
  // Signals Feed. Once we ingest news/hiring/tech data, replace this.
  const signals = [];
  if (rec.buyingPotential && rec.buyingPotential >= 20) {
    signals.push({ type: 'Buying', text: `Estimated buying potential ₹${rec.buyingPotential} Cr/yr`, tone: 'positive' });
  }
  if (rec.painPoints)     signals.push({ type: 'Pain', text: 'Documented business & tech pain points', tone: 'warn' });
  if (rec.initiatives)    signals.push({ type: 'Initiative', text: 'Digital transformation initiatives in progress', tone: 'positive' });
  if (rec.cloudMaturity === 'Low')    signals.push({ type: 'Gap', text: 'Low cloud maturity — modernization runway', tone: 'positive' });
  if (rec.cyberMaturity === 'Low')    signals.push({ type: 'Risk', text: 'Low cyber maturity — cyber uplift opportunity', tone: 'warn' });
  if (rec.aiReadiness === 'Low')      signals.push({ type: 'Gap', text: 'Low AI readiness — greenfield AI adoption', tone: 'positive' });
  if (rec.notes)          signals.push({ type: 'News', text: rec.notes, tone: 'neutral' });

  if (!signals.length) {
    return `<div class="c360-panel glass-panel">
      <h3 class="c360-panel-title">${svgIcon('zap')} Signals</h3>
      <p class="c360-empty">No signals inferred yet. Add notes to log observed signals.</p>
    </div>`;
  }

  return `<div class="c360-panel glass-panel">
    <h3 class="c360-panel-title">${svgIcon('zap')} Signals</h3>
    <div class="c360-signals">
      ${signals.map(s => `<div class="c360-signal c360-signal-${s.tone}">
        <span class="c360-signal-type">${escapeHTML(s.type)}</span>
        <span class="c360-signal-text">${escapeHTML(s.text)}</span>
      </div>`).join('')}
    </div>
  </div>`;
}

function renderPeers(rec) {
  if (!dataEngine.cache) return '';
  const peers = dataEngine.cache.getByCategory(rec.category)
    .filter(r => r._dedupeKey !== rec._dedupeKey)
    .sort((a, b) => (b.revenue || 0) - (a.revenue || 0))
    .slice(0, 5);
  if (peers.length === 0) return '';

  return `<div class="c360-panel glass-panel">
    <h3 class="c360-panel-title">${svgIcon('layers')} Peer Companies</h3>
    <div class="c360-peers">
      ${peers.map(p => `<a class="c360-peer" href="#/company/${encodeURIComponent(p._dedupeKey)}">
        <div class="c360-peer-avatar">${escapeHTML((p.companyName || 'CO').slice(0, 2).toUpperCase())}</div>
        <div class="c360-peer-info">
          <div class="c360-peer-name">${escapeHTML(p.companyName)}</div>
          <div class="c360-peer-meta">${escapeHTML([p.state, fmt(p.revenue)].filter(Boolean).join(' · '))}</div>
        </div>
      </a>`).join('')}
    </div>
  </div>`;
}

// ─── Not found ────────────────────────────────────

function renderNotFound(container, key) {
  container.innerHTML = `
    <section class="c360-notfound glass-panel">
      <div class="c360-nf-icon">🔍</div>
      <h2>Company not found</h2>
      <p>No record matches key <code>${escapeHTML(key)}</code>. It may have been renamed or removed from the dataset.</p>
      <button class="btn btn-primary" onclick="location.hash='#/'">Back to Dashboard</button>
    </section>`;
}

// ─── Actions ──────────────────────────────────────

function wireActions(container, rec) {
  const key = rec._dedupeKey;
  const cleanup = new CleanupRegistry();

  // Back
  cleanup.addListener(qs('[data-action="back"]', container), 'click', () => {
    if (document.referrer && document.referrer.includes(location.host)) {
      history.back();
    } else {
      navigate('/');
    }
  });

  // Bookmark
  const bookmarkBtn = qs('[data-action="bookmark"]', container);
  cleanup.addListener(bookmarkBtn, 'click', () => {
    const active = workspace.toggleBookmark(key, { name: rec.companyName, category: rec.category });
    bookmarkBtn.classList.toggle('active', active);
    bookmarkBtn.setAttribute('aria-pressed', String(active));
    bookmarkBtn.innerHTML = `${svgIcon('star')} ${active ? 'Bookmarked' : 'Bookmark'}`;
  });

  // Status
  const statusSel = qs('#c360-status-select', container);
  cleanup.addListener(statusSel, 'change', (e) => {
    workspace.setStatus(key, e.target.value);
  });

  // Ownership actions
  const rewireOwner = () => {
    const btn = qs('[data-action="assign-me"], [data-action="unassign"], [data-action="reassign"]', container);
    if (!btn) return;
    const action = btn.dataset.action;
    btn.replaceWith(btn.cloneNode(true));
    const fresh = qs(`[data-action="${action}"]`, container);
    fresh.addEventListener('click', (e) => {
      if (action === 'assign-me') {
        territory.assignToMe(key);
        announce('Assigned to you.', 'polite');
      } else if (action === 'unassign') {
        territory.assign(key, null);
        announce('Unassigned.', 'polite');
      } else if (action === 'reassign') {
        // Simple: re-assign to current user
        if (confirm('Reassign this account to you?')) {
          territory.assignToMe(key);
        }
      }
      // Refresh just the owner button in place
      const parent = qs('.c360-header-right', container);
      if (parent) {
        const oldBtn = qs('[data-action="assign-me"], [data-action="unassign"], [data-action="reassign"]', parent);
        if (oldBtn) {
          const wrapper = document.createElement('div');
          wrapper.innerHTML = renderOwnerButton(rec);
          oldBtn.replaceWith(wrapper.firstElementChild);
          rewireOwner();
        }
      }
    });
  };
  rewireOwner();

  // Add to list
  cleanup.addListener(qs('[data-action="add-to-list"]', container), 'click', () => {
    openAddToListDialog(container, key, rec);
  });

  // Compare — hand off to compare module
  cleanup.addListener(qs('[data-action="compare"]', container), 'click', () => {
    bus.emit('compare:add', rec);
  });

  // Export — hand off to export module
  cleanup.addListener(qs('[data-action="export"]', container), 'click', () => {
    bus.emit('export:company', rec);
  });

  // Meeting prep — one-click brief
  cleanup.addListener(qs('[data-action="meeting-prep"]', container), 'click', () => {
    openMeetingPrepModal(rec);
  });

  // Notes composer
  const addNoteBtn = qs('.c360-note-add', container);
  const noteInput  = qs('.c360-note-input', container);
  cleanup.addListener(addNoteBtn, 'click', () => {
    const text = noteInput.value.trim();
    if (!text) { noteInput.focus(); return; }
    workspace.addNote(key, text);
    noteInput.value = '';
    refreshNotes(container, key);
  });
  cleanup.addListener(noteInput, 'keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') addNoteBtn.click();
  });

  // Delegated note delete
  cleanup.addListener(qs('#c360-notes-list', container), 'click', (e) => {
    const btn = e.target.closest('.c360-note-del');
    if (!btn) return;
    const noteEl = btn.closest('.c360-note');
    if (!noteEl) return;
    const noteId = noteEl.dataset.noteId;
    workspace.removeNote(key, noteId);
    refreshNotes(container, key);
  });

  // Live-refresh notes if store changes (e.g., from another module)
  cleanup.add(bus.on('workspace:notes:change', ({ companyKey }) => {
    if (companyKey === key) refreshNotes(container, key);
  }));

  // Branch list filter (present only when this bank has branch records)
  const branchSearch = qs('#c360-branch-search', container);
  if (branchSearch) {
    const allBranches = dataEngine.branchesFor(key);
    cleanup.addListener(branchSearch, 'input', () => {
      const q = branchSearch.value.trim().toLowerCase();
      const filtered = q
        ? allBranches.filter(b =>
            (b.branchName  || '').toLowerCase().includes(q) ||
            (b.city        || '').toLowerCase().includes(q) ||
            (b.state       || '').toLowerCase().includes(q) ||
            (b.district    || '').toLowerCase().includes(q) ||
            (b.ifsc        || '').toLowerCase().includes(q) ||
            (b.managerName || '').toLowerCase().includes(q) ||
            (b.telephone   || '').toLowerCase().includes(q) ||
            (b.mobile      || '').toLowerCase().includes(q) ||
            (b.address     || '').toLowerCase().includes(q))
        : allBranches;
      const wrap = qs('#c360-branch-table-wrap', container);
      if (wrap) wrap.innerHTML = renderBranchTable(filtered.slice(0, 100));
    });
  }

  return cleanup;
}

function refreshNotes(container, key) {
  const list = qs('#c360-notes-list', container);
  if (list) list.innerHTML = renderNotesList(workspace.getNotes(key));
}

function openMeetingPrepModal(rec) {
  const prep = generatePrep(rec);
  if (!prep) return;

  const overlay = document.createElement('div');
  overlay.className = 'mp-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Meeting preparation brief');

  overlay.innerHTML = `
    <div class="mp-modal glass-panel">
      <div class="mp-modal-head">
        <div>
          <h2 class="mp-title">Meeting Prep · ${escapeHTML(rec.companyName)}</h2>
          <p class="mp-sub">Print-friendly · one-page briefing</p>
        </div>
        <div class="mp-actions">
          <button class="btn btn-ghost btn-sm" id="mp-print">${svgIcon('download')} Print / PDF</button>
          <button class="icon-btn mp-close" aria-label="Close">✕</button>
        </div>
      </div>

      <div class="mp-body" id="mp-printable">
        <section class="mp-section">
          <h3 class="mp-section-title">Elevator</h3>
          <p class="mp-elevator">${escapeHTML(prep.elevator)}</p>
        </section>

        <section class="mp-section mp-two-col">
          <div>
            <h3 class="mp-section-title">Talking Points</h3>
            ${prep.talkingPoints.length === 0
              ? '<p class="mp-empty">No specific talking points inferred. Anchor to discovery.</p>'
              : `<ul class="mp-list">
                  ${prep.talkingPoints.map(p => `<li><b>${escapeHTML(p.pain)}:</b> ${escapeHTML(p.angle)}</li>`).join('')}
                </ul>`}
          </div>
          <div>
            <h3 class="mp-section-title">Top Products to Position</h3>
            ${prep.topProducts.length === 0
              ? '<p class="mp-empty">No high-confidence product fit yet.</p>'
              : `<div class="mp-products">
                  ${prep.topProducts.map(p => `<div class="mp-product">
                    <div class="mp-product-name">${escapeHTML(p.name)} <span class="mp-product-score">${p.score}</span></div>
                    <div class="mp-product-meta">${escapeHTML(p.priority)} · ${escapeHTML(p.timeline)}</div>
                    <div class="mp-product-tagline">${escapeHTML(p.tagline || '')}</div>
                  </div>`).join('')}
                </div>`}
          </div>
        </section>

        <section class="mp-section">
          <h3 class="mp-section-title">Discovery Questions</h3>
          <div class="mp-discovery">
            <div class="mp-discovery-tier">
              <div class="mp-discovery-lbl">Quick wins</div>
              <ul class="mp-list">${prep.discovery.quick.map(q => `<li>${escapeHTML(q)}</li>`).join('')}</ul>
            </div>
            <div class="mp-discovery-tier">
              <div class="mp-discovery-lbl">Deeper</div>
              <ul class="mp-list">${prep.discovery.medium.map(q => `<li>${escapeHTML(q)}</li>`).join('')}</ul>
            </div>
            <div class="mp-discovery-tier">
              <div class="mp-discovery-lbl">Strategic</div>
              <ul class="mp-list">${prep.discovery.deep.map(q => `<li>${escapeHTML(q)}</li>`).join('')}</ul>
            </div>
          </div>
        </section>

        <section class="mp-section">
          <h3 class="mp-section-title">Objection Handling</h3>
          <div class="mp-objections">
            ${prep.objections.map(o => `<div class="mp-objection">
              <div class="mp-objection-prompt">${escapeHTML(o.prompt)}</div>
              <div class="mp-objection-response">${escapeHTML(o.response)}</div>
            </div>`).join('')}
          </div>
        </section>

        <section class="mp-section">
          <h3 class="mp-section-title">Next-Step Commitments</h3>
          <ul class="mp-list mp-list-check">
            ${prep.nextSteps.map(n => `<li>${escapeHTML(n)}</li>`).join('')}
          </ul>
        </section>
      </div>
    </div>`;

  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('open'));

  const releaseFocus = trapFocus(overlay, { restore: document.activeElement });

  const close = () => {
    releaseFocus?.();
    overlay.classList.remove('open');
    setTimeout(() => overlay.remove(), 220);
  };

  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('.mp-close').addEventListener('click', close);
  overlay.querySelector('#mp-print').addEventListener('click', () => {
    // Trigger the browser print dialog — CSS @media print is scoped to keep only the modal
    document.body.classList.add('mp-printing');
    window.print();
    setTimeout(() => document.body.classList.remove('mp-printing'), 300);
  });
}

function openAddToListDialog(container, key, rec) {
  const lists = workspace.getLists();

  const overlay = h('div', { class: 'c360-list-overlay', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Add to list' });
  const modal = h('div', { class: 'c360-list-modal glass-panel' });
  modal.innerHTML = `
    <div class="c360-list-head">
      <h3>Add to List</h3>
      <button class="icon-btn c360-list-close" aria-label="Close">✕</button>
    </div>
    <div class="c360-list-body">
      ${lists.length === 0
        ? '<p class="c360-empty">You have no lists yet. Create one below.</p>'
        : `<div class="c360-list-choices">
            ${lists.map(l => `<button class="c360-list-choice" data-list-id="${escapeHTML(l.id)}">
              <span class="c360-list-name">${escapeHTML(l.name)}</span>
              <span class="c360-list-count">${l.count} companies</span>
            </button>`).join('')}
          </div>`
      }
      <div class="c360-list-create">
        <input class="c360-list-new-input" type="text" placeholder="New list name…" maxlength="60" />
        <button class="btn btn-primary btn-sm c360-list-create-btn">${svgIcon('plus')} Create & Add</button>
      </div>
    </div>`;

  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('open'));

  const close = () => {
    releaseFocus?.();
    overlay.classList.remove('open');
    setTimeout(() => overlay.remove(), 200);
  };
  const releaseFocus = trapFocus(overlay, { restore: document.activeElement });

  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('.c360-list-close').addEventListener('click', close);

  overlay.querySelectorAll('.c360-list-choice').forEach(btn => {
    btn.addEventListener('click', () => {
      workspace.addToList(btn.dataset.listId, key);
      announce(`Added ${rec.companyName} to list.`, 'polite');
      close();
    });
  });

  overlay.querySelector('.c360-list-create-btn').addEventListener('click', () => {
    const input = overlay.querySelector('.c360-list-new-input');
    const name = input.value.trim();
    if (!name) { input.focus(); return; }
    const id = workspace.createList(name);
    if (id) workspace.addToList(id, key);
    close();
  });
}

// ─── Mount ────────────────────────────────────────

/**
 * Router entry point.
 * @param {HTMLElement} container  #page-mount
 * @param {Object} params          { key }
 */
export async function mountCompany360(container, params) {
  const key = params.key || '';
  const cache = dataEngine.cache;

  if (!cache) {
    // Data not ready yet — wait for data:ready, then re-mount.
    container.innerHTML = `
      <section class="glass-panel page-container">
        <div class="cd-loading">Loading company data…</div>
      </section>`;
    const off = bus.on('data:ready', () => {
      off();
      mountCompany360(container, params);
    });
    return () => off();
  }

  // Find record — by dedupeKey primarily, by lowercased name fallback
  let rec = cache.getAll().find(r => r._dedupeKey === key);
  if (!rec) {
    const lc = key.toLowerCase();
    rec = cache.getAll().find(r => (r.companyName || '').toLowerCase() === lc);
  }

  if (!rec) {
    renderNotFound(container, key);
    return null;
  }

  workspace.markRecent(rec._dedupeKey, { name: rec.companyName, category: rec.category });
  document.title = `${rec.companyName} · ESDS BOIP`;
  announce(`Viewing ${rec.companyName}`, 'polite');

  container.innerHTML = `
    <div class="c360-page">
      ${renderHeader(rec)}
      <div class="c360-grid">
        <aside class="c360-col c360-col-left">
          ${renderLeftColumn(rec)}
        </aside>
        <section class="c360-col c360-col-center">
          ${renderExecSummary(rec)}
          ${renderESDSFit(rec)}
          ${renderMaturitySection()}
          ${renderBranchNetwork(rec)}
          ${renderTechStack(rec)}
          ${renderPainPoints(rec)}
        </section>
        <aside class="c360-col c360-col-right">
          ${renderSignalsPanel(rec)}
          ${renderNotesPanel(rec)}
          ${renderPeers(rec)}
        </aside>
      </div>
    </div>
  `;

  renderRadar(container, rec);
  const cleanup = wireActions(container, rec);

  // If we arrived here from a branch map-marker, scroll to and highlight it
  focusBranchIfRequested(container, rec);

  // Return dispose
  return () => {
    if (container._radar) { try { container._radar.dispose(); } catch {} container._radar = null; }
    cleanup.dispose();
    document.title = 'ESDS BFSI Geo Intelligence Dashboard';
  };
}

/**
 * When navigation originates from a branch marker, sessionStorage carries
 * { id, ifsc }. Scroll to the branch table, filter to that branch, and
 * flash-highlight the matching row.
 */
function focusBranchIfRequested(container, rec) {
  let focus = null;
  try {
    const raw = sessionStorage.getItem('boip_branch_focus');
    if (raw) { focus = JSON.parse(raw); sessionStorage.removeItem('boip_branch_focus'); }
  } catch { /* ignore */ }
  if (!focus || (!focus.ifsc && !focus.id)) return;

  // Wait for the branch table to be in the DOM (setTimeout, not rAF —
  // rAF is throttled when the tab is backgrounded).
  setTimeout(() => {
    const search = qs('#c360-branch-search', container);
    const wrap   = qs('#c360-branch-table-wrap', container);
    if (!wrap) return;

    // Filter the table to the branch's IFSC (falls back to nothing if blank)
    if (search && focus.ifsc) {
      search.value = focus.ifsc;
      search.dispatchEvent(new Event('input', { bubbles: true }));
    }

    // Scroll the branch section into view
    const panel = wrap.closest('.c360-panel') || wrap;
    panel.scrollIntoView({ behavior: 'smooth', block: 'center' });

    // Flash-highlight the first matching row after the filter re-renders
    setTimeout(() => {
      const rows = qsa('.c360-branch-table tbody tr', container);
      const target = rows.find(r =>
        focus.ifsc ? r.querySelector('.c360-branch-ifsc')?.textContent?.trim() === focus.ifsc : true
      ) || rows[0];
      if (target) {
        target.classList.add('c360-branch-row-focus');
        target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        setTimeout(() => target.classList.remove('c360-branch-row-focus'), 2600);
      }
    }, 250);
  }, 80);
}
