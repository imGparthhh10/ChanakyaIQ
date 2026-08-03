/**
 * exportLoader.js — CDN loaders for export dependencies.
 *
 * SheetJS (XLSX) is loaded lazily by data/excel.js and reused here.
 * jsPDF + html2canvas are loaded on first export use only, so the
 * initial dashboard payload stays lean.
 */

let _xlsxPromise   = null;
let _jspdfPromise  = null;
let _canvasPromise = null;

const SHEETJS_CDN     = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';
const JSPDF_CDN       = 'https://unpkg.com/jspdf@2.5.2/dist/jspdf.umd.min.js';
const HTML2CANVAS_CDN = 'https://unpkg.com/html2canvas@1.4.1/dist/html2canvas.min.js';

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload  = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  });
}

/** Reuse the global XLSX instance loaded by the data engine, or fetch it. */
export async function loadXLSX() {
  if (_xlsxPromise) return _xlsxPromise;
  if (window.XLSX) { _xlsxPromise = Promise.resolve(window.XLSX); return _xlsxPromise; }
  _xlsxPromise = loadScript(SHEETJS_CDN).then(() => window.XLSX);
  return _xlsxPromise;
}

export async function loadJsPDF() {
  if (_jspdfPromise) return _jspdfPromise;
  if (window.jspdf) { _jspdfPromise = Promise.resolve(window.jspdf.jsPDF); return _jspdfPromise; }
  _jspdfPromise = loadScript(JSPDF_CDN).then(() => window.jspdf.jsPDF);
  return _jspdfPromise;
}

export async function loadHtml2Canvas() {
  if (_canvasPromise) return _canvasPromise;
  if (window.html2canvas) { _canvasPromise = Promise.resolve(window.html2canvas); return _canvasPromise; }
  _canvasPromise = loadScript(HTML2CANVAS_CDN).then(() => window.html2canvas);
  return _canvasPromise;
}
