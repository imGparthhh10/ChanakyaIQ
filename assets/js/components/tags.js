/**
 * tags.js — Tag and pill component factories.
 *
 * Usage:
 *   import { createTag, createPill, PillGroup } from './components/tags.js';
 *
 *   const tag = createTag({ label: 'Banking', color: 'indigo', removable: true, onRemove: () => {} });
 *   container.appendChild(tag);
 *
 *   const pill = createPill({ label: 'NBFC', count: 142, active: true, onClick: () => {} });
 *   container.appendChild(pill);
 *
 *   const pg = new PillGroup(containerEl, {
 *     items: [ { label: 'All', value: 'all' }, ... ],
 *     selected: 'all',
 *     onChange: (value) => {},
 *   });
 */

import { h, mount } from '../utils/dom.js';

export function createTag(opts = {}) {
  const { label = '', color = '', removable = false, onRemove } = opts;
  const colorClass = color ? `tag-${color}` : '';
  const removeClass = removable ? 'tag-removable' : '';

  return h('span', { class: `tag ${colorClass} ${removeClass}`.trim() }, [
    label,
    removable
      ? h('button', {
          class: 'tag-remove',
          'aria-label': `Remove ${label}`,
          onclick: (e) => {
            e.stopPropagation();
            if (typeof onRemove === 'function') onRemove(label);
            e.target.closest('.tag')?.remove();
          },
        }, '✕')
      : null,
  ]);
}

export function createPill(opts = {}) {
  const { label = '', count, active = false, onClick } = opts;

  const pill = h('button', { class: `pill ${active ? 'active' : ''}` }, [
    label,
    count != null ? h('span', { class: 'pill-count' }, String(count)) : null,
  ]);

  pill.addEventListener('click', () => {
    if (typeof onClick === 'function') onClick(label);
  });

  return pill;
}

export class PillGroup {
  constructor(container, opts = {}) {
    this.container = container;
    this.items = opts.items || [];
    this.selected = opts.selected ?? null;
    this.onChange = opts.onChange;
    this.render();
  }

  render() {
    const pills = this.items.map((item) => {
      const active = item.value === this.selected;
      return createPill({
        label: item.label,
        count: item.count,
        active,
        onClick: () => this.select(item.value),
      });
    });

    mount(this.container, h('div', { class: 'pill-group' }, pills));
  }

  select(value) {
    this.selected = value;
    if (typeof this.onChange === 'function') this.onChange(value);
    this.render();
  }
}
