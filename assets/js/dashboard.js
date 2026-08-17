/**
 * dashboard.js — Application entry point.
 *
 * Boots theme + layout, then initializes the data engine.
 * Updates the loading screen with pipeline progress and
 * populates KPI cards once data is ready.
 */

import { theme }      from './theme.js';
import { layout }     from './layout.js';
import { qs }        from './utils/dom.js';
import { bus }        from './utils/eventBus.js';
import { installGlobalErrorBoundary, attachDataErrorHandler, safeAsync } from './utils/errorBoundary.js';
import { installGlobalKeys, announce } from './utils/a11y.js';
import { dataEngine } from './data/data.js';
import { mapEngine }          from './map/map.js';
import { initCompanyPanel }   from './map/companyPanel.js';
import { initCompanyDetail }   from './components/companyDetail.js';
import { initRecommendations } from './recommendations/renderer.js';
import { initKPICards }        from './components/kpiCards.js';
import { initFilters }         from './components/filters.js';
import { initCharts }          from './charts/charts.js';
import { initCompare }         from './compare/compare.js';
import { initExport }          from './export/export.js';
import { initRouter, registerRoute, currentPath } from './router.js';
import { initCommandPalette }  from './commandPalette.js';
import { mountHome }           from './pages/home.js';
import { mountLogin }          from './pages/login.js';
import { me as fetchMe }       from './data/authClient.js';
import { mountCompany360 }     from './pages/company360.js';
import { mountCompanyDirectory } from './pages/companyDirectory.js';
import { mountListsIndex, mountListDetail } from './pages/lists.js';
import { mountSignalsFeed }    from './pages/signals.js';
import { mountIcpSettings }    from './pages/icpSettings.js';
import { mountBusinessIntent } from './pages/businessIntent.js';
import { initIcpSection }     from './components/icpSection.js';
import { mountExecutive }      from './pages/executive.js';
import { mountMyTerritory }    from './pages/myTerritory.js';
import { mountWhitespace }     from './pages/whitespace.js';
import { mountSector }         from './pages/sector.js';
import { mountSectorsIndex }   from './pages/sectorsIndex.js';
import { mountDigest }         from './pages/digest.js';
import { territory }           from './workspace/territory.js';
import { installScoreHistory, delta } from './workspace/scoreHistory.js';
import { hasSignal }           from './workspace/signals.js';
import { DataCache }           from './data/cache.js';

// ─── Loading Screen ────────────────────────────

function updateLoadingText(msg) {
  const sub = qs('.loading-sub');
  if (sub) sub.textContent = msg;
}

function updateLoadingBar(pct) {
  const clamped = Math.max(0, Math.min(pct, 100));
  const bar = qs('.loading-bar span');
  if (bar) bar.style.width = `${clamped}%`;
  const region = qs('.loading-bar');
  if (region) region.setAttribute('aria-valuenow', String(Math.round(clamped)));
}

function hideLoadingScreen() {
  const el = qs('#loading-screen');
  if (!el) return;
  updateLoadingBar(100);
  requestAnimationFrame(() => {
    setTimeout(() => {
      el.classList.add('hidden');
      el.setAttribute('aria-hidden', 'true');
    }, 400);
  });
}

// ─── Progress Listener ─────────────────────────

function setupProgressListener() {
  const stepWeights = { fetch: 40, parse: 20, validate: 15, cache: 10 };
  let basePct = 0;

  bus.on('data:status', ({ phase, message, step, totalSteps }) => {
    if (message) updateLoadingText(message);

    if (step && totalSteps) {
      basePct = Math.round((step / totalSteps) * 85);
      updateLoadingBar(basePct);
    }
  });

  bus.on('data:progress', ({ phase, pct }) => {
    if (phase === 'fetch' && pct != null) {
      updateLoadingBar(Math.round(pct * 0.4));
    }
  });
}

// ─── Header Actions ─────────────────────────────

function wireHeaderActions() {
  qs('[data-action="compare"]')?.addEventListener('click', () => bus.emit('compare:open'));
  qs('[data-action="refresh"]')?.addEventListener('click', async () => {
    announce('Reloading dashboard data…', 'polite');
    const el = qs('#loading-screen');
    if (el) {
      el.classList.remove('hidden');
      el.setAttribute('aria-hidden', 'false');
    }
    updateLoadingBar(5);
    await safeAsync(() => dataEngine.reload(), 'Data refresh')();
  });
}

// ─── Data Ready Handler ────────────────────────

function onDataReady({ cache, stats }) {
  console.log(
    `[Dashboard] Data engine ready: ${cache.size} companies, ` +
    `${stats.duplicatesMerged} duplicates merged, ` +
    `${stats.categories} categories, ${stats.states} states`
  );
  hideLoadingScreen();
  announce(`${cache.size} companies loaded. Dashboard ready.`, 'polite');
}

// ─── Boot ──────────────────────────────────────

const bootDataEngine = safeAsync(
  () => dataEngine.init(),
  'Data engine boot',
);

async function boot() {
  // ─── Install global safety net FIRST ─────────
  installGlobalErrorBoundary();
  installGlobalKeys();

  theme.init();
  layout.init(); // sidebar/navbar mount underneath — harmless even when
                  // the login overlay (position:fixed, covers everything)
                  // is what's actually shown below.

  // ─── Route registration ─────────────────────
  // /login is always registered — needed whether or not the session below
  // turns out valid. Everything else is registered too (cheap — just an
  // array push), but only actually gets *used* once we know the session
  // is valid; see the early return below for the unauthenticated path.
  registerRoute('/login', mountLogin);
  registerRoute('/', () => {}, { persistentId: 'home-page' });
  registerRoute('/companies', () => {}, { persistentId: 'companies-atlas-page' });
  registerRoute('/analytics', () => {}, { persistentId: 'analytics-page' });
  registerRoute('/recommendations', () => {}, { persistentId: 'recommendations-page' });
  registerRoute('/executive',    mountExecutive);
  registerRoute('/my-territory', mountMyTerritory);
  registerRoute('/digest',       mountDigest);
  registerRoute('/whitespace',   mountWhitespace);
  registerRoute('/sectors',      mountSectorsIndex);
  registerRoute('/sector/:key',  mountSector);
  registerRoute('/company/:key', mountCompany360);
  registerRoute('/directory',    mountCompanyDirectory);
  registerRoute('/lists',        mountListsIndex);
  registerRoute('/lists/:id',    mountListDetail);
  registerRoute('/signals',      mountSignalsFeed);
  registerRoute('/settings/icp', mountIcpSettings);
  registerRoute('/settings/business-intent', mountBusinessIntent);

  // ─── Auth gate ───────────────────────────────
  // me() is a no-op (no network call) if there's no stored token at all —
  // the common case for a never-logged-in visitor is instant. If a token
  // exists, it's validated against the server (catches expired/revoked
  // sessions from a previous visit) before any of the expensive
  // map/data/chart machinery below ever starts.
  const user = await fetchMe();
  if (!user) {
    hideLoadingScreen();
    if (currentPath() !== '/login') location.hash = '#/login';
    initRouter();
    return; // skip the whole authenticated boot below
  }

  // ─── Workspace resolvers — must run before filters init ───
  DataCache.registerFilterResolvers({
    ownerOf:       (key) => territory.ownerOf(key),
    currentUserId: () => user?.id || null,
    delta:         (key) => delta(key),
    hasSignal:     (rec, type) => hasSignal(rec, type),
  });
  installScoreHistory();  // snapshots opportunity scores on every data:ready
  attachDataErrorHandler({ onRetry: () => dataEngine.reload() });

  setupProgressListener();
  bus.on('data:ready', onDataReady);
  mountHome();
  initCompanyDetail();
  initCompanyPanel();
  initRecommendations();
  initKPICards();
  initIcpSection();
  initFilters();
  initCharts();
  initCompare();
  initExport();
  initCommandPalette();
  wireHeaderActions();

  initRouter();

  updateLoadingText('Loading BFSI market data…');
  updateLoadingBar(5);

  // Init map in parallel with data loading (both wrapped for safety)
  safeAsync(() => mapEngine.init(), 'Map init')();
  await bootDataEngine();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
