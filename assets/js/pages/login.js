/**
 * login.js — Login page.
 *
 * URL: #/login. Rendered as a fixed, full-viewport overlay (same pattern
 * as #loading-screen — position:fixed; inset:0; z-index:var(--z-loading))
 * so it fully covers the app shell (sidebar/navbar) regardless of whether
 * they're mounted underneath — no separate "hide the shell" logic needed.
 *
 * dashboard.js checks auth before booting the data pipeline; any 401 from
 * authClient.authFetch() also redirects here from anywhere in the app.
 */

import { qs } from '../utils/dom.js';
import { login } from '../data/authClient.js';

function render(container) {
  container.innerHTML = `
    <div class="login-page">
      <div class="login-aurora" aria-hidden="true"></div>
      <div class="login-card glass-panel">
        <div class="login-brand">
          <div class="login-mark" aria-hidden="true">
            <span class="login-mark-pulse"></span>
            <span class="login-mark-pulse login-mark-pulse-2"></span>
            <span class="login-mark-letter">C</span>
          </div>
          <h1 class="login-title">ChanakyaIQ</h1>
          <p class="login-tagline">Intelligence that closes deals.</p>
        </div>

        <form class="login-form" id="login-form" novalidate>
          <div class="ef-field">
            <label class="ef-label" for="login-email">Email</label>
            <input class="ef-text-input" type="email" id="login-email" name="email" autocomplete="username" required />
          </div>
          <div class="ef-field">
            <label class="ef-label" for="login-password">Password</label>
            <input class="ef-text-input" type="password" id="login-password" name="password" autocomplete="current-password" required />
          </div>
          <p class="login-error" id="login-error" role="alert" hidden></p>
          <button type="submit" class="btn btn-primary login-submit" id="login-submit">Sign In</button>
        </form>
      </div>
    </div>`;

  const form = qs('#login-form', container);
  const errorEl = qs('#login-error', container);
  const submitBtn = qs('#login-submit', container);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.hidden = true;

    const email = qs('#login-email', container).value.trim();
    const password = qs('#login-password', container).value;

    submitBtn.disabled = true;
    submitBtn.textContent = 'Signing in…';
    try {
      await login(email, password);
      // Full reload rather than a soft route change: dashboard.js's boot()
      // skips the whole data/map/filters pipeline when unauthenticated, so
      // a reload is what actually re-runs boot() with a now-valid session,
      // rather than trying to resume a half-booted app in place.
      location.hash = '#/';
      location.reload();
    } catch (err) {
      errorEl.textContent = err.message || 'Login failed. Please try again.';
      errorEl.hidden = false;
      submitBtn.disabled = false;
      submitBtn.textContent = 'Sign In';
    }
  });
}

export async function mountLogin(container) {
  render(container);
  return () => {}; // nothing to clean up — no listeners outlive the form
}
