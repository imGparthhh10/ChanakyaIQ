/**
 * footer.js — Sticky footer with meta + secondary links.
 */

import { h, mount } from '../utils/dom.js';

function render() {
  return h('div', { class: 'footer-inner' }, [
    h('div', { class: 'footer-meta' }, [
      `© ${new Date().getFullYear()} ESDS Software Solution Ltd. · BFSI Geo Intelligence Dashboard`,
    ]),
    h('ul', { class: 'footer-links' }, [
      h('li', {}, [h('a', { href: '#privacy'  }, 'Privacy')]),
      h('li', {}, [h('a', { href: '#terms'    }, 'Terms')]),
      h('li', {}, [h('a', { href: '#support'  }, 'Support')]),
      h('li', {}, [h('a', { href: '#version'  }, 'v1.0.0')]),
    ]),
  ]);
}

export const footer = {
  mount(target) { mount(target, render()); },
};
