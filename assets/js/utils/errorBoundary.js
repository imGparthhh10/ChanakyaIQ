/**
 * errorBoundary.js — Global error boundary and safe-run wrapper.
 *
 * Vanilla JS has no React-style boundary, so we install:
 *   1. window.onerror         — sync errors
 *   2. unhandledrejection     — async rejections
 *   3. safeAsync(fn)          — wraps a fn to log + display fallback
 *   4. renderError(container) — inline error card for a specific section
 *
 * Errors are logged with a redacted payload (no raw record data) and
 * surface a user-friendly toast so the whole dashboard never blanks.
 */

import { bus } from './eventBus.js';
import { announce } from './a11y.js';

const errorLog = []; // Ring buffer, cap at 100
const MAX_LOG = 100;

/** Push to ring buffer without leaking sensitive payloads. */
function logError(entry) {
  errorLog.push({
    at: new Date().toISOString(),
    ...entry,
  });
  if (errorLog.length > MAX_LOG) errorLog.shift();
}

/** Redact a payload before logging — strips known PII-ish fields. */
function redact(obj) {
  if (!obj || typeof obj !== 'object') return String(obj);
  const REDACT_KEYS = new Set(['ceo', 'cto', 'cio', 'ciso', 'chairman', 'cfo', 'website']);
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (REDACT_KEYS.has(k)) out[k] = '[redacted]';
    else if (typeof v === 'object') out[k] = '[object]';
    else out[k] = v;
  }
  return out;
}

/** Show a non-blocking user-facing error toast. */
function showErrorToast(msg) {
  const host = document.getElementById('toast-host');
  if (!host) return;
  const toast = document.createElement('div');
  toast.className = 'ef-toast eb-toast glass-card';
  toast.setAttribute('role', 'alert');
  toast.textContent = msg;
  host.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 5000);
  announce(msg, 'assertive');
}

/**
 * Wrap an async function so any thrown error is logged and surfaced
 * as a user-friendly message, without breaking the caller.
 * @param {Function} fn
 * @param {string} label — for logging context
 * @param {Function} [fallback] — optional recovery renderer
 */
export function safeAsync(fn, label = 'operation', fallback) {
  return async (...args) => {
    try {
      return await fn.apply(null, args);
    } catch (err) {
      logError({ label, message: err.message, stack: err.stack?.split('\n').slice(0, 5).join('\n') });
      console.error(`[${label}]`, err);
      showErrorToast(`${label} failed — ${err.message || 'unexpected error'}`);
      if (typeof fallback === 'function') {
        try { fallback(err); } catch { /* swallow */ }
      }
      return undefined;
    }
  };
}

/**
 * Sync equivalent of safeAsync.
 */
export function safeSync(fn, label = 'operation', fallback) {
  return (...args) => {
    try {
      return fn.apply(null, args);
    } catch (err) {
      logError({ label, message: err.message });
      console.error(`[${label}]`, err);
      if (typeof fallback === 'function') {
        try { fallback(err); } catch { /* swallow */ }
      }
      return undefined;
    }
  };
}

/**
 * Render an inline error state into a container element.
 * Used when a specific module (chart, panel, list) fails to render.
 */
export function renderError(container, { title = 'Something went wrong', message = '', retry } = {}) {
  if (!container) return;
  container.innerHTML = `
    <div class="eb-inline" role="alert">
      <div class="eb-inline-icon">⚠</div>
      <div class="eb-inline-body">
        <h4 class="eb-inline-title">${escapeText(title)}</h4>
        <p class="eb-inline-msg">${escapeText(message || 'This section could not load. The rest of the dashboard is unaffected.')}</p>
        ${retry ? `<button class="btn btn-ghost btn-sm eb-retry">Try again</button>` : ''}
      </div>
    </div>
  `;
  if (retry) {
    container.querySelector('.eb-retry')?.addEventListener('click', retry);
  }
}

function escapeText(s) {
  const d = document.createElement('div');
  d.textContent = String(s || '');
  return d.innerHTML;
}

// ─── Global Install ───────────────────────────────

let _installed = false;

export function installGlobalErrorBoundary() {
  if (_installed) return;
  _installed = true;

  window.addEventListener('error', (e) => {
    // Ignore script-load errors from third-party CDN (they surface separately)
    if (e.filename && /unpkg|cdn\.sheetjs/.test(e.filename) && !e.error) return;

    logError({
      label: 'window.error',
      message: e.message,
      source: e.filename,
      line: e.lineno,
    });
    // Only toast if it's clearly our code
    if (e.error && e.error.stack && !/extension|chrome-extension/.test(e.error.stack)) {
      showErrorToast('Encountered an unexpected error — the dashboard is still usable.');
    }
  });

  window.addEventListener('unhandledrejection', (e) => {
    const reason = e.reason;
    logError({
      label: 'unhandledrejection',
      message: reason?.message || String(reason),
    });
    console.error('[unhandledrejection]', reason);
    showErrorToast('An async operation failed — please retry.');
  });

  // Expose diagnostic API for support
  window.__ESDS_ERRORS__ = {
    getLog: () => [...errorLog],
    clear: () => { errorLog.length = 0; },
  };
}

// ─── Data-Pipeline Error Handler ──────────────────

/**
 * Attach a listener that turns 'data:status' error phases into a visible
 * fatal error state on the loading screen and inline retry.
 */
export function attachDataErrorHandler({ onRetry } = {}) {
  bus.on('data:status', ({ phase, message, error }) => {
    if (phase !== 'error') return;
    logError({ label: 'data-pipeline', message: message || error?.message });

    const screen = document.getElementById('loading-screen');
    if (!screen) return;
    screen.classList.remove('hidden');
    screen.setAttribute('aria-hidden', 'false');
    screen.innerHTML = `
      <div class="loading-inner eb-fatal" role="alert">
        <div class="eb-fatal-icon">⚠</div>
        <h2 class="eb-fatal-title">Unable to load BFSI data</h2>
        <p class="eb-fatal-msg">${escapeText(message || 'Please check that the Master BFSI Excel files are available in the data/ folder.')}</p>
        ${onRetry ? '<button class="btn btn-primary eb-fatal-retry">Retry</button>' : ''}
      </div>
    `;
    if (onRetry) {
      screen.querySelector('.eb-fatal-retry')?.addEventListener('click', () => {
        screen.classList.add('hidden');
        onRetry();
      });
    }
  });
}
