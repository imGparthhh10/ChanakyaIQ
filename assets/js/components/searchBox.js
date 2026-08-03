/**
 * searchBox.js — Reusable search input with clear button,
 * keyboard shortcut indicator, and debounced events.
 *
 * Usage:
 *   import { SearchBox } from './components/searchBox.js';
 *   const sb = new SearchBox(containerEl, {
 *     placeholder: 'Search companies…',
 *     size: 'md',  // sm | md | lg
 *     shortcut: '/',
 *     onSearch: (value) => { … },
 *     debounce: 250,
 *   });
 *   sb.setValue('test');
 *   sb.clear();
 */

import { h, mount } from '../utils/dom.js';

export class SearchBox {
  constructor(container, opts = {}) {
    this.container = container;
    this.opts = { debounce: 250, placeholder: 'Search…', size: 'md', ...opts };
    this._timer = null;
    this._value = '';
    this.render();
    this._bindGlobalShortcut();
  }

  render() {
    const sizeClass = this.opts.size !== 'md' ? `search-${this.opts.size}` : '';

    this._clearBtn = h('button', {
      class: 'search-clear',
      'aria-label': 'Clear search',
      onclick: () => this.clear(),
    }, '✕');

    this._kbd = this.opts.shortcut
      ? h('span', { class: 'search-kbd' }, this.opts.shortcut)
      : null;

    this._input = h('input', {
      type: 'search',
      class: 'search-input',
      placeholder: this.opts.placeholder,
      'aria-label': this.opts.placeholder,
      oninput: (e) => this._onInput(e),
      onfocus: () => { if (this._kbd) this._kbd.style.display = 'none'; },
      onblur:  () => { if (this._kbd && !this._value) this._kbd.style.display = ''; },
    });

    this._wrap = h('div', { class: `search-box ${sizeClass}` }, [
      this._input,
      h('span', { class: 'search-icon' }, '⌕'),
      this._clearBtn,
      this._kbd,
    ]);

    mount(this.container, this._wrap);
  }

  _onInput(e) {
    this._value = e.target.value;
    this._wrap.classList.toggle('has-value', this._value.length > 0);
    clearTimeout(this._timer);
    this._timer = setTimeout(() => {
      if (typeof this.opts.onSearch === 'function') this.opts.onSearch(this._value);
    }, this.opts.debounce);
  }

  _bindGlobalShortcut() {
    if (!this.opts.shortcut) return;
    document.addEventListener('keydown', (e) => {
      if (e.key === this.opts.shortcut && !e.ctrlKey && !e.metaKey) {
        const tag = document.activeElement?.tagName?.toLowerCase();
        if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
        e.preventDefault();
        this._input.focus();
      }
    });
  }

  setValue(val) {
    this._input.value = val;
    this._value = val;
    this._wrap.classList.toggle('has-value', val.length > 0);
    if (typeof this.opts.onSearch === 'function') this.opts.onSearch(val);
  }

  clear() {
    this.setValue('');
    this._input.focus();
  }

  getValue() { return this._value; }
}
