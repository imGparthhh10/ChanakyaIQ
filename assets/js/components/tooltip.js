/**
 * tooltip.js — Attach tooltips to any element via data attributes
 * or programmatically.
 *
 * Attribute usage:
 *   <button data-tooltip="Save changes" data-tooltip-pos="top">Save</button>
 *
 * Programmatic:
 *   import { Tooltip } from './components/tooltip.js';
 *   new Tooltip(el, { text: 'Hello', position: 'top' });
 *
 * Call Tooltip.initAll() once to auto-wire all [data-tooltip] elements.
 */

import { h } from '../utils/dom.js';

export class Tooltip {
  constructor(anchor, opts = {}) {
    this.anchor = anchor;
    this.text = opts.text || anchor.getAttribute('data-tooltip') || '';
    this.pos  = opts.position || anchor.getAttribute('data-tooltip-pos') || 'top';
    this._tip = null;

    this.anchor.addEventListener('mouseenter', () => this.show());
    this.anchor.addEventListener('mouseleave', () => this.hide());
    this.anchor.addEventListener('focus',      () => this.show());
    this.anchor.addEventListener('blur',       () => this.hide());
  }

  show() {
    if (!this.text) return;
    if (this._tip) return;
    this._tip = h('div', { class: `tooltip-content tooltip-${this.pos}`, role: 'tooltip' }, this.text);
    this.anchor.style.position = this.anchor.style.position || 'relative';

    const wrap = this.anchor.closest('.tooltip-wrap') || this.anchor;
    if (!wrap.classList.contains('tooltip-wrap')) {
      wrap.style.position = 'relative';
    }
    wrap.appendChild(this._tip);
    requestAnimationFrame(() => this._tip?.classList.add('visible'));
  }

  hide() {
    if (!this._tip) return;
    this._tip.classList.remove('visible');
    const tip = this._tip;
    this._tip = null;
    setTimeout(() => tip.remove(), 160);
  }

  static initAll(root = document) {
    root.querySelectorAll('[data-tooltip]').forEach((el) => {
      if (!el._tooltip) {
        el._tooltip = new Tooltip(el);
      }
    });
  }
}
