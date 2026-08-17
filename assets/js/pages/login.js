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

import { qs, qsa } from '../utils/dom.js';
import { login, register } from '../data/authClient.js';

// Both forms end the same way on success: store the session and reload so
// dashboard.js's boot() re-runs with a now-valid session, rather than
// trying to resume a half-booted app in place (it skips the whole
// data/map/filters pipeline while unauthenticated).
function goToApp() {
  location.hash = '#/';
  location.reload();
}

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

        <div class="login-tabs" role="tablist">
          <button type="button" class="login-tab active" id="login-tab-signin" data-tab="signin" role="tab" aria-selected="true">Log In</button>
          <button type="button" class="login-tab" id="login-tab-register" data-tab="register" role="tab" aria-selected="false">Create Account</button>
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

        <form class="login-form" id="register-form" novalidate hidden>
          <div class="ef-field">
            <label class="ef-label" for="register-name">Full Name</label>
            <input class="ef-text-input" type="text" id="register-name" name="fullName" autocomplete="name" required />
          </div>
          <div class="ef-field">
            <label class="ef-label" for="register-email">Email</label>
            <input class="ef-text-input" type="email" id="register-email" name="email" autocomplete="username" required />
          </div>
          <div class="ef-field">
            <label class="ef-label" for="register-password">Password</label>
            <input class="ef-text-input" type="password" id="register-password" name="password" autocomplete="new-password" minlength="8" required />
          </div>
          <div class="ef-field">
            <label class="ef-label" for="register-admin-password">Admin Password</label>
            <input class="ef-text-input" type="password" id="register-admin-password" name="adminPassword" autocomplete="off" required />
            <p class="ef-hint">Ask Parth for this — new accounts require it.</p>
          </div>
          <p class="login-error" id="register-error" role="alert" hidden></p>
          <button type="submit" class="btn btn-primary login-submit" id="register-submit">Create Account</button>
        </form>
      </div>
    </div>`;

  // ─── Tabs ─────────────────────────────────────
  const loginForm = qs('#login-form', container);
  const registerForm = qs('#register-form', container);
  const tabs = qsa('.login-tab', container);

  function showTab(name) {
    loginForm.hidden = name !== 'signin';
    registerForm.hidden = name !== 'register';
    for (const tab of tabs) {
      const active = tab.dataset.tab === name;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', String(active));
    }
  }
  for (const tab of tabs) {
    tab.addEventListener('click', () => showTab(tab.dataset.tab));
  }

  // ─── Log In ───────────────────────────────────
  const loginErrorEl = qs('#login-error', container);
  const loginSubmitBtn = qs('#login-submit', container);

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    loginErrorEl.hidden = true;

    const email = qs('#login-email', container).value.trim();
    const password = qs('#login-password', container).value;

    loginSubmitBtn.disabled = true;
    loginSubmitBtn.textContent = 'Signing in…';
    try {
      await login(email, password);
      goToApp();
    } catch (err) {
      loginErrorEl.textContent = err.message || 'Login failed. Please try again.';
      loginErrorEl.hidden = false;
      loginSubmitBtn.disabled = false;
      loginSubmitBtn.textContent = 'Sign In';
    }
  });

  // ─── Create Account ───────────────────────────
  const registerErrorEl = qs('#register-error', container);
  const registerSubmitBtn = qs('#register-submit', container);

  registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    registerErrorEl.hidden = true;

    const fullName = qs('#register-name', container).value.trim();
    const email = qs('#register-email', container).value.trim();
    const password = qs('#register-password', container).value;
    const adminPassword = qs('#register-admin-password', container).value;

    registerSubmitBtn.disabled = true;
    registerSubmitBtn.textContent = 'Creating…';
    try {
      await register(fullName, email, password, adminPassword);
      goToApp();
    } catch (err) {
      registerErrorEl.textContent = err.message || 'Account creation failed. Please try again.';
      registerErrorEl.hidden = false;
      registerSubmitBtn.disabled = false;
      registerSubmitBtn.textContent = 'Create Account';
    }
  });
}

export async function mountLogin(container) {
  render(container);
  return () => {}; // nothing to clean up — no listeners outlive the form
}
