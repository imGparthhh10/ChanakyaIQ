/**
 * theme.js — Dark/Light theme controller.
 * Persists user choice to localStorage; falls back to OS preference.
 * Emits through both the app event bus (for JS modules like charts,
 * compare, map) and a DOM CustomEvent (for third-party listeners).
 */

import { bus } from './utils/eventBus.js';

const STORAGE_KEY = 'esds.theme';
const ATTR        = 'data-theme';

function osPrefersLight() {
  return window.matchMedia?.('(prefers-color-scheme: light)').matches;
}

function readStored() {
  try { return localStorage.getItem(STORAGE_KEY); } catch { return null; }
}
function writeStored(v) {
  try { localStorage.setItem(STORAGE_KEY, v); } catch { /* noop */ }
}

export const theme = {
  /** Current theme: 'dark' | 'light' */
  get current() {
    return document.documentElement.getAttribute(ATTR) || 'dark';
  },

  /** Apply the given theme immediately. */
  set(next) {
    const value = next === 'light' ? 'light' : 'dark';
    const prev  = this.current;
    if (prev === value) return;

    document.documentElement.setAttribute(ATTR, value);
    writeStored(value);

    // Emit both DOM and bus events so every subscriber is notified
    document.dispatchEvent(new CustomEvent('theme:change', { detail: { theme: value } }));
    bus.emit('theme:change', { theme: value, previous: prev });
  },

  /** Toggle between dark ↔ light. */
  toggle() {
    this.set(this.current === 'dark' ? 'light' : 'dark');
  },

  /** Init on boot: stored → OS → dark default. Sets attribute silently. */
  init() {
    const stored = readStored();
    const initial = (stored === 'light' || stored === 'dark')
      ? stored
      : (osPrefersLight() ? 'light' : 'dark');
    document.documentElement.setAttribute(ATTR, initial);
    writeStored(initial);
  },
};
