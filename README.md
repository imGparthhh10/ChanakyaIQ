# ESDS BFSI Geo Intelligence Dashboard

Enterprise market-intelligence dashboard for India's BFSI sector. Reads directly
from the Master BFSI Excel workbooks, deduplicates + indexes 20,000+ company
records in the browser, and drives a geo-map, analytics, filters, comparison,
recommendations, and export flows off a single event bus.

**Zero build step, zero framework.** Vanilla ES modules loaded from a static
web server. Third-party libraries (SheetJS, Leaflet, ECharts, jsPDF, html2canvas)
are pulled lazily from CDN on first use.

---

## Running the dashboard

The dashboard is a pure static site. Serve the project root over any HTTP server
(the `file://` protocol will not work — ES modules and Excel fetches both require
a proper origin).

```bash
# Python 3
python -m http.server 8080

# Node
npx serve .

# PHP
php -S localhost:8080
```

Then open <http://localhost:8080/>.

Excel source files must live in `data/`:

```
data/BFSI_Master_Database.xlsx
data/ESDS_BFSI_MASTER_ALL_CATEGORIES_v3.xlsx
```

The paths are hardcoded in `assets/js/data/data.js` — change them there to point
to a different dataset.

---

## Data flow

```
             ┌─────────────────────────┐
             │ Master BFSI *.xlsx     │
             └────────────┬────────────┘
                          │  fetch + progress
                          ▼
                 data/excel.js          (SheetJS, CDN-lazy-loaded)
                          │  raw sheets
                          ▼
                 data/parser.js         (header normalization → canonical schema)
                          │  parsed records
                          ▼
                 data/validator.js      (sanitize, drop dupes, tag _dedupeKey)
                          │  valid records
                          ▼
                 data/cache.js          (indexed DataCache: O(1) lookups + query)
                          │
                          ▼
                          bus.emit('data:ready', { cache, stats })
```

Every downstream module listens on `bus.on('data:ready', …)` and is completely
decoupled from the pipeline stages before it.

---

## Runtime architecture

```
                        ┌──────────────────┐
                        │  event bus       │  utils/eventBus.js
                        │  (pub/sub)       │
                        └───────┬──────────┘
      data:ready ──────────────┤
      filter:apply  ────────────┤
      filter:reset  ────────────┤
      theme:change  ────────────┤
      company:select ───────────┤
      compare:open / export:*   │
                                ▼
    ┌───────┬──────────┬──────────┬───────────┬───────────┬─────────┬─────────┐
    │ Map   │ Filters  │ Charts   │ KPIs      │ Recos     │ Compare │ Export  │
    │ Leaflet│         │ ECharts  │           │           │ ECharts │ CSV/XLSX│
    │       │          │          │           │           │         │ PDF/PNG │
    └───────┴──────────┴──────────┴───────────┴───────────┴─────────┴─────────┘
```

No module talks to another directly. Everything is coordinated through the bus,
which means each module can be lifted out or replaced without touching the others.

---

## Folder structure

```
assets/
├── css/
│   ├── tokens.css             Design tokens (colors, spacing, typography, elevation)
│   ├── base.css               CSS reset + primitive utilities (sr-only, containers)
│   ├── layout.css             App shell + dashboard grid
│   ├── components.css         Buttons, chips, badges, dot indicators
│   ├── design-system.css      Reusable component styles from the 20-component library
│   ├── animations.css         Reusable keyframes (pulse, count-in, aurora)
│   ├── responsive.css         Media-query breakpoints for shell + grid
│   └── dashboard.css          All feature-scoped CSS (KPIs, filters, charts, map,
│                              drawer, recos, compare, export, error boundary, print)
│
└── js/
    ├── dashboard.js           Entry point — boots error boundary + a11y first,
    │                          then modules in dependency-safe order
    ├── theme.js               Dark/light controller (emits on bus + DOM)
    ├── layout.js              Sidebar/navbar/footer mount + toggle handling
    ├── designSystem.js        Registers the shared component library
    │
    ├── utils/
    │   ├── dom.js             h(), qs(), qsa(), mount() — tiny DOM helpers
    │   ├── eventBus.js        Pub/sub (Map<event, Set<fn>>)
    │   ├── sanitize.js        escapeHTML, sanitizeSearch, sanitizeURL,
    │   │                      sanitizeFilename, safeParseJSON — XSS/injection guards
    │   ├── perf.js            debounce, throttle, rafThrottle, CleanupRegistry,
    │   │                      memoizeOne, measure — performance primitives
    │   ├── a11y.js            announce(), trapFocus(), keyboardNav(),
    │   │                      installGlobalKeys() — WCAG plumbing
    │   ├── errorBoundary.js   installGlobalErrorBoundary, safeAsync, safeSync,
    │   │                      renderError, attachDataErrorHandler — global safety net
    │   └── virtualScroll.js   mountVirtualList — fixed-height virtualization
    │
    ├── data/
    │   ├── excel.js           SheetJS CDN loader + streaming fetch with progress
    │   ├── parser.js          Header→canonical map, type coercion, source tagging
    │   ├── validator.js       Row-level validation, sanitization, dedupe keying
    │   ├── cache.js           DataCache — indexed Sets per dimension + query()
    │   └── data.js            Pipeline orchestrator + public dataEngine API
    │
    ├── map/
    │   ├── cityCoords.js      100+ Indian city → lat/lng lookup with state fallback
    │   ├── layers.js          Leaflet CDN loader, 5 tile layers, India GeoJSON
    │   ├── markers.js         MarkerManager with clustering + per-category colors
    │   ├── choropleth.js      State-level choropleth (companies / revenue / IT spend)
    │   ├── heatmap.js         Leaflet.heat wrapper with weight modes
    │   ├── controls.js        Compass, fullscreen, locate, minimap, layer switcher
    │   └── map.js             Orchestrator — subscribes to filter/theme events
    │
    ├── charts/
    │   ├── echartsLoader.js   ECharts 5.5.1 CDN loader (singleton promise)
    │   ├── chartTheme.js      Theme-aware config generator (dark/light)
    │   └── charts.js          15 charts across 4 tabs + 3 sidebar quick charts,
    │                          with drill-down → filter:apply
    │
    ├── recommendations/
    │   ├── products.js        20 ESDS product catalog with triggers + ROI metadata
    │   ├── engine.js          Multi-dimensional scoring, top-prospect ranker,
    │   │                      cross-portfolio strategy summary
    │   └── renderer.js        Prospect card grid + accordion detail modal
    │
    ├── compare/
    │   └── compare.js         Up-to-3 company comparison: radar, feature table,
    │                          strength/weakness, gap analysis, AI recommendations,
    │                          top 10 / quick wins / high-ROI intelligence
    │
    ├── export/
    │   ├── exportLoader.js    Lazy CDN loaders for jsPDF + html2canvas
    │   ├── formatters.js      Canonical 25-column export schema + CSV escaping
    │   └── export.js          CSV, XLSX, PDF (filtered + single company),
    │                          PNG snapshot, browser Print — one modal entry point
    │
    └── components/
        ├── icons.js           35 inline SVG icons (24×24, stroke-based, currentColor)
        ├── companyDetail.js   Right-side drawer — full intelligence profile
        ├── kpiCards.js        12 executive KPIs with sparklines + counter animation
        ├── filters.js         15 filter fields, instant search + autocomplete,
        │                      cross-filtering, save/load presets
        ├── drawer.js, modal.js, dropdown.js, table.js, pagination.js,
        │ tooltip.js, tags.js, accordion.js, progress.js, notification.js,
        │ toast.js, sidebar.js, navbar.js, footer.js, breadcrumb.js,
        │ toggle.js, loader.js, searchBox.js, themeSwitcher.js  — reusable primitives
        └── …

index.html                     Skeleton + skip link + all glass-panel section mounts
data/                          Master BFSI Excel workbooks
README.md                      This file
```

---

## Event contract

| Event | Payload | Emitted by | Consumed by |
|---|---|---|---|
| `data:progress` | `{ phase, loaded, total, pct }` | `data/excel.js` | `dashboard.js` loading bar |
| `data:status` | `{ phase, message, step, totalSteps, error? }` | `data/data.js` | `dashboard.js`, `errorBoundary` |
| `data:ready` | `{ cache, stats }` | `data/data.js` | every feature module |
| `filter:apply` | `{ …filterKeys }` | `filters.js`, chart drill-down | map, charts, KPIs, recos, export |
| `filter:reset` | `undefined` | `filters.js` | same as above |
| `theme:change` | `{ theme, previous }` | `theme.js` | charts, map, compare |
| `company:select` | `record` | map marker, chart click, reco card | drawer, export |
| `compare:open` | `undefined` | header button | compare modal |
| `compare:add` | `record` | (future integration) | compare modal |
| `export:open` | `undefined` | header button | export modal |
| `export:company` | `record` | drawer "Export Report" | export module (single-company PDF) |

New modules should hook the bus rather than importing feature modules directly.

---

## Performance model

**Target: 20,000+ records with no visible lag on mid-range hardware.**

- **Indexed lookups.** `DataCache` maintains a `Map<value, Set<index>>` for every
  categorical dimension (category, state, region, city, listedStatus, maturities).
  Multi-filter queries intersect Sets in O(k) instead of scanning records.
- **Debounced/throttled input.** Search: 180ms debounce. Filter dropdown changes
  are synchronous but cheap. Scroll/resize handlers use `rafThrottle` from
  `utils/perf.js`.
- **Virtual scrolling.** `utils/virtualScroll.js` provides a fixed-height
  virtual list. Any list rendering more than ~200 items should go through it.
- **Lazy CDN loading.** ECharts, jsPDF, html2canvas, SheetJS all load on first
  use only. Initial payload is CSS + module JS + fonts.
- **Marker clustering.** Leaflet.markercluster runs a single chunked-loading
  pass at zoom-out; heatmap and choropleth swap in without re-fetching.
- **Chart disposal.** Every ECharts instance is tracked in `_charts[id]` and
  disposed before re-mount to prevent WebGL/canvas leaks.
- **Cleanup registries.** `CleanupRegistry` collects timers, listeners, and
  library-instance disposers for modules that open/close (compare modal, export
  modal). One `dispose()` tears everything down.
- **Memoization.** `memoizeOne(fn)` from `utils/perf.js` avoids recomputing
  aggregations when the same filtered array is passed twice in a row.

---

## Accessibility

- **Skip link** at the top of `<body>` — visible on first Tab keypress.
- **Landmarks.** `<header role="banner">`, `<main>`, `<aside>`, `<footer
  role="contentinfo">` — mapped in `index.html`.
- **Live region announcer** — `announce(msg, mode)` in `utils/a11y.js` writes
  to a hidden `role="status"` (polite) or `role="alert"` (assertive) region.
  Filter changes, data-ready, and errors are announced.
- **Focus trap.** Every modal (compare, export, recommendation detail, saved
  filters) invokes `trapFocus(container)` on open and its teardown fn on close.
  Focus is restored to the invoking element.
- **Global keys.** `installGlobalKeys()` binds Escape to close the topmost
  overlay/modal/drawer in reverse-open order.
- **Visible focus rings.** WCAG 2.1 §2.4.7 compliant via `:focus-visible`
  outline in `dashboard.css`.
- **Reduced motion.** `@media (prefers-reduced-motion: reduce)` kills all
  animations and transitions globally.
- **ARIA labels.** All icon-only buttons carry `aria-label`. Progress bar uses
  `role="progressbar"` + `aria-valuenow`. Emoji icons carry `aria-hidden`.
- **Keyboard navigation.** `utils/a11y.js#keyboardNav` provides arrow-key
  navigation for lists; used by the filters autocomplete.

---

## Error handling

- **Global error boundary.** `installGlobalErrorBoundary()` binds `window.error`
  and `unhandledrejection`. Errors are ring-buffered (max 100), surfaced as a
  non-blocking toast, and announced assertively.
- **Sensitive-data redaction.** Logged payloads have leadership names, website
  URLs, and object fields redacted (`utils/errorBoundary.js#redact`).
- **Data-pipeline fatal.** If the Excel pipeline fails, `attachDataErrorHandler`
  turns the loading screen into an inline error with a Retry button that calls
  `dataEngine.reload()`.
- **Per-section fallback.** `renderError(container, { retry })` gives any chart
  or panel a self-contained error card without blanking the dashboard.
- **safeAsync / safeSync.** Wrappers around any risky async fn (map init, data
  reload) — errors log, toast, and return `undefined` instead of throwing.
- **Diagnostic API.** `window.__ESDS_ERRORS__.getLog()` and `.clear()` are
  exposed for support/debugging without needing a console breakpoint.

---

## Security

- **XSS.** Every user-supplied string flows through `escapeHTML` or is inserted
  via `textContent`. Search input is normalized (`sanitizeSearch`) before
  hitting query logic — control chars stripped, length-capped at 200 chars.
- **URL injection.** `sanitizeURL` rejects `javascript:`, `data:`, `vbscript:`,
  and `file:` schemes and prefixes bare domains with `https://`.
- **Filename injection.** `sanitizeFilename` strips path separators + OS-reserved
  characters before any download.
- **JSON injection.** `safeParseJSON(raw, fallback)` isolates corrupt
  localStorage entries; a bad saved filter can never crash the boot sequence.
- **No sensitive data in console.** Error logs redact leadership PII and object
  payloads. There are no `console.log(record)` calls in production paths.
- **CDN integrity.** Third-party libs are loaded from pinned versions (SheetJS
  0.20.3, ECharts 5.5.1, Leaflet 1.9.4, jsPDF 2.5.2, html2canvas 1.4.1). Add
  SRI hashes here if the deployment target requires them.

---

## Extending the dashboard

**Add a new chart.** In `charts/charts.js`, write a `renderMyChart(records)`
function following the `getOrCreate(id)` / `chart.setOption(…, true)` pattern,
then call it from the appropriate tab in `renderActiveTab()`. Add a mount div
to `index.html` inside the target tab panel.

**Add a new filter field.** Extend `data/cache.js` with a new index if the
dimension is categorical, then add an entry to `buildFilterDefs()` in
`components/filters.js`. Register the field in `DataCache.query()`. No other
module needs changes — they all listen on `filter:apply`.

**Add a new export format.** Add an entry to `EXPORT_OPTIONS` in
`export/export.js` with `{ id, icon, label, desc, action }`. The modal
regenerates its grid on open, so it's immediately available.

**Add a new theme.** Add a new palette in `chartTheme.js` behind an
`isDark` branch, then extend `tokens.css` and `dashboard.css` with a new
`[data-theme="<name>"]` selector block. Emit through `bus.emit('theme:change')`.

**Replace the data source.** Change the paths in `EXCEL_FILES` at the top of
`data/data.js`. Header variants live in `data/parser.js#buildHeaderMap` —
extend `define(canonical, ...variants)` there.

---

## Browser support

Modern evergreen browsers (Chrome, Edge, Firefox, Safari — last 2 versions).
ES2020+ syntax (nullish coalescing, optional chaining, ES modules). No polyfills
are shipped; if you need to support older environments, add them to `index.html`
before the module `<script>`.

---

## License

Internal — ESDS Software Solution Limited. All company data belongs to its
original sources; verify sourcing before redistribution.
