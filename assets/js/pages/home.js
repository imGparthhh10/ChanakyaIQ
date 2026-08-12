/**
 * home.js — Homepage. The default landing view at `/`.
 *
 * A persistent page (rendered once at boot by dashboard.js, not through
 * the router's dynamic mount/dispose cycle — see router.js's header
 * comment). Structured into three sections:
 *   A. Welcome — greeting + platform framing line
 *   B. Today's Actions — empty placeholder, content supplied later
 *   C. Take Decision — empty placeholder, content supplied later
 */

import { qs }          from '../utils/dom.js';
import { bus }         from '../utils/eventBus.js';
import { escapeHTML }  from '../utils/sanitize.js';
import { Icon }        from '../components/icons.js';
import { getTimeBasedGreeting } from '../utils/greeting.js';
import { currentUser } from '../data/authClient.js';

function svgIcon(name) {
  const el = Icon(name);
  const tmp = document.createElement('div');
  tmp.appendChild(el);
  return tmp.innerHTML;
}

function renderWelcome() {
  const user = currentUser();
  return `
    <section class="glass-panel digest-hero">
      <div class="digest-hero-avatar">${escapeHTML(user?.initials || 'U')}</div>
      <div class="digest-hero-body">
        <h1 class="digest-hero-title">${getTimeBasedGreeting()}, ${escapeHTML((user?.name || 'there').split(' ')[0])}.</h1>
        <p class="digest-hero-sub">Real-time enterprise targeting across India's Banking, Financial Services &amp; Insurance ecosystem.</p>
      </div>
    </section>`;
}

function renderPlaceholderSection({ dot, title, subtitle, emptyIcon, emptyTitle, emptyBody }) {
  return `
    <section class="glass-panel">
      <div class="analytics-head">
        <h2 class="section-title"><span class="dot ${dot}"></span> ${escapeHTML(title)}</h2>
      </div>
      ${subtitle ? `<p class="section-sub" style="margin:-8px 0 var(--sp-4)">${escapeHTML(subtitle)}</p>` : ''}
      <div class="mt-empty">
        <div class="mt-empty-icon">${svgIcon(emptyIcon)}</div>
        <h3>${escapeHTML(emptyTitle)}</h3>
        <p>${escapeHTML(emptyBody)}</p>
      </div>
    </section>`;
}

function render(container) {
  container.innerHTML = `
    <div class="page-container">
      ${renderWelcome()}
      ${renderPlaceholderSection({
        dot: 'dot-emerald',
        title: "Today's Actions",
        emptyIcon: 'zap',
        emptyTitle: 'Coming soon',
        emptyBody: 'This section will surface the accounts and tasks that need your attention today.',
      })}
      ${renderPlaceholderSection({
        dot: 'dot-amber',
        title: 'Take Decision',
        emptyIcon: 'checkCircle',
        emptyTitle: 'Coming soon',
        emptyBody: 'This section will surface decisions awaiting your input.',
      })}
    </div>`;
}

/** Persistent page — rendered once at boot, kept live if the auth'd user changes. */
export function mountHome() {
  const container = qs('#home-page');
  if (!container) return;
  render(container);
  bus.on('auth:change', () => render(container));
}
