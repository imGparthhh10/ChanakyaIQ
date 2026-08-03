/**
 * breadcrumb.js — Reusable breadcrumb navigation.
 *
 * Usage:
 *   import { Breadcrumb } from './components/breadcrumb.js';
 *   const bc = new Breadcrumb(containerEl, {
 *     items: [
 *       { label: 'Home',      href: '#' },
 *       { label: 'Companies', href: '#companies' },
 *       { label: 'HDFC Bank' },   // last item = active, no href
 *     ],
 *     separator: '/',   // default '/'
 *   });
 *   bc.update([...newItems]);
 */

import { h, mount } from '../utils/dom.js';

export class Breadcrumb {
  constructor(container, opts = {}) {
    this.container = container;
    this.items = opts.items || [];
    this.separator = opts.separator || '/';
    this.render();
  }

  render() {
    const els = [];
    this.items.forEach((item, i) => {
      const isLast = i === this.items.length - 1;
      const inner = isLast
        ? h('span', { class: 'breadcrumb-item active', 'aria-current': 'page' }, item.label)
        : h('span', { class: 'breadcrumb-item' }, [
            h('a', { href: item.href || '#' }, item.label),
          ]);
      els.push(inner);

      if (!isLast) {
        els.push(h('span', { class: 'breadcrumb-sep', 'aria-hidden': 'true' }, this.separator));
      }
    });

    mount(this.container, h('nav', { 'aria-label': 'Breadcrumb' }, [
      h('ol', { class: 'breadcrumb' }, els),
    ]));
  }

  update(items) {
    this.items = items;
    this.render();
  }
}
