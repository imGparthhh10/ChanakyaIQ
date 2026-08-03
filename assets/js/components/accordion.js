/**
 * accordion.js — Reusable accordion / collapsible sections.
 *
 * Usage:
 *   import { Accordion } from './components/accordion.js';
 *   const acc = new Accordion(containerEl, {
 *     items: [
 *       { title: 'Section 1', content: 'Details...' },
 *       { title: 'Section 2', content: node },
 *     ],
 *     multiple: false,  // allow multiple open (default false)
 *   });
 */

import { h, mount, qsa } from '../utils/dom.js';

export class Accordion {
  constructor(container, opts = {}) {
    this.container = container;
    this.opts = opts;
    this.render();
  }

  render() {
    const items = (this.opts.items || []).map((item, idx) => {
      const panelId = `acc-panel-${idx}`;
      const triggerId = `acc-trigger-${idx}`;

      const panel = h('div', { class: 'accordion-panel', id: panelId, role: 'region', 'aria-labelledby': triggerId }, [
        h('div', { class: 'accordion-panel-inner' }, [
          item.content instanceof Node ? item.content : h('p', {}, item.content || ''),
        ]),
      ]);

      const trigger = h('button', {
        class: 'accordion-trigger',
        id: triggerId,
        'aria-expanded': 'false',
        'aria-controls': panelId,
        onclick: () => this._toggle(trigger, panel),
      }, [
        h('span', {}, item.title),
        h('span', { class: 'accordion-chevron' }, '▾'),
      ]);

      return h('div', { class: 'accordion-item' }, [trigger, panel]);
    });

    const wrap = h('div', { class: 'accordion', role: 'group' }, items);
    mount(this.container, wrap);
    this._root = wrap;
  }

  _toggle(trigger, panel) {
    const isOpen = trigger.getAttribute('aria-expanded') === 'true';

    if (!this.opts.multiple) {
      qsa('.accordion-trigger', this._root).forEach((t) => {
        t.setAttribute('aria-expanded', 'false');
      });
      qsa('.accordion-panel', this._root).forEach((p) => {
        p.classList.remove('open');
      });
    }

    trigger.setAttribute('aria-expanded', isOpen ? 'false' : 'true');
    if (isOpen) panel.classList.remove('open');
    else        panel.classList.add('open');
  }

  openAll() {
    qsa('.accordion-trigger', this._root).forEach(t => t.setAttribute('aria-expanded', 'true'));
    qsa('.accordion-panel', this._root).forEach(p => p.classList.add('open'));
  }

  closeAll() {
    qsa('.accordion-trigger', this._root).forEach(t => t.setAttribute('aria-expanded', 'false'));
    qsa('.accordion-panel', this._root).forEach(p => p.classList.remove('open'));
  }
}
