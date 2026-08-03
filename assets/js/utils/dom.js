/**
 * DOM helpers — small, dependency-free utilities used across
 * every component. Kept intentionally minimal.
 */

/** Create an element with attributes + children. */
export function h(tag, attrs = {}, children = []) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class')      el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'dataset' && typeof v === 'object') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html')  el.innerHTML = v;
    else                    el.setAttribute(k, v === true ? '' : v);
  }
  const kids = Array.isArray(children) ? children : [children];
  for (const c of kids) {
    if (c == null || c === false) continue;
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

/** Query selector shortcuts. */
export const qs  = (sel, root = document) => root.querySelector(sel);
export const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** Mount HTML string / Node into a container (idempotent). */
export function mount(container, content) {
  if (!container) return;
  container.innerHTML = '';
  if (typeof content === 'string') container.innerHTML = content;
  else if (content instanceof Node) container.appendChild(content);
}
