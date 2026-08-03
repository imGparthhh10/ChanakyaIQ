/**
 * navbar.js — Top navigation.
 * Search, theme toggle, notifications, profile.
 */

import { h, mount } from '../utils/dom.js';
import { bus }      from '../utils/eventBus.js';
import { theme }    from '../theme.js';

function themeToggleBtn() {
  const btn = h('button', {
    class: 'theme-toggle',
    'aria-label': 'Toggle theme',
    title: 'Toggle theme',
    onclick: () => theme.toggle(),
  }, theme.current === 'dark' ? '☾' : '☀');

  document.addEventListener('theme:change', (e) => {
    btn.textContent = e.detail.theme === 'dark' ? '☾' : '☀';
  });
  return btn;
}

function render() {
  return h('div', { class: 'navbar' }, [
    // Mobile nav toggle
    h('button', {
      class: 'icon-btn',
      'aria-label': 'Open menu',
      onclick: () => bus.emit('sidebar:toggle-mobile'),
    }, '☰'),

    // Search
    h('div', { class: 'navbar-search' }, [
      h('span', { class: 'search-ico' }, '⌕'),
      h('input', {
        type: 'search',
        class: 'input',
        placeholder: 'Search companies, sectors, states…',
        'aria-label': 'Global search',
      }),
    ]),

    // Actions
    h('div', { class: 'navbar-actions' }, [
      h('button', { class: 'icon-btn', 'aria-label': 'Notifications' }, '🔔'),
      h('button', { class: 'icon-btn', 'aria-label': 'Help' }, '?'),
      h('span', { class: 'navbar-divider' }),
      themeToggleBtn(),
    ]),
  ]);
}

export const navbar = {
  mount(target) { mount(target, render()); },
};
