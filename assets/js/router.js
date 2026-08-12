/**
 * router.js — Hash-based client-side router.
 *
 * Zero-build, works with file:// and any static origin. Routes are
 * registered as pattern strings with `:param` placeholders. The router
 * shows one of:
 *   - a persistent container (registered via `persistentId`) — always in
 *     the DOM, just shown/hidden. Used for pages whose modules wire
 *     themselves up exactly once at boot and assume their DOM targets are
 *     permanently present (the map, filters, charts, KPI cards,
 *     recommendations) — true mount/unmount would break them (Leaflet
 *     throws if its container isn't in the DOM at init; others would just
 *     go stale). See dashboard.js for which routes use this.
 *   - #page-mount for every other route (dynamically populated/torn down
 *     on each navigation, via the page's own mount function)
 *
 * A page's mount function receives (container, params). It may return
 * a dispose function that the router calls on next navigation. Persistent
 * routes pass a no-op mount (nothing to mount — the container's content
 * was rendered once at boot and just gets shown again).
 */

import { bus } from './utils/eventBus.js';

const routes = [];
let _dispose = null;

// Every persistentId ever registered — hidden by default, shown only when
// its own route matches.
const persistentIds = new Set();

/**
 * Register a route.
 * @param {string} pattern e.g. '/' or '/company/:key'
 * @param {Function} mount async (container, params) => disposeFn?
 * @param {{persistentId?: string}} [opts] — persistentId shows that
 *   always-in-DOM container instead of using #page-mount; mount is a no-op.
 */
export function registerRoute(pattern, mount, opts = {}) {
  const keys = [];
  const rx = new RegExp(
    '^' +
    pattern
      .replace(/\//g, '\\/')
      .replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) +
    '$'
  );
  if (opts.persistentId) persistentIds.add(opts.persistentId);
  routes.push({ pattern, rx, keys, mount, persistentId: opts.persistentId });
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
 * Show one persistent container (hiding every other persistent container
 * and #page-mount). Persistent containers are never torn down — their
 * content was rendered once at boot by whatever module owns them.
 */
function showPersistent(id) {
  for (const pid of persistentIds) {
    const el = document.getElementById(pid);
    if (el) el.hidden = (pid !== id);
  }
  const dyn = document.getElementById('page-mount');
  if (dyn) { dyn.hidden = true; dyn.innerHTML = ''; }
}

/** Hide every persistent container and reveal #page-mount for a dynamic page. */
function showDynamic() {
  for (const pid of persistentIds) {
    const el = document.getElementById(pid);
    if (el) el.hidden = true;
  }
  const dyn = document.getElementById('page-mount');
  if (dyn) dyn.hidden = false;
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
    showPersistent('home-page');
    bus.emit('route:change', { path: '/', params: {} });
    return;
  }

  if (found.route.persistentId) {
    showPersistent(found.route.persistentId);
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
