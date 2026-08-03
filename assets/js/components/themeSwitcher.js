/**
 * themeSwitcher.js — Enhanced theme toggle with sliding pill UI.
 *
 * Usage:
 *   import { ThemeSwitcher } from './components/themeSwitcher.js';
 *   new ThemeSwitcher(containerEl);
 */

import { h, mount } from '../utils/dom.js';
import { theme }    from '../theme.js';

export class ThemeSwitcher {
  constructor(container) {
    this.container = container;
    this.render();
    document.addEventListener('theme:change', () => this._sync());
  }

  render() {
    const current = theme.current;

    this._lightBtn = h('button', {
      class: `theme-switcher-option ${current === 'light' ? 'active' : ''}`,
      'aria-label': 'Light theme',
      onclick: () => theme.set('light'),
    }, '☀');

    this._darkBtn = h('button', {
      class: `theme-switcher-option ${current === 'dark' ? 'active' : ''}`,
      'aria-label': 'Dark theme',
      onclick: () => theme.set('dark'),
    }, '☾');

    this._slide = h('div', { class: 'theme-switcher-slide' });

    this._wrap = h('div', {
      class: 'theme-switcher',
      dataset: { active: current },
      role: 'group',
      'aria-label': 'Theme',
    }, [this._slide, this._lightBtn, this._darkBtn]);

    mount(this.container, this._wrap);
  }

  _sync() {
    const t = theme.current;
    this._wrap.dataset.active = t;
    this._lightBtn.classList.toggle('active', t === 'light');
    this._darkBtn.classList.toggle('active', t === 'dark');
  }
}
