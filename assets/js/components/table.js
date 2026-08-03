/**
 * table.js — High-performance data table with sorting, selection,
 * optional striping, and virtual-scroll-ready architecture.
 *
 * Usage:
 *   import { DataTable } from './components/table.js';
 *   const table = new DataTable(containerEl, {
 *     columns: [
 *       { key: 'name',    label: 'Company',  sortable: true },
 *       { key: 'revenue', label: 'Revenue',  sortable: true, align: 'right' },
 *       { key: 'sector',  label: 'Sector' },
 *     ],
 *     data: [...],
 *     striped: true,
 *     selectable: true,
 *     pageSize: 50,
 *     onRowClick: (row) => {},
 *     onSort: (key, dir) => {},
 *   });
 *   table.setData(newData);
 *   table.sort('revenue', 'desc');
 */

import { h, mount } from '../utils/dom.js';

export class DataTable {
  constructor(container, opts = {}) {
    this.container = container;
    this.opts = opts;
    this.columns = opts.columns || [];
    this._data = opts.data || [];
    this._sortKey = null;
    this._sortDir = 'asc';
    this._selected = new Set();
    this.render();
  }

  render() {
    const classes = ['ds-table'];
    if (this.opts.striped)  classes.push('table-striped');
    if (this.opts.compact)  classes.push('table-sm');

    const thead = h('thead', {}, [
      h('tr', {}, this.columns.map((col) => {
        const thClasses = [];
        if (col.sortable) thClasses.push('sortable');
        if (this._sortKey === col.key) thClasses.push(this._sortDir === 'asc' ? 'sorted-asc' : 'sorted-desc');

        return h('th', {
          class: thClasses.join(' '),
          style: col.align ? { textAlign: col.align } : {},
          onclick: col.sortable ? () => this.sort(col.key) : undefined,
        }, [
          col.label,
          col.sortable ? h('span', { class: 'sort-arrow' }, '▲') : null,
        ]);
      })),
    ]);

    const tbody = h('tbody', {}, this._data.map((row, i) => {
      const selected = this._selected.has(i);
      return h('tr', {
        class: selected ? 'selected' : '',
        onclick: () => this._onRowClick(row, i),
      }, this.columns.map((col) => {
        const val = row[col.key] ?? '';
        const cellContent = typeof col.render === 'function' ? col.render(val, row) : String(val);
        return h('td', {
          style: col.align ? { textAlign: col.align } : {},
          html: cellContent instanceof Node ? undefined : cellContent,
        }, cellContent instanceof Node ? [cellContent] : []);
      }));
    }));

    const table = h('table', { class: classes.join(' ') }, [thead, tbody]);
    mount(this.container, h('div', { class: 'table-wrap' }, [table]));
  }

  _onRowClick(row, idx) {
    if (this.opts.selectable) {
      if (this._selected.has(idx)) this._selected.delete(idx);
      else this._selected.add(idx);
    }
    if (typeof this.opts.onRowClick === 'function') this.opts.onRowClick(row, idx);
    this.render();
  }

  sort(key, dir) {
    if (this._sortKey === key && !dir) {
      this._sortDir = this._sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      this._sortKey = key;
      this._sortDir = dir || 'asc';
    }

    this._data.sort((a, b) => {
      let va = a[key], vb = b[key];
      if (typeof va === 'string') va = va.toLowerCase();
      if (typeof vb === 'string') vb = vb.toLowerCase();
      if (va < vb) return this._sortDir === 'asc' ? -1 : 1;
      if (va > vb) return this._sortDir === 'asc' ? 1 : -1;
      return 0;
    });

    if (typeof this.opts.onSort === 'function') this.opts.onSort(this._sortKey, this._sortDir);
    this.render();
  }

  setData(data) {
    this._data = data;
    this._selected.clear();
    this.render();
  }

  getSelected() {
    return [...this._selected].map(i => this._data[i]);
  }
}
