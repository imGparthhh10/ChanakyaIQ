/**
 * toast.js — Toast notification system.
 * Supports info/success/warning/error types with auto-dismiss,
 * progress bar countdown, stacking, and manual dismiss.
 *
 * Usage:
 *   import { toast } from './components/toast.js';
 *   toast.success('Saved', 'Changes applied.');
 *   toast.error('Error', 'Connection failed.', { duration: 8000 });
 */

import { h, qs } from '../utils/dom.js';

const ICONS = {
  info:    'ℹ',
  success: '✓',
  warning: '⚠',
  error:   '✕',
};

const DEFAULTS = { duration: 4000, dismissible: true };

let counter = 0;

function createToast(type, title, message, opts = {}) {
  const cfg = { ...DEFAULTS, ...opts };
  const id = `toast-${++counter}`;

  const closeBtn = cfg.dismissible
    ? h('button', { class: 'toast-close', 'aria-label': 'Dismiss', onclick: () => dismiss(id) }, '✕')
    : null;

  const el = h('div', { class: `toast toast-${type}`, id, role: 'alert' }, [
    h('div', { class: 'toast-icon' }, [
      h('span', { class: 't-icon' }, ICONS[type] || ''),
      h('div', { class: 'toast-body' }, [
        title   ? h('div', { class: 'toast-title' }, title) : null,
        message ? h('div', { class: 'toast-msg' }, message) : null,
      ]),
      closeBtn,
    ]),
    h('div', { class: 'toast-progress', style: { width: '100%' } }),
  ]);

  const host = qs('#toast-host');
  if (!host) return;
  host.appendChild(el);

  if (cfg.duration > 0) {
    const bar = qs('.toast-progress', el);
    const start = performance.now();
    const tick = (now) => {
      const elapsed = now - start;
      const pct = Math.max(0, 1 - elapsed / cfg.duration) * 100;
      if (bar) bar.style.width = pct + '%';
      if (elapsed < cfg.duration) requestAnimationFrame(tick);
      else dismiss(id);
    };
    requestAnimationFrame(tick);
  }
}

function dismiss(id) {
  const el = qs(`#${id}`);
  if (!el) return;
  el.classList.add('toast-exit');
  el.addEventListener('animationend', () => el.remove(), { once: true });
}

export const toast = {
  info:    (t, m, o) => createToast('info',    t, m, o),
  success: (t, m, o) => createToast('success', t, m, o),
  warning: (t, m, o) => createToast('warning', t, m, o),
  error:   (t, m, o) => createToast('error',   t, m, o),
  dismiss,
};
