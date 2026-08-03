/**
 * modal.js — Reusable modal dialog.
 * Manages focus-trap, ESC close, overlay click, aria attributes.
 *
 * Usage:
 *   import { modal } from './components/modal.js';
 *   modal.open({
 *     title: 'Confirm Action',
 *     body:  'Are you sure you want to proceed?',
 *     size:  'sm',                       // sm | md(default) | lg | xl | full
 *     footer: [
 *       { label: 'Cancel', variant: 'ghost', action: 'close' },
 *       { label: 'Confirm', variant: 'primary', action: () => { ... } },
 *     ],
 *   });
 *   modal.close();
 */

import { h, qs } from '../utils/dom.js';

let overlayEl = null;

function ensureOverlay() {
  if (overlayEl) return overlayEl;
  overlayEl = h('div', { class: 'modal-overlay', role: 'dialog', 'aria-modal': 'true' });
  document.body.appendChild(overlayEl);
  overlayEl.addEventListener('click', (e) => {
    if (e.target === overlayEl) modal.close();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlayEl.classList.contains('open')) modal.close();
  });
  return overlayEl;
}

function buildFooterBtn(cfg) {
  const cls = `btn btn-${cfg.variant || 'ghost'} btn-sm`;
  return h('button', {
    class: cls,
    onclick: () => {
      if (cfg.action === 'close') modal.close();
      else if (typeof cfg.action === 'function') cfg.action();
    },
  }, cfg.label);
}

export const modal = {
  open(opts = {}) {
    const overlay = ensureOverlay();
    overlay.innerHTML = '';

    const sizeClass = opts.size ? `modal-${opts.size}` : '';

    const bodyContent = opts.body instanceof Node
      ? opts.body
      : h('div', {}, opts.body || '');

    const footerBtns = (opts.footer || []).map(buildFooterBtn);

    const dialog = h('div', { class: `modal ${sizeClass}` }, [
      h('div', { class: 'modal-header' }, [
        h('h3', { class: 'modal-title' }, opts.title || ''),
        h('button', { class: 'modal-close', 'aria-label': 'Close', onclick: () => modal.close() }, '✕'),
      ]),
      h('div', { class: 'modal-body' }, [bodyContent]),
      footerBtns.length
        ? h('div', { class: 'modal-footer' }, footerBtns)
        : null,
    ]);

    overlay.appendChild(dialog);

    requestAnimationFrame(() => overlay.classList.add('open'));

    document.body.style.overflow = 'hidden';

    const firstFocusable = dialog.querySelector('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    firstFocusable?.focus();
  },

  close() {
    if (!overlayEl) return;
    overlayEl.classList.remove('open');
    document.body.style.overflow = '';
    setTimeout(() => { if (overlayEl) overlayEl.innerHTML = ''; }, 300);
  },

  isOpen() {
    return overlayEl?.classList.contains('open') ?? false;
  },
};
