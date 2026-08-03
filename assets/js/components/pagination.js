/**
 * pagination.js — Reusable pagination with page numbers,
 * ellipsis, prev/next, and configurable page size.
 *
 * Usage:
 *   import { Pagination } from './components/pagination.js';
 *   const pg = new Pagination(containerEl, {
 *     total: 1200,
 *     pageSize: 50,
 *     current: 1,
 *     siblingCount: 1,
 *     onChange: (page) => {},
 *   });
 *   pg.goTo(3);
 */

import { h, mount } from '../utils/dom.js';

export class Pagination {
  constructor(container, opts = {}) {
    this.container = container;
    this.total     = opts.total || 0;
    this.pageSize  = opts.pageSize || 50;
    this.current   = opts.current || 1;
    this.siblings  = opts.siblingCount ?? 1;
    this.onChange  = opts.onChange;
    this.render();
  }

  get totalPages() { return Math.max(1, Math.ceil(this.total / this.pageSize)); }

  _range(start, end) {
    return Array.from({ length: end - start + 1 }, (_, i) => start + i);
  }

  _pageNumbers() {
    const tp = this.totalPages;
    const s = this.siblings;
    const left  = Math.max(this.current - s, 2);
    const right = Math.min(this.current + s, tp - 1);
    const pages = [];

    pages.push(1);
    if (left > 2) pages.push('...');
    this._range(left, right).forEach(n => pages.push(n));
    if (right < tp - 1) pages.push('...');
    if (tp > 1) pages.push(tp);

    return pages;
  }

  goTo(page) {
    if (page < 1 || page > this.totalPages || page === this.current) return;
    this.current = page;
    if (typeof this.onChange === 'function') this.onChange(page);
    this.render();
  }

  setTotal(total) {
    this.total = total;
    if (this.current > this.totalPages) this.current = this.totalPages;
    this.render();
  }

  setPageSize(size) {
    this.pageSize = size;
    this.current = 1;
    this.render();
  }

  render() {
    const nums = this._pageNumbers();
    const start = (this.current - 1) * this.pageSize + 1;
    const end = Math.min(this.current * this.pageSize, this.total);

    const btns = [
      h('button', {
        class: 'page-btn',
        disabled: this.current === 1,
        'aria-label': 'Previous page',
        onclick: () => this.goTo(this.current - 1),
      }, '‹'),

      ...nums.map((n) => {
        if (n === '...') return h('span', { class: 'page-ellipsis' }, '…');
        return h('button', {
          class: `page-btn ${n === this.current ? 'active' : ''}`,
          'aria-current': n === this.current ? 'page' : undefined,
          onclick: () => this.goTo(n),
        }, String(n));
      }),

      h('button', {
        class: 'page-btn',
        disabled: this.current === this.totalPages,
        'aria-label': 'Next page',
        onclick: () => this.goTo(this.current + 1),
      }, '›'),
    ];

    const wrap = h('div', { class: 'flex items-center gap-4 flex-wrap' }, [
      h('nav', { class: 'pagination', 'aria-label': 'Pagination' }, btns),
      this.total > 0
        ? h('span', { class: 'pagination-info' }, `${start}–${end} of ${this.total.toLocaleString()}`)
        : null,
    ]);

    mount(this.container, wrap);
  }
}
