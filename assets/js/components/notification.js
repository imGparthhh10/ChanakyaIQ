/**
 * notification.js — Inline notification banners.
 * info | success | warning | error with dismiss support.
 *
 * Usage:
 *   import { Notification } from './components/notification.js';
 *   Notification.show(containerEl, {
 *     type: 'success',
 *     title: 'Exported',
 *     message: 'Report downloaded successfully.',
 *     dismissible: true,
 *   });
 */

import { h } from '../utils/dom.js';

const ICON_MAP = { info: 'ℹ', success: '✓', warning: '⚠', error: '✕' };

export const Notification = {
  show(container, opts = {}) {
    const { type = 'info', title = '', message = '', dismissible = true } = opts;
    const icon = ICON_MAP[type] || 'ℹ';

    const el = h('div', { class: `notification notification-${type}` }, [
      h('span', { class: 'notification-icon' }, icon),
      h('div', { class: 'notification-body' }, [
        title   ? h('div', { class: 'notification-title' }, title)   : null,
        message ? h('p',   { class: 'notification-text' },  message) : null,
      ]),
      dismissible
        ? h('button', { class: 'notification-dismiss', 'aria-label': 'Dismiss', onclick: () => el.remove() }, '✕')
        : null,
    ]);

    container.appendChild(el);
    return el;
  },

  clearAll(container) {
    container.querySelectorAll('.notification').forEach(n => n.remove());
  },
};
