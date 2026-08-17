/**
 * layout.js — App-shell orchestration.
 * Mounts sidebar / navbar / drawer / footer and wires
 * cross-component layout behaviour (collapse, mobile nav).
 */

import { qs }      from './utils/dom.js';
import { bus }     from './utils/eventBus.js';
import { sidebar } from './components/sidebar.js';
import { navbar }  from './components/navbar.js';
import { drawer }  from './components/drawer.js';

const SIDEBAR_KEY = 'esds.sidebar';

function readSidebarState() {
  try { return localStorage.getItem(SIDEBAR_KEY); } catch { return null; }
}
function writeSidebarState(v) {
  try { localStorage.setItem(SIDEBAR_KEY, v); } catch { /* noop */ }
}

export const layout = {
  init() {
    const shell = qs('#app-shell');

    // Mount every top-level region.
    sidebar.mount(qs('#sidebar-root'));
    navbar.mount(qs('#navbar-root'));
    drawer.mount(qs('#drawer-root'));

    // Restore sidebar collapse preference.
    const stored = readSidebarState();
    if (stored === 'collapsed') shell.setAttribute('data-sidebar', 'collapsed');

    // Wire collapse.
    bus.on('sidebar:toggle', () => {
      const collapsed = shell.getAttribute('data-sidebar') === 'collapsed';
      const next = collapsed ? 'expanded' : 'collapsed';
      shell.setAttribute('data-sidebar', next);
      writeSidebarState(next);
    });

    // Wire mobile nav.
    bus.on('sidebar:toggle-mobile', () => {
      const open = shell.getAttribute('data-mobile-nav') === 'open';
      shell.setAttribute('data-mobile-nav', open ? 'closed' : 'open');
    });
  },
};
