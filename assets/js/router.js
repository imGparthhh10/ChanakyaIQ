/**
 * router.js — Hash-based client-side router.
 *
 * Zero-build, works with file:// and any static origin. Routes are
 * registered as pattern strings with `:param` placeholders. The router
 * shows one of two containers:
 *   - #home-page (the existing dashboard) for the home route
 *   - #page-mount for every other route (dynamically populated)
 *
 * A page's mount function receives (container, params). It may return
 * a dispose function that the router calls on next navigation.
 */

import { bus } from './utils/eventBus.js';

const routes = [];
let _dispose = null;

/**
 * Register a route.
 * @param {string} pattern e.g. '/' or '/company/:key'
 * @param {Function} mount async (container, params) => disposeFn?
 */
export function registerRoute(pattern, mount) {
  const keys = [];
  const rx = new RegExp(
    '^' +
    pattern
      .replace(/\//g, '\\/')
      .replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) +
    '$'
  );
  routes.push({ pattern, rx, keys, mount });
}

/** Programmatic navigation. */
export function navigate(path) {
  const target = '#' + (path.startsWith('/') ? path : '/' + path);
  if (window.location.hash === target) {
    render();
  } else {
    window.location.hash = target;
  }
}

/** Current path (without leading hash). */
export function currentPath() {
  return window.location.hash.slice(1) || '/';
}

/**
 * Show/hide the two page containers. The existing dashboard lives
 * in #home-page; dynamic pages render into #page-mount.
 */
function showHome() {
  const home = document.getElementById('home-page');
  const dyn  = document.getElementById('page-mount');
  if (home) home.hidden = false;
  if (dyn)  { dyn.hidden = true; dyn.innerHTML = ''; }
}

function showDynamic() {
  const home = document.getElementById('home-page');
  const dyn  = document.getElementById('page-mount');
  if (home) home.hidden = true;
  if (dyn)  dyn.hidden = false;
  return dyn;
}

function match(path) {
  for (const route of routes) {
    const m = path.match(route.rx);
    if (m) {
      const params = {};
      route.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      return { route, params };
    }
  }
  return null;
}

async function render() {
  // Tear down previous page
  if (_dispose) {
    try { _dispose(); } catch (err) { console.warn('[router] dispose failed', err); }
    _dispose = null;
  }

  const path  = currentPath();
  const found = match(path);

  if (!found) {
    // Unknown route — send to home
    if (path !== '/') { navigate('/'); return; }
    showHome();
    bus.emit('route:change', { path: '/', params: {} });
    return;
  }

  if (found.route.pattern === '/' || found.route.pattern === '') {
    showHome();
  } else {
    const container = showDynamic();
    if (!container) return;
    try {
      const result = await found.route.mount(container, found.params);
      if (typeof result === 'function') _dispose = result;
    } catch (err) {
      console.error('[router] mount failed', err);
      container.innerHTML = `
        <section class="glass-panel page-container">
          <div class="eb-inline" role="alert">
            <div class="eb-inline-icon">⚠</div>
            <div class="eb-inline-body">
              <h4 class="eb-inline-title">This page failed to load</h4>
              <p class="eb-inline-msg">${(err.message || 'Unknown error').replace(/</g, '&lt;')}</p>
              <button class="btn btn-primary btn-sm" onclick="location.hash='#/'">Back to Home</button>
            </div>
          </div>
        </section>`;
    }
  }

  window.scrollTo({ top: 0, behavior: 'auto' });
  bus.emit('route:change', { path, params: found.params });
}

/** Boot the router. Idempotent. */
export function initRouter() {
  window.addEventListener('hashchange', render);
  // Delay initial render one tick so all routes have registered
  Promise.resolve().then(render);
}
