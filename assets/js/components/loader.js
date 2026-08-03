/**
 * loader.js — Factory functions for spinner, dots, bar,
 * pulse, and skeleton loaders.
 *
 * Usage:
 *   import { Spinner, DotsLoader, BarLoader, PulseLoader, SkeletonText } from './components/loader.js';
 *
 *   container.appendChild(Spinner('lg'));
 *   container.appendChild(DotsLoader());
 *   container.appendChild(BarLoader());
 *   container.appendChild(PulseLoader());
 *   container.appendChild(SkeletonText(4));
 */

import { h } from '../utils/dom.js';

export function Spinner(size = 'md') {
  return h('div', { class: `spinner spinner-${size}`, role: 'status', 'aria-label': 'Loading' });
}

export function DotsLoader() {
  return h('div', { class: 'dots-loader', role: 'status', 'aria-label': 'Loading' }, [
    h('span', {}), h('span', {}), h('span', {}),
  ]);
}

export function BarLoader() {
  return h('div', { class: 'bar-loader', role: 'status', 'aria-label': 'Loading' });
}

export function PulseLoader() {
  return h('div', { class: 'pulse-loader', role: 'status', 'aria-label': 'Loading' });
}

export function SkeletonText(lines = 3) {
  const els = Array.from({ length: lines }, () => h('div', { class: 'sk sk-line' }));
  return h('div', { class: 'skeleton-text' }, els);
}
