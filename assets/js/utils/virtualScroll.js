/**
 * virtualScroll.js — Fixed-height virtual scrolling primitive.
 *
 * Renders only the rows visible in the viewport (± overscan). Handles
 * 20,000+ items without hitting the DOM node ceiling.
 *
 * Contract:
 *   mount(container, {
 *     items,           // array
 *     rowHeight,       // px — fixed for O(1) index math
 *     renderRow(item, i) → HTMLElement or HTML string
 *     overscan = 6,    // extra rows above/below viewport
 *     emptyMessage,
 *   })
 *
 *   Returns { update(newItems), scrollToIndex(i), destroy() }
 *
 * The container gets `position: relative; overflow-y: auto` and a fixed
 * height (from CSS). A spacer element sizes the scroll area; a positioned
 * inner element holds only the visible rows.
 */

import { rafThrottle, CleanupRegistry } from './perf.js';

export function mountVirtualList(container, opts) {
  if (!container) throw new Error('virtualScroll: container required');

  const {
    items = [],
    rowHeight,
    renderRow,
    overscan = 6,
    emptyMessage = 'No results',
  } = opts;

  if (!rowHeight || typeof renderRow !== 'function') {
    throw new Error('virtualScroll: rowHeight and renderRow are required');
  }

  const cleanup = new CleanupRegistry();
  let _items = items;

  container.classList.add('vsc-root');
  container.innerHTML = `
    <div class="vsc-spacer" aria-hidden="true"></div>
    <div class="vsc-viewport" role="list"></div>
    <div class="vsc-empty" role="status" hidden>${escapeText(emptyMessage)}</div>
  `;

  const spacer   = container.querySelector('.vsc-spacer');
  const viewport = container.querySelector('.vsc-viewport');
  const emptyEl  = container.querySelector('.vsc-empty');

  function updateSizing() {
    spacer.style.height = (_items.length * rowHeight) + 'px';
    emptyEl.hidden = _items.length > 0;
  }

  function computeRange() {
    const scrollTop = container.scrollTop;
    const viewportH = container.clientHeight;
    const first = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
    const last  = Math.min(_items.length, Math.ceil((scrollTop + viewportH) / rowHeight) + overscan);
    return { first, last };
  }

  function renderRange() {
    const { first, last } = computeRange();
    viewport.style.transform = `translateY(${first * rowHeight}px)`;
    viewport.style.height = ((last - first) * rowHeight) + 'px';

    const frag = document.createDocumentFragment();
    for (let i = first; i < last; i++) {
      const item = _items[i];
      const node = renderRow(item, i);
      if (typeof node === 'string') {
        const div = document.createElement('div');
        div.className = 'vsc-row';
        div.setAttribute('role', 'listitem');
        div.style.height = rowHeight + 'px';
        div.innerHTML = node;
        frag.appendChild(div);
      } else if (node instanceof Node) {
        node.classList?.add('vsc-row');
        node.setAttribute?.('role', 'listitem');
        node.style?.setProperty('height', rowHeight + 'px');
        frag.appendChild(node);
      }
    }
    viewport.replaceChildren(frag);
  }

  const onScroll = rafThrottle(renderRange);
  cleanup.addListener(container, 'scroll', onScroll, { passive: true });

  // Also re-render on resize (viewport height changed)
  const onResize = rafThrottle(renderRange);
  cleanup.addListener(window, 'resize', onResize);

  updateSizing();
  renderRange();

  return {
    update(newItems) {
      _items = newItems || [];
      updateSizing();
      // Reset scroll if the new list is much shorter than current position
      if (container.scrollTop > _items.length * rowHeight) container.scrollTop = 0;
      renderRange();
    },
    scrollToIndex(i) {
      container.scrollTop = Math.max(0, i * rowHeight);
    },
    get size() { return _items.length; },
    destroy() {
      cleanup.dispose();
      container.replaceChildren();
      container.classList.remove('vsc-root');
    },
  };
}

function escapeText(s) {
  const d = document.createElement('div');
  d.textContent = String(s || '');
  return d.innerHTML;
}
