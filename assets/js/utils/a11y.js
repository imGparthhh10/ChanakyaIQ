/**
 * a11y.js — Accessibility primitives.
 *
 * Provides:
 *   - announce()      — polite/assertive live region announcer
 *   - trapFocus()     — traps Tab within a modal / drawer
 *   - restoreFocus()  — utility to return focus to a trigger element
 *   - keyboardNav()   — arrow-key navigation for lists/grids
 *   - installGlobalKeys() — Escape closes topmost overlay; ? opens help
 */

// ─── Live Region Announcer ────────────────────────

let _politeRegion    = null;
let _assertiveRegion = null;

function ensureLiveRegion(mode) {
  if (mode === 'assertive') {
    if (_assertiveRegion) return _assertiveRegion;
    const el = document.createElement('div');
    el.setAttribute('role', 'alert');
    el.setAttribute('aria-live', 'assertive');
    el.setAttribute('aria-atomic', 'true');
    el.className = 'sr-only';
    el.id = 'a11y-live-assertive';
    document.body.appendChild(el);
    _assertiveRegion = el;
    return el;
  }
  if (_politeRegion) return _politeRegion;
  const el = document.createElement('div');
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  el.setAttribute('aria-atomic', 'true');
  el.className = 'sr-only';
  el.id = 'a11y-live-polite';
  document.body.appendChild(el);
  _politeRegion = el;
  return el;
}

/**
 * Announce a message to screen readers.
 * @param {string} msg
 * @param {'polite'|'assertive'} mode — polite (default) waits for a pause,
 *        assertive interrupts immediately (use sparingly, e.g. for errors).
 */
export function announce(msg, mode = 'polite') {
  if (!msg) return;
  const region = ensureLiveRegion(mode);
  // Clear first so the same message announces again if repeated
  region.textContent = '';
  requestAnimationFrame(() => { region.textContent = String(msg); });
}

// ─── Focus Trap ───────────────────────────────────

const FOCUSABLE = [
  'a[href]', 'area[href]', 'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])', 'textarea:not([disabled])',
  'iframe', 'audio[controls]', 'video[controls]',
  '[tabindex]:not([tabindex="-1"])', '[contenteditable="true"]',
].join(',');

function getFocusable(root) {
  return Array.from(root.querySelectorAll(FOCUSABLE))
    .filter(el => !el.hasAttribute('disabled') &&
                  el.getAttribute('aria-hidden') !== 'true' &&
                  el.offsetParent !== null);
}

/**
 * Trap Tab focus inside `container` until the returned dispose function runs.
 * Moves focus to the first focusable element on invocation.
 *
 * @returns {Function} teardown fn — call to remove the trap and restore focus.
 */
export function trapFocus(container, { restore = document.activeElement } = {}) {
  if (!container) return () => {};

  const focusables = getFocusable(container);
  const first = focusables[0];
  const last  = focusables[focusables.length - 1];

  if (first) first.focus();

  const onKey = (e) => {
    if (e.key !== 'Tab') return;
    const items = getFocusable(container);
    if (!items.length) { e.preventDefault(); return; }
    const active = document.activeElement;
    const firstEl = items[0];
    const lastEl  = items[items.length - 1];

    if (e.shiftKey && (active === firstEl || !container.contains(active))) {
      e.preventDefault();
      lastEl.focus();
    } else if (!e.shiftKey && (active === lastEl || !container.contains(active))) {
      e.preventDefault();
      firstEl.focus();
    }
  };

  container.addEventListener('keydown', onKey);
  return () => {
    container.removeEventListener('keydown', onKey);
    if (restore && typeof restore.focus === 'function') {
      try { restore.focus(); } catch { /* noop */ }
    }
  };
}

// ─── Keyboard List Navigation ─────────────────────

/**
 * Wire arrow-key navigation for a list of items inside `root`.
 * @param {HTMLElement} root
 * @param {Object} opts
 * @param {string} opts.itemSelector — selector matching each item
 * @param {'vertical'|'horizontal'|'both'} opts.orientation
 * @param {Function} [opts.onActivate] — called with (element, index) on Enter/Space
 * @returns {Function} teardown fn
 */
export function keyboardNav(root, { itemSelector, orientation = 'vertical', onActivate } = {}) {
  if (!root || !itemSelector) return () => {};

  const onKey = (e) => {
    const items = Array.from(root.querySelectorAll(itemSelector));
    if (!items.length) return;
    const active = document.activeElement;
    const idx = items.indexOf(active);

    const vertical   = orientation === 'vertical'   || orientation === 'both';
    const horizontal = orientation === 'horizontal' || orientation === 'both';

    if ((vertical && e.key === 'ArrowDown') || (horizontal && e.key === 'ArrowRight')) {
      e.preventDefault();
      items[(idx + 1) % items.length]?.focus();
    } else if ((vertical && e.key === 'ArrowUp') || (horizontal && e.key === 'ArrowLeft')) {
      e.preventDefault();
      items[idx <= 0 ? items.length - 1 : idx - 1]?.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      items[0]?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      items[items.length - 1]?.focus();
    } else if ((e.key === 'Enter' || e.key === ' ') && idx >= 0 && onActivate) {
      e.preventDefault();
      onActivate(items[idx], idx);
    }
  };

  root.addEventListener('keydown', onKey);
  return () => root.removeEventListener('keydown', onKey);
}

// ─── Global Key Handlers ──────────────────────────

/**
 * Escape closes the topmost open overlay/modal/drawer.
 * Called once from dashboard boot.
 */
export function installGlobalKeys() {
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;

    // Order: most-recently-opened first
    const selectors = [
      '#exp-overlay.open',
      '#cmp-overlay.open',
      '#rc-modal-overlay.open',
      '#ef-saved-overlay.open',
      '.drawer-root.open',
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) {
        // Trigger the overlay's own close mechanism
        const closeBtn = el.querySelector(
          '.cmp-close, .rc-modal-close, [aria-label="Close"]'
        );
        if (closeBtn) {
          closeBtn.click();
        } else {
          el.classList.remove('open');
        }
        return;
      }
    }
  });
}

/** Restore focus to a stored trigger element after a modal closes. */
export function restoreFocus(el) {
  if (el && typeof el.focus === 'function') {
    try { el.focus(); } catch { /* noop */ }
  }
}
