/**
 * perf.js — Performance primitives shared across modules.
 *
 * Provides:
 *   - debounce / throttle / rafThrottle
 *   - CleanupRegistry — a Set-based bag of teardown fns for module dispose
 *   - memoizeOne — single-slot memoization for pure aggregations
 *   - measure() — wraps a fn with performance.mark/measure for diagnostics
 */

/** Debounce: fire fn after `wait` ms of quiet. Trailing call. */
export function debounce(fn, wait = 200) {
  let t;
  const debounced = (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(null, args), wait);
  };
  debounced.cancel = () => clearTimeout(t);
  return debounced;
}

/** Throttle: fire at most once per `wait` ms. Trailing call preserved. */
export function throttle(fn, wait = 100) {
  let last = 0;
  let trailingTimer = null;
  let lastArgs = null;

  const throttled = (...args) => {
    const now = Date.now();
    const remaining = wait - (now - last);
    lastArgs = args;

    if (remaining <= 0) {
      last = now;
      clearTimeout(trailingTimer);
      trailingTimer = null;
      fn.apply(null, args);
    } else if (!trailingTimer) {
      trailingTimer = setTimeout(() => {
        last = Date.now();
        trailingTimer = null;
        fn.apply(null, lastArgs);
      }, remaining);
    }
  };
  throttled.cancel = () => { clearTimeout(trailingTimer); trailingTimer = null; };
  return throttled;
}

/** RAF-throttle: fire at most once per animation frame. For scroll/resize/mousemove. */
export function rafThrottle(fn) {
  let scheduled = false;
  let lastArgs = null;

  const throttled = (...args) => {
    lastArgs = args;
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      fn.apply(null, lastArgs);
    });
  };
  return throttled;
}

/**
 * CleanupRegistry — collect teardown callbacks for a module and dispose
 * them all at once. Prevents memory leaks from lingering event listeners,
 * timers, ECharts instances, Leaflet layers, etc.
 *
 * Usage:
 *   const cleanup = new CleanupRegistry();
 *   cleanup.add(() => window.removeEventListener('resize', onResize));
 *   cleanup.add(() => chart.dispose());
 *   // ...
 *   cleanup.dispose(); // runs everything, then clears the registry
 */
export class CleanupRegistry {
  constructor() { this._fns = new Set(); this._disposed = false; }

  add(fn) {
    if (this._disposed || typeof fn !== 'function') return;
    this._fns.add(fn);
    return () => this._fns.delete(fn);
  }

  addListener(target, event, handler, opts) {
    target.addEventListener(event, handler, opts);
    return this.add(() => target.removeEventListener(event, handler, opts));
  }

  addInterval(fn, ms) {
    const id = setInterval(fn, ms);
    return this.add(() => clearInterval(id));
  }

  addTimeout(fn, ms) {
    const id = setTimeout(fn, ms);
    return this.add(() => clearTimeout(id));
  }

  get size() { return this._fns.size; }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    for (const fn of this._fns) {
      try { fn(); } catch (err) { console.warn('[cleanup]', err); }
    }
    this._fns.clear();
  }
}

/**
 * memoizeOne — cache the last result if args are the same by reference.
 * Cheap alternative to full LRU for pure aggregations over cached data.
 */
export function memoizeOne(fn) {
  let lastArgs = null;
  let lastResult;

  return (...args) => {
    if (lastArgs && lastArgs.length === args.length &&
        lastArgs.every((a, i) => a === args[i])) {
      return lastResult;
    }
    lastArgs = args;
    lastResult = fn.apply(null, args);
    return lastResult;
  };
}

/**
 * measure — wrap a fn with performance.mark/measure for diagnostics.
 * Only active when window.__ESDS_PERF__ is truthy — zero cost in production.
 */
export function measure(name, fn) {
  return (...args) => {
    if (!window.__ESDS_PERF__) return fn.apply(null, args);
    const start = performance.now();
    try {
      const result = fn.apply(null, args);
      if (result && typeof result.then === 'function') {
        return result.finally(() => {
          console.debug(`[perf] ${name}: ${(performance.now() - start).toFixed(2)}ms`);
        });
      }
      console.debug(`[perf] ${name}: ${(performance.now() - start).toFixed(2)}ms`);
      return result;
    } catch (err) {
      console.debug(`[perf] ${name}: FAILED after ${(performance.now() - start).toFixed(2)}ms`);
      throw err;
    }
  };
}
