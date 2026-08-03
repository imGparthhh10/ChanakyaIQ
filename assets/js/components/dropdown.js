/**
 * dropdown.js — Reusable dropdown menu.
 * Supports dividers, labels, icons, keyboard navigation, click-outside.
 *
 * Usage:
 *   import { Dropdown } from './components/dropdown.js';
 *   const dd = new Dropdown(triggerEl, {
 *     items: [
 *       { label: 'Edit',   icon: '✎',  action: () => {} },
 *       { type: 'divider' },
 *       { label: 'Delete', icon: '⌫', action: () => {}, danger: true },
 *     ],
 *     align: 'right',  // left(default)|right
 *   });
 */

import { h } from '../utils/dom.js';

export class Dropdown {
  constructor(trigger, opts = {}) {
    this.trigger = trigger;
    this.opts = opts;
    this.menuEl = null;
    this._open = false;
    this._onDocClick = this._onDocClick.bind(this);
    this._onDocKey   = this._onDocKey.bind(this);

    this.trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      this._open ? this.close() : this.open();
    });
  }

  _buildMenu() {
    const items = (this.opts.items || []).map((item) => {
      if (item.type === 'divider') return h('div', { class: 'dropdown-divider' });
      if (item.type === 'label')   return h('div', { class: 'dropdown-label' }, item.text);

      const cls = ['dropdown-item'];
      if (item.active)  cls.push('active');
      if (item.disabled) cls.push('disabled');

      return h('button', {
        class: cls.join(' '),
        onclick: () => {
          if (typeof item.action === 'function') item.action();
          this.close();
        },
      }, [
        item.icon ? h('span', { class: 'dd-icon' }, item.icon) : null,
        item.label,
        item.shortcut ? h('span', { class: 'dd-shortcut' }, item.shortcut) : null,
      ]);
    });

    const align = this.opts.align === 'right' ? 'right' : '';
    const dir   = this.opts.direction === 'up' ? 'up' : '';

    this.menuEl = h('div', { class: `dropdown-menu ${align} ${dir}` }, items);
    return this.menuEl;
  }

  open() {
    if (this._open) return;
    if (!this.menuEl) {
      this.trigger.parentElement.style.position = 'relative';
      this.trigger.parentElement.appendChild(this._buildMenu());
    }
    requestAnimationFrame(() => this.menuEl.classList.add('open'));
    this._open = true;
    document.addEventListener('click', this._onDocClick, true);
    document.addEventListener('keydown', this._onDocKey);
  }

  close() {
    if (!this._open) return;
    this.menuEl?.classList.remove('open');
    this._open = false;
    document.removeEventListener('click', this._onDocClick, true);
    document.removeEventListener('keydown', this._onDocKey);
  }

  _onDocClick(e) {
    if (!this.menuEl?.contains(e.target) && !this.trigger.contains(e.target)) {
      this.close();
    }
  }

  _onDocKey(e) {
    if (e.key === 'Escape') this.close();
  }

  destroy() {
    this.close();
    this.menuEl?.remove();
    this.menuEl = null;
  }
}
