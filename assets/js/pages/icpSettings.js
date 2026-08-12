/**
 * icpSettings.js — ICP qualification-rule thresholds admin page.
 *
 * URL: #/settings/icp
 *
 * Stage 1 of the ICP spec: thresholds must be editable from the dashboard,
 * not hardcoded anywhere in application code. This is that surface — reads
 * and writes backend/src/modules/icp/icp.repository.ts's
 * listQualificationRules()/updateRuleThreshold() via GET/PATCH /api/icp/rules.
 *
 * No new visual language: reuses glass-panel/c360-panel/ef-text-input/btn
 * classes already used everywhere else. The only new styling is inline
 * flex layout for the rule rows, since an editable settings row has no
 * existing precedent elsewhere in this (otherwise read-only) dashboard.
 */

import { escapeHTML } from '../utils/sanitize.js';
import { Icon } from '../components/icons.js';
import { toast } from '../components/toast.js';
import { API_BASE } from '../data/data.js';
import { authFetch } from '../data/authClient.js';

function svgIcon(name) {
  const el = Icon(name);
  const tmp = document.createElement('div');
  tmp.appendChild(el);
  return tmp.innerHTML;
}

export async function mountIcpSettings(container) {
  container.innerHTML = `
    <div class="page-container">
      <section class="glass-panel">
        <p style="padding:var(--sp-6);text-align:center;color:var(--text-muted)">Loading qualification rules…</p>
      </section>
    </div>`;

  let rules;
  try {
    const resp = await authFetch(`${API_BASE}/icp/rules`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    rules = await resp.json();
  } catch (err) {
    container.innerHTML = `
      <div class="page-container">
        <section class="glass-panel">
          <p style="padding:var(--sp-6);text-align:center;color:var(--text-muted)">
            Couldn't load qualification rules — is the backend running? (${escapeHTML(err.message)})
          </p>
        </section>
      </div>`;
    return () => {};
  }

  render(container, rules);
  return () => {};
}

function render(container, rules) {
  const grouped = {};
  for (const r of rules) {
    if (!grouped[r.ruleGroup]) grouped[r.ruleGroup] = [];
    grouped[r.ruleGroup].push(r);
  }

  container.innerHTML = `
    <div class="page-container">
      <header class="page-header glass-panel">
        <div class="page-header-left">
          <span class="eyebrow">Administration</span>
          <h1 class="page-title">ICP Qualification Rules</h1>
          <p class="page-sub">Thresholds live here, not in code — edit and save, then re-run ICP scoring to apply. See <a href="#/settings/business-intent">Business Intent Engine</a> for MEDDPICC-based qualification on top of these tiers.</p>
        </div>
      </header>

      ${Object.entries(grouped).map(([groupName, groupRules]) => `
        <section class="c360-panel glass-panel">
          <h3 class="c360-panel-title">${svgIcon('star')} ${escapeHTML(groupName)}
            <span class="c360-ai-tag">${escapeHTML(groupRules[0].matchLogic)}-match (qualifies if ${groupRules[0].matchLogic === 'ALL' ? 'every' : 'any'} rule below passes)</span>
          </h3>
          <div style="display:flex;flex-direction:column;gap:var(--sp-3)">
            ${groupRules.map(r => `
              <div style="display:flex;align-items:center;gap:var(--sp-3);flex-wrap:wrap" data-rule-row="${escapeHTML(r.ruleId)}">
                <span style="min-width:220px;font-weight:500">${escapeHTML(r.metricDisplayName)}</span>
                <span class="mt-muted">${escapeHTML(r.operator)}</span>
                <input type="number" step="0.01" min="0" class="ef-text-input icp-rule-input"
                  style="max-width:140px" value="${r.thresholdValue}" data-rule-id="${escapeHTML(r.ruleId)}" />
                <span class="mt-muted">${escapeHTML(r.unit === 'INR_CR' ? '₹ Cr' : r.unit)}</span>
                <button class="btn btn-primary btn-sm icp-rule-save" data-rule-id="${escapeHTML(r.ruleId)}">
                  ${svgIcon('checkCircle')} Save
                </button>
              </div>
            `).join('')}
          </div>
        </section>
      `).join('')}
    </div>`;

  container.querySelectorAll('.icp-rule-save').forEach((btn) => {
    btn.addEventListener('click', () => saveRule(container, btn));
  });
}

async function saveRule(container, btn) {
  const ruleId = btn.dataset.ruleId;
  const input = container.querySelector(`.icp-rule-input[data-rule-id="${ruleId}"]`);
  const value = Number(input.value);

  if (!Number.isFinite(value) || value <= 0) {
    toast.error('Invalid value', 'Threshold must be a positive number.');
    return;
  }

  btn.disabled = true;
  try {
    const resp = await authFetch(`${API_BASE}/icp/rules/${ruleId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ thresholdValue: value }),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    toast.success('Saved', 'Threshold updated — re-run ICP scoring (POST /icp/run) to apply it to all organizations.');
  } catch (err) {
    toast.error('Save failed', err.message);
  } finally {
    btn.disabled = false;
  }
}
