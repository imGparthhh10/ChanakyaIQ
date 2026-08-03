/**
 * toggle.js — Toggle switch and checkbox factory functions.
 * Returns DOM nodes ready to mount into any container.
 *
 * Usage:
 *   import { createToggle, createCheckbox } from './components/toggle.js';
 *
 *   const sw = createToggle({
 *     label: 'Dark Mode',
 *     checked: true,
 *     size: 'md',
 *     onChange: (checked) => {}
 *   });
 *   container.appendChild(sw);
 *
 *   const cb = createCheckbox({
 *     label: 'Select All',
 *     checked: false,
 *     indeterminate: false,
 *     onChange: (checked) => {}
 *   });
 *   container.appendChild(cb);
 */

import { h } from '../utils/dom.js';

export function createToggle(opts = {}) {
  const {
    label = '',
    checked = false,
    size = 'md',  // sm | md | lg
    disabled = false,
    onChange,
  } = opts;

  const input = h('input', {
    type: 'checkbox',
    checked: checked || undefined,
    disabled: disabled || undefined,
  });

  const track = h('span', { class: 'toggle-track' }, [
    h('span', { class: 'toggle-thumb' }),
  ]);

  const labelNode = label
    ? h('span', { class: 'toggle-label' }, label)
    : null;

  const sizeClass = size !== 'md' ? `toggle-${size}` : '';
  const disabledClass = disabled ? 'disabled' : '';

  const wrapper = h('label', { class: `toggle ${sizeClass} ${disabledClass}`.trim() }, [
    input,
    track,
    labelNode,
  ]);

  input.addEventListener('change', () => {
    if (typeof onChange === 'function') onChange(input.checked);
  });

  wrapper._input = input;
  return wrapper;
}

export function createCheckbox(opts = {}) {
  const {
    label = '',
    checked = false,
    indeterminate = false,
    disabled = false,
    onChange,
  } = opts;

  const input = h('input', {
    type: 'checkbox',
    checked: checked || undefined,
    disabled: disabled || undefined,
  });
  if (indeterminate) input.indeterminate = true;

  const mark  = h('span', { class: 'checkbox-mark' });
  const lbl   = label ? h('span', { class: 'checkbox-label' }, label) : null;
  const disabledClass = disabled ? 'disabled' : '';

  const wrapper = h('label', { class: `checkbox ${disabledClass}`.trim() }, [
    input, mark, lbl,
  ]);

  input.addEventListener('change', () => {
    input.indeterminate = false;
    if (typeof onChange === 'function') onChange(input.checked);
  });

  wrapper._input = input;
  return wrapper;
}
