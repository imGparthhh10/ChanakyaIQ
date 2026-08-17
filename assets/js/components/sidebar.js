/**
 * sidebar.js — Left navigation.
 * Renders brand, grouped nav items, collapse toggle, user card.
 * Wired to the hash router — clicking a nav item navigates; the
 * `route:change` bus event updates the active state automatically.
 */

import { h, mount, qs, qsa } from '../utils/dom.js';
import { bus }               from '../utils/eventBus.js';
import { currentUser, logout } from '../data/authClient.js';

/**
 * Nav model — each item has:
 *   route: hash path it navigates to
 *   match: regex to decide if it's the active item
 */
const NAV_GROUPS = [
  {
    title: 'Workspace',
    items: [
      { route: '/',              label: 'Home',           icon: '⌂', match: /^\/$/ },
      { route: '/executive',     label: 'Executive',      icon: '◆', match: /^\/executive/ },
      { route: '/my-territory',  label: 'My Territory',   icon: '◉', match: /^\/my-territory/ },
      { route: '/digest',        label: 'Digest',         icon: '☰', match: /^\/digest/ },
      { route: '/signals',       label: 'Signals',        icon: '⚡', match: /^\/signals/ },
      { route: '/lists',         label: 'Lists',          icon: '★', match: /^\/lists/ },
    ],
  },
  {
    title: 'Intelligence',
    items: [
      { route: '/whitespace',    label: 'Whitespace',     icon: '◇', match: /^\/whitespace/ },
      { route: '/sectors',       label: 'Sectors',        icon: '⊞', match: /^\/sector/ },
      { route: '/directory',     label: 'Directory',      icon: '▦', match: /^\/directory/ },
      { route: '/companies',     label: 'Companies & Geo Atlas', icon: '◈', match: /^\/companies/ },
      { route: '/analytics',     label: 'Analytics',      icon: '▤', match: /^\/analytics/ },
      { route: '/recommendations', label: 'Recommendations', icon: '✦', match: /^\/recommendations/ },
    ],
  },
  {
    title: 'Tools',
    items: [
      { route: '/',         label: 'Command Palette',icon: '⌘', action: () => bus.emit('palette:open'), hint: '⌘K' },
      { route: '/',         label: 'Compare',        icon: '⇄', action: () => bus.emit('compare:open') },
      { route: '/',         label: 'Export',         icon: '⇩', action: () => bus.emit('export:open') },
    ],
  },
];

function navItem(item) {
  const attrs = {
    href: item.action ? '#' : `#${item.route}`,
    class: '',
    'data-nav-route': item.route,
    'data-nav-match': item.match ? item.match.source : '',
  };
  if (item.anchor) attrs['data-nav-anchor'] = item.anchor;
  if (item.action) attrs['data-nav-action'] = '1';

  const children = [
    h('span', { class: 'nav-icon' }, item.icon),
    h('span', { class: 'nav-label' }, item.label),
    item.hint  ? h('span', { class: 'nav-kbd' }, item.hint)   : null,
    item.count ? h('span', { class: 'nav-count' }, item.count): null,
  ];

  const a = h('a', attrs, children);

  if (item.action) {
    a.addEventListener('click', (e) => { e.preventDefault(); item.action(); });
  } else if (item.anchor) {
    a.addEventListener('click', (e) => {
      // Navigate home, then scroll — router handles the show/hide
      if (location.hash !== '#/' && location.hash !== '') location.hash = '#/';
      setTimeout(() => {
        const el = document.getElementById(item.anchor);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 60);
    });
  }

  return h('li', { class: 'nav-item' }, [a]);
}

function navGroup(group) {
  return h('div', { class: 'nav-group' }, [
    h('div', { class: 'nav-group-title' }, group.title),
    h('ul', { class: 'nav-list' }, group.items.map(navItem)),
  ]);
}

function render() {
  return h('div', { class: 'sidebar' }, [
    h('div', { class: 'sidebar-head' }, [
      h('div', { class: 'sidebar-brand' }, [
        h('div', { class: 'brand-mark' }, 'C'),
        h('div', { class: 'brand-text' }, [
          h('div', { class: 'brand-title' }, 'ChanakyaIQ'),
          h('div', { class: 'brand-sub', title: 'Intelligence that closes deals.' }, 'Intelligence that closes deals.'),
        ]),
      ]),
      h('button', {
        class: 'icon-btn sidebar-toggle',
        'aria-label': 'Toggle sidebar',
        onclick: () => bus.emit('sidebar:toggle'),
      }, '⟨'),
    ]),

    h('nav', { class: 'sidebar-nav', 'aria-label': 'Main' }, NAV_GROUPS.map(navGroup)),

    renderUserSwitcher(),
  ]);
}

// Shows the real logged-in user (authClient.js). The dropdown's only
// action is logging out, replacing the old "switch fake user" list --
// the fake persona roster this used to source from (identity.js) has
// been removed everywhere, not just here.
function renderUserSwitcher() {
  const user = currentUser();
  const wrap = h('div', { class: 'sidebar-foot user-switcher', id: 'sw-user-switcher' });

  const trigger = h('button', {
    class: 'user-switcher-trigger',
    'aria-haspopup': 'menu',
    'aria-expanded': 'false',
    'aria-label': 'Account menu',
  }, [
    h('div', { class: 'user-avatar' }, user?.initials || '·'),
    h('div', { class: 'user-meta' }, [
      h('div', { class: 'user-name' }, user?.name || 'Not signed in'),
      h('div', { class: 'user-role' }, user?.role || ''),
    ]),
    h('span', { class: 'user-chevron', 'aria-hidden': 'true' }, '⌄'),
  ]);

  const menu = h('div', { class: 'user-switcher-menu', role: 'menu', hidden: '' });
  const logoutItem = h('button', {
    class: 'user-switcher-item',
    role: 'menuitem',
  }, [
    h('div', { class: 'user-switcher-avatar', style: 'background:var(--surface-3);color:var(--text-muted)' }, '⏻'),
    h('div', { class: 'user-switcher-info' }, [
      h('div', { class: 'user-switcher-name' }, 'Log out'),
    ]),
  ]);
  logoutItem.addEventListener('click', () => {
    wrap.classList.remove('open');
    trigger.setAttribute('aria-expanded', 'false');
    menu.hidden = true;
    logout();
  });
  menu.appendChild(logoutItem);

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = wrap.classList.toggle('open');
    trigger.setAttribute('aria-expanded', String(open));
    menu.hidden = !open;
  });

  document.addEventListener('click', (e) => {
    if (!wrap.contains(e.target)) {
      wrap.classList.remove('open');
      trigger.setAttribute('aria-expanded', 'false');
      menu.hidden = true;
    }
  });

  wrap.appendChild(menu);
  wrap.appendChild(trigger);
  return wrap;
}

function refreshUserSwitcher() {
  const existing = qs('#sw-user-switcher');
  if (!existing) return;
  const next = renderUserSwitcher();
  existing.replaceWith(next);
}

function updateActive(path) {
  qsa('.sidebar-nav a[data-nav-route]').forEach(a => {
    const src = a.getAttribute('data-nav-match');
    if (!src) { a.classList.remove('active'); return; }
    const rx = new RegExp(src);
    a.classList.toggle('active', rx.test(path));
  });
}

export const sidebar = {
  mount(target) {
    mount(target, render());
    // Sync active state whenever route changes
    bus.on('route:change', ({ path }) => updateActive(path || '/'));
    // Re-render the user block once the real logged-in user is known —
    // sidebar mounts before dashboard.js's auth check resolves, so the
    // trigger initially shows "Not signed in" until this fires.
    bus.on('auth:change', () => refreshUserSwitcher());
    // Initial sync
    updateActive(location.hash.slice(1) || '/');
  },
};
