/**
 * progress.js — Linear and circular progress components.
 *
 * Usage:
 *   import { ProgressBar, CircularProgress } from './components/progress.js';
 *
 *   const bar = new ProgressBar(containerEl, { value: 65, color: 'emerald', size: 'md', label: true });
 *   bar.setValue(80);
 *
 *   const circle = new CircularProgress(containerEl, { value: 72, size: 'lg', color: 'indigo' });
 *   circle.setValue(90);
 */

import { h, mount } from '../utils/dom.js';

export class ProgressBar {
  constructor(container, opts = {}) {
    this.container = container;
    this.value = opts.value ?? 0;
    this.color = opts.color || 'indigo';
    this.size  = opts.size  || 'md';   // sm | md | lg | xl
    this.label = opts.label || false;
    this.striped = opts.striped || false;
    this.render();
  }

  render() {
    const sizeClass = this.size !== 'md' ? `progress-${this.size}` : '';
    const colorClass = `progress-${this.color}`;
    const stripedClass = this.striped ? 'progress-striped' : '';
    const labeledClass = this.label ? 'progress-labeled' : '';

    const bar = h('div', {
      class: 'progress-bar',
      role: 'progressbar',
      'aria-valuenow': this.value,
      'aria-valuemin': '0',
      'aria-valuemax': '100',
      style: { width: `${Math.min(100, Math.max(0, this.value))}%` },
    }, this.label ? [`${Math.round(this.value)}%`] : []);

    this._el = h('div', {
      class: `progress ${sizeClass} ${colorClass} ${stripedClass} ${labeledClass}`.trim(),
    }, [bar]);

    mount(this.container, this._el);
    this._bar = bar;
  }

  setValue(v) {
    this.value = Math.min(100, Math.max(0, v));
    this._bar.style.width = `${this.value}%`;
    this._bar.setAttribute('aria-valuenow', this.value);
    if (this.label) this._bar.textContent = `${Math.round(this.value)}%`;
  }
}

export class CircularProgress {
  constructor(container, opts = {}) {
    this.container = container;
    this.value = opts.value ?? 0;
    this.size  = opts.size  || 'md';
    this.color = opts.color || 'indigo';
    this.strokeWidth = opts.strokeWidth || 4;
    this.render();
  }

  _sizeMap() {
    return { sm: 48, md: 72, lg: 100, xl: 140 }[this.size] || 72;
  }

  _colorVar() {
    const map = {
      indigo: 'var(--indigo)', cyan: 'var(--cyan)', emerald: 'var(--emerald)',
      amber: 'var(--amber)', rose: 'var(--rose)', violet: 'var(--violet)',
      'esds-blue': 'var(--esds-blue)', 'esds-purple': 'var(--esds-purple)',
      'esds-teal': 'var(--esds-teal)', 'esds-green': 'var(--esds-green)',
      'esds-red': 'var(--esds-red)', 'esds-orange': 'var(--esds-orange)',
    };
    return map[this.color] || 'var(--indigo)';
  }

  render() {
    const dim = this._sizeMap();
    const r = (dim - this.strokeWidth * 2) / 2;
    const circ = 2 * Math.PI * r;
    const offset = circ - (this.value / 100) * circ;

    const svg = `<svg width="${dim}" height="${dim}" viewBox="0 0 ${dim} ${dim}">
      <circle class="cp-track" cx="${dim / 2}" cy="${dim / 2}" r="${r}"
              stroke-width="${this.strokeWidth}"/>
      <circle class="cp-fill" cx="${dim / 2}" cy="${dim / 2}" r="${r}"
              stroke-width="${this.strokeWidth}"
              stroke="${this._colorVar()}"
              stroke-dasharray="${circ}"
              stroke-dashoffset="${offset}"/>
    </svg>`;

    const el = h('div', { class: `circular-progress cp-${this.size}`, html: svg }, []);
    const label = h('span', { class: 'cp-label' }, `${Math.round(this.value)}%`);
    el.appendChild(label);

    mount(this.container, el);
    this._el = el;
    this._circ = circ;
    this._r = r;
    this._label = label;
  }

  setValue(v) {
    this.value = Math.min(100, Math.max(0, v));
    const offset = this._circ - (this.value / 100) * this._circ;
    const fill = this._el.querySelector('.cp-fill');
    if (fill) fill.setAttribute('stroke-dashoffset', offset);
    this._label.textContent = `${Math.round(this.value)}%`;
  }
}
