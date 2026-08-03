/**
 * echartsLoader.js — Loads Apache ECharts from CDN.
 * Returns a promise that resolves to the echarts global.
 */

let _promise = null;

export function loadECharts() {
  if (_promise) return _promise;

  if (window.echarts) {
    _promise = Promise.resolve(window.echarts);
    return _promise;
  }

  _promise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://unpkg.com/echarts@5.5.1/dist/echarts.min.js';
    script.async = true;
    script.onload  = () => resolve(window.echarts);
    script.onerror = () => reject(new Error('Failed to load Apache ECharts'));
    document.head.appendChild(script);
  });

  return _promise;
}
