/**
 * data.js — Data engine orchestrator and public API.
 *
 * API mode (default): fetches organizations + branches from the EIP
 * backend (GET /organizations, GET /branches), then builds the same
 * DataCache/stats/`data:ready` shape the legacy Excel pipeline produced —
 * so every downstream consumer (cache.js and its ~20 consumers) is
 * completely untouched.
 *
 * Legacy mode: set USE_LEGACY_EXCEL_PIPELINE = true to revert to the
 * original in-browser Excel parsing pipeline (excel.js → parser.js →
 * validator.js → branches.js → karnataka.js/gujarat.js). Kept fully intact
 * as a one-line rollback until the Postgres-backed data is confirmed to
 * match — nothing in the legacy path has been deleted.
 */

import { bus }             from '../utils/eventBus.js';
import { loadExcelFiles }  from './excel.js';
import { parseAllSheets }  from './parser.js';
import { validateRecords } from './validator.js';
import { DataCache }       from './cache.js';
import { aggregateBranches, attachBranchProfiles } from './branches.js';
import { loadKarnataka } from './karnataka.js';
import { loadGujarat } from './gujarat.js';
import { authFetch } from './authClient.js';
import { API_BASE } from './apiBase.js';

// Flip to true to roll back to the in-browser Excel pipeline.
const USE_LEGACY_EXCEL_PIPELINE = false;

// Re-exported so existing `import { API_BASE } from '../data/data.js'`
// call sites elsewhere don't need to change — see apiBase.js for why the
// value itself lives in its own module.
export { API_BASE };

const EXCEL_FILES = [
  'data/BFSI_Master_Database.xlsx',
  'data/ESDS_BFSI_MASTER_ALL_CATEGORIES_v3.xlsx',
  'data/ESDS_Banking_Master_Database.xlsx',
];

const STATE = {
  status: 'idle',   // idle | loading | ready | error
  cache: null,
  branches: [],     // flat array of branch records — feeds the map + directory
  branchProfiles: null,
  error: null,
  stats: null,
};

function emitStatus(phase, detail = {}) {
  const payload = { phase, status: STATE.status, ...detail };
  bus.emit('data:status', payload);
}

async function runPipelineFromApi() {
  emitStatus('fetch', { message: 'Loading organizations from API…', step: 1, totalSteps: 2 });

  const [valid, branches] = await Promise.all([
    authFetch(`${API_BASE}/organizations`).then((r) => {
      if (!r.ok) throw new Error(`GET /organizations HTTP ${r.status}`);
      return r.json();
    }),
    authFetch(`${API_BASE}/branches`).then((r) => {
      if (!r.ok) throw new Error(`GET /branches HTTP ${r.status}`);
      return r.json();
    }),
  ]);

  emitStatus('cache', { message: 'Deduplicating and indexing…', step: 2, totalSteps: 2 });
  const cache = new DataCache();
  cache.load(valid);

  STATE.cache = cache;
  STATE.branches = branches;
  STATE.stats = {
    totalValid: valid.length,
    uniqueCompanies: cache.size,
    duplicatesMerged: cache.dupeCount,
    categories: cache.categories().length,
    states: cache.states().length,
    totalBranches: branches.length,
    diagnostics: cache.diagnostics(),
    source: 'postgres-api',
  };

  STATE.status = 'ready';
  emitStatus('ready', {
    message: `Data engine ready — ${cache.size} companies loaded.`,
    stats: STATE.stats,
  });

  bus.emit('data:ready', { cache, stats: STATE.stats, branches: STATE.branches });
}

async function runPipelineFromExcel() {
  // 1. Fetch + parse Excel files via SheetJS
  emitStatus('fetch', { message: 'Loading Excel files…', step: 1, totalSteps: 5 });
  const rawSheets = await loadExcelFiles(EXCEL_FILES);

  // Split sheets by kind — branch listings are routed to the aggregator
  // (would otherwise inflate the company count with 25K+ branch rows).
  const entitySheets = rawSheets.filter(s => s.kind !== 'branches');
  const branchSheets = rawSheets.filter(s => s.kind === 'branches');

  // 2. Normalize columns → canonical schema (entity sheets only)
  emitStatus('parse', { message: 'Normalizing columns…', step: 2, totalSteps: 5 });
  const { records: parsed, parseStats } = parseAllSheets(entitySheets);
  emitStatus('parse', {
    message: `Parsed ${parsed.length} records from ${entitySheets.length} sheets.`,
    step: 2, totalSteps: 5,
    recordCount: parsed.length,
    sheetCount: entitySheets.length,
    parseStats,
  });

  // 3. Validate + sanitize
  emitStatus('validate', { message: 'Validating records…', step: 3, totalSteps: 5 });
  const { valid, invalid, stats: validationStats } = validateRecords(parsed);
  emitStatus('validate', {
    message: `${valid.length} valid, ${invalid.length} rejected.`,
    step: 3, totalSteps: 5,
    validCount: valid.length,
    invalidCount: invalid.length,
    validationStats,
  });

  // 4. Aggregate branch data (from Banking Master's Branches sheets)
  emitStatus('branches', { message: 'Aggregating branch network…', step: 4, totalSteps: 5 });
  const branchAgg = branchSheets.length > 0
    ? aggregateBranches(branchSheets)
    : { profiles: new Map(), branches: [], totalBranches: 0, statsCoverage: {}, importReport: {} };
  STATE.branches = branchAgg.branches;
  STATE.branchProfiles = branchAgg.profiles;
  STATE.branchImportReport = branchAgg.importReport || {};
  const attachStats = attachBranchProfiles(valid, branchAgg.profiles);
  const ir = branchAgg.importReport || {};
  emitStatus('branches', {
    message: `Branches: ${branchAgg.totalBranches.toLocaleString('en-IN')} unique (from ${(ir.rowsRead || 0).toLocaleString('en-IN')} rows · ${(ir.duplicateBranchesMerged || 0).toLocaleString('en-IN')} dupes merged) across ${branchAgg.profiles.size} banks · enriched ${attachStats.attached} records`,
    step: 4, totalSteps: 5,
    totalBranches: branchAgg.totalBranches,
    banksWithBranches: branchAgg.profiles.size,
    recordsEnriched: attachStats.attached,
    unmatchedBankProfiles: attachStats.unmatched,
    importReport: ir,
  });

  // 4b. Karnataka Corporate Banking workbook (separate shape → dedicated loader)
  let karStats = null;
  try {
    const XLSX = window.XLSX;
    if (XLSX) {
      const kar = await loadKarnataka(XLSX);
      // Karnataka records are pre-validated (own _dedupeKey) — append to valid.
      // cache.load() dedups by _dedupeKey, so any overlap merges cleanly.
      valid.push(...kar.records);
      // Merge Apex branches into the shared branch store (map + directory + Company 360).
      STATE.branches = STATE.branches.concat(kar.branches);
      karStats = kar.stats;
      emitStatus('karnataka', {
        message: `Karnataka: ${kar.records.length} companies (${kar.stats.scheduled} scheduled · ${kar.stats.nonScheduled} urban · ${kar.stats.multiState} societies) + ${kar.branches.length} Apex branches`,
        ...kar.stats,
      });
    }
  } catch (err) {
    console.warn('[dataEngine] Karnataka load skipped:', err.message);
  }

  // 4c. Gujarat Co-operative Banking workbook (separate shape → dedicated loader)
  let gujStats = null;
  try {
    const XLSX = window.XLSX;
    if (XLSX) {
      const guj = await loadGujarat(XLSX);
      // Gujarat records are pre-validated (own _dedupeKey) — append to valid.
      // cache.load() dedups by _dedupeKey, so any overlap merges cleanly.
      valid.push(...guj.records);
      // This workbook has no branch sheet — concat is a no-op, kept for symmetry.
      STATE.branches = STATE.branches.concat(guj.branches);
      gujStats = guj.stats;
      emitStatus('gujarat', {
        message: `Gujarat: ${guj.records.length} companies (${guj.stats.stateCoopBank} state · ${guj.stats.urbanCoopBanks} urban · ${guj.stats.dccb} DCCB · ${guj.stats.multiState} societies)`,
        ...guj.stats,
      });
    }
  } catch (err) {
    console.warn('[dataEngine] Gujarat load skipped:', err.message);
  }

  // 5. Deduplicate + index into cache
  emitStatus('cache', { message: 'Deduplicating and indexing…', step: 5, totalSteps: 5 });
  const cache = new DataCache();
  cache.load(valid);

  STATE.cache = cache;
  STATE.stats = {
    totalSheets: rawSheets.length,
    entitySheets: entitySheets.length,
    branchSheets: branchSheets.length,
    totalParsed: parsed.length,
    totalValid: valid.length,
    totalInvalid: invalid.length,
    uniqueCompanies: cache.size,
    duplicatesMerged: cache.dupeCount,
    categories: cache.categories().length,
    states: cache.states().length,
    branches: branchAgg.statsCoverage,
    branchImportReport: branchAgg.importReport || {},
    karnataka: karStats,
    gujarat: gujStats,
    parseStats,
    validationStats,
    diagnostics: cache.diagnostics(),
    source: 'excel-legacy',
  };

  STATE.status = 'ready';
  emitStatus('ready', {
    message: `Data engine ready — ${cache.size} companies loaded.`,
    stats: STATE.stats,
  });

  bus.emit('data:ready', { cache, stats: STATE.stats, branches: STATE.branches });
}

async function runPipeline() {
  if (STATE.status === 'loading') return;
  STATE.status = 'loading';
  emitStatus('start', { message: 'Starting data pipeline…' });

  try {
    if (USE_LEGACY_EXCEL_PIPELINE) {
      await runPipelineFromExcel();
    } else {
      await runPipelineFromApi();
    }
  } catch (err) {
    STATE.status = 'error';
    STATE.error = err;
    emitStatus('error', { message: err.message, error: err });
    console.error('[dataEngine] Pipeline failed:', err);
  }
}

export const dataEngine = {
  /** Boot the data pipeline. Safe to call multiple times — no-ops if already loading/ready. */
  async init() {
    if (STATE.status === 'ready') return STATE.cache;
    await runPipeline();
    return STATE.cache;
  },

  /** Force reload from the data source (API or Excel, per USE_LEGACY_EXCEL_PIPELINE). */
  async reload() {
    STATE.status = 'idle';
    STATE.cache = null;
    STATE.stats = null;
    STATE.error = null;
    await runPipeline();
    return STATE.cache;
  },

  /** Current status: idle | loading | ready | error. */
  get status()  { return STATE.status; },
  get isReady() { return STATE.status === 'ready'; },
  get error()   { return STATE.error; },

  /** The DataCache instance (null until ready). */
  get cache()   { return STATE.cache; },

  /** Flat array of branch records (empty until ready). */
  get branches() { return STATE.branches; },

  /** All branches for a given parent bank dedupeKey. */
  branchesFor(parentKey) {
    if (!parentKey) return [];
    return STATE.branches.filter(b => b.parentKey === parentKey);
  },

  /** Pipeline statistics (null until ready). */
  get stats()   { return STATE.stats; },

  /** Shorthand: query the cache. */
  query(filters) {
    if (!STATE.cache) throw new Error('Data engine not initialized');
    return STATE.cache.query(filters);
  },

  /** Shorthand: compute KPIs for all data or a filtered subset. */
  getKPIs(records) {
    if (!STATE.cache) throw new Error('Data engine not initialized');
    return STATE.cache.computeKPIs(records);
  },

  /** Shorthand: get all records. */
  getAll() {
    if (!STATE.cache) return [];
    return STATE.cache.getAll();
  },
};
