/**
 * Tiny pub/sub event bus — used by components to communicate
 * without direct coupling (e.g. filters → map, map → drawer).
 */
const listeners = new Map();

export const bus = {
  on(event, fn) {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(fn);
    return () => this.off(event, fn);
  },
  off(event, fn) {
    listeners.get(event)?.delete(fn);
  },
  emit(event, payload) {
    listeners.get(event)?.forEach(fn => {
      try { fn(payload); } catch (err) { console.error(`[bus:${event}]`, err); }
    });
  },
};
