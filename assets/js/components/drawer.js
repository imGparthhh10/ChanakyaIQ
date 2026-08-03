/**
 * drawer.js — Company detail slide-in drawer.
 * Renders empty shell + open/close controls; content is
 * injected later by the company-detail feature module.
 */

import { h, mount, qs } from '../utils/dom.js';
import { bus }          from '../utils/eventBus.js';

function renderShell() {
  return h('div', { class: 'drawer-inner' }, [
    h('div', { class: 'drawer-head' }, [
      h('span', { class: 'eyebrow' }, 'Company Detail'),
      h('button', {
        class: 'icon-btn drawer-close',
        'aria-label': 'Close drawer',
        onclick: () => drawer.close(),
      }, '✕'),
    ]),
    h('div', { class: 'drawer-body' }, [
      h('div', { class: 'drawer-empty' }, 'Select a company to see its intelligence profile.'),
    ]),
    h('div', { class: 'drawer-foot' }, [
      h('button', { class: 'btn btn-ghost btn-sm' }, 'Add to List'),
      h('button', { class: 'btn btn-primary btn-sm' }, 'Open Full Profile'),
    ]),
  ]);
}

export const drawer = {
  _root:    null,
  _overlay: null,

  mount(target) {
    this._root    = target;
    this._overlay = qs('#drawer-overlay');
    mount(this._root, renderShell());

    // Wiring
    this._overlay?.addEventListener('click', () => this.close());
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.close();
    });
    bus.on('drawer:open',  () => this.open());
    bus.on('drawer:close', () => this.close());
  },

  open() {
    this._root?.classList.add('open');
    this._root?.setAttribute('aria-hidden', 'false');
    this._overlay?.classList.add('open');
    this._overlay?.setAttribute('aria-hidden', 'false');
  },

  close() {
    this._root?.classList.remove('open');
    this._root?.setAttribute('aria-hidden', 'true');
    this._overlay?.classList.remove('open');
    this._overlay?.setAttribute('aria-hidden', 'true');
  },
};
