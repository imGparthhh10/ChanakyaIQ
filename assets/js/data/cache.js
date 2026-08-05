/**
 * cache.js — In-memory store with indexed lookups.
 *
 * Holds all validated, deduplicated company records and
 * provides O(1) lookups by sector, state, city, region,
 * and listed status. Designed for 20,000+ records.
 *
 * Usage:
 *   import { DataCache } from './cache.js';
 *   const cache = new DataCache();
 *   cache.load(validRecords);
 *   cache.getByState('Maharashtra');
 *   cache.getByCategory('NBFC');
 *   cache.query({ category: 'NBFC', state: 'Maharashtra' });
 */

export class DataCache {
  /**
   * Cross-module resolvers for cross-cutting filter concerns
   * (ownership, score delta, derived signals). Registered once at
   * boot from dashboard.js so workspace modules stay free of the
   * cache's import graph — avoids a circular dependency.
   */
  static _resolvers = {
    ownerOf:        null, // (companyKey) => userId | null
    currentUserId:  null, // () => userId | null
    delta:          null, // (companyKey) => number | null
    hasSignal:      null, // (record, signalType) => boolean
  };

  /** Register cross-module resolvers. Call once at boot after modules load. */
  static registerFilterResolvers(resolvers) {
    Object.assign(DataCache._resolvers, resolvers);
  }

  constructor() {
    this._records   = [];
    this._byKey     = new Map();   // dedupeKey → record
    this._idxCategory  = new Map(); // category → Set<idx>
    this._idxSubSector = new Map(); // subSector → Set<idx>
    this._idxState     = new Map(); // state → Set<idx>
    this._idxCity      = new Map(); // city → Set<idx>
    this._idxRegion    = new Map(); // region → Set<idx>
    this._idxListed    = new Map(); // listed/unlisted → Set<idx>
    this._idxCloudMat  = new Map(); // cloudMaturity → Set<idx>
    this._idxAiReady   = new Map(); // aiReadiness → Set<idx>
    this._idxCyberMat  = new Map(); // cyberMaturity → Set<idx>
    this._idxDigitalMat = new Map(); // digitalMaturity → Set<idx>

    this._dupeCount   = 0;
    this._mergeCount  = 0;
  }

  /**
   * Load validated records, deduplicating and indexing.
   * Records from the second file that match one already
   * loaded get merged (richer data wins per field).
   */
  load(records) {
    for (const rec of records) {
      const key = rec._dedupeKey;
      if (!key) continue;

      if (this._byKey.has(key)) {
        this._mergeRecords(this._byKey.get(key), rec);
        this._dupeCount++;
        continue;
      }

      const idx = this._records.length;
      rec._idx = idx;
      this._records.push(rec);
      this._byKey.set(key, rec);
      this._addToIndex(this._idxCategory,   rec.category, idx);
      this._addToIndex(this._idxSubSector, rec.subSector, idx);
      this._addToIndex(this._idxState,     rec.state, idx);
      this._addToIndex(this._idxCity,      rec.hqCity, idx);
      this._addToIndex(this._idxRegion,    rec.region, idx);
      this._addToIndex(this._idxListed,    rec.listedStatus, idx);
      this._addToIndex(this._idxCloudMat,  rec.cloudMaturity, idx);
      this._addToIndex(this._idxAiReady,   rec.aiReadiness, idx);
      this._addToIndex(this._idxCyberMat,  rec.cyberMaturity, idx);
      this._addToIndex(this._idxDigitalMat, rec.digitalMaturity, idx);
    }
  }

  /** Merge fields from `src` into `target` where target is empty. */
  _mergeRecords(target, src) {
    this._mergeCount++;
    for (const [k, v] of Object.entries(src)) {
      if (k.startsWith('_')) continue;

      const tVal = target[k];
      const sVal = v;

      // Prefer non-empty over empty
      if ((tVal == null || tVal === '' || tVal === 0) && sVal != null && sVal !== '' && sVal !== 0) {
        target[k] = sVal;
      }

      // For text fields, prefer the longer string (more detail)
      if (typeof tVal === 'string' && typeof sVal === 'string' && sVal.length > tVal.length) {
        target[k] = sVal;
      }
    }

    // Track merge source
    if (!target._mergedFrom) target._mergedFrom = [];
    target._mergedFrom.push(src._source);
  }

  _addToIndex(map, key, idx) {
    if (!key) return;
    if (!map.has(key)) map.set(key, new Set());
    map.get(key).add(idx);
  }

  // ─── Accessors ──────────────────────────────

  get size()       { return this._records.length; }
  get dupeCount()  { return this._dupeCount; }
  get mergeCount() { return this._mergeCount; }

  /** All records (immutable reference). */
  getAll() { return this._records; }

  /** Single record by index. */
  getByIndex(idx) { return this._records[idx] || null; }

  /** Records matching a category. */
  getByCategory(cat) { return this._resolve(this._idxCategory, cat); }

  /** Records matching a state. */
  getByState(st) { return this._resolve(this._idxState, st); }

  /** Records matching a city. */
  getByCity(city) { return this._resolve(this._idxCity, city); }

  /** Records matching a region. */
  getByRegion(region) { return this._resolve(this._idxRegion, region); }

  /** Records matching listed status. */
  getByListedStatus(status) { return this._resolve(this._idxListed, status); }

  _resolve(index, key) {
    const set = index.get(key);
    if (!set) return [];
    return Array.from(set).map(i => this._records[i]);
  }

  // ─── Aggregations ──────────────────────────────

  /** Unique values for a given index (categories, states, etc.). */
  categories()    { return [...this._idxCategory.keys()].sort(); }
  subSectors()    { return [...this._idxSubSector.keys()].sort(); }
  states()        { return [...this._idxState.keys()].sort(); }
  cities()        { return [...this._idxCity.keys()].sort(); }
  regions()       { return [...this._idxRegion.keys()].sort(); }
  cloudMaturities()  { return [...this._idxCloudMat.keys()].sort(); }
  aiReadinesses()    { return [...this._idxAiReady.keys()].sort(); }
  cyberMaturities()  { return [...this._idxCyberMat.keys()].sort(); }
  digitalMaturities(){ return [...this._idxDigitalMat.keys()].sort(); }

  /** Unique values extracted from a text field across all records. */
  uniqueFieldValues(field) {
    const vals = new Set();
    for (const r of this._records) {
      const v = r[field];
      if (v && typeof v === 'string' && v !== 'NA' && v !== 'N/A') vals.add(v);
    }
    return [...vals].sort();
  }

  /** Count per category. */
  categoryCounts() {
    const out = {};
    for (const [k, set] of this._idxCategory) out[k] = set.size;
    return out;
  }

  /** Count per state. */
  stateCounts() {
    const out = {};
    for (const [k, set] of this._idxState) out[k] = set.size;
    return out;
  }

  /** Count per region. */
  regionCounts() {
    const out = {};
    for (const [k, set] of this._idxRegion) out[k] = set.size;
    return out;
  }

  // ─── Multi-filter Query ──────────────────────────────

  /**
   * Query with multiple filters (AND logic).
   * Supports indexed lookups, range filters, text search, and cross-filtering.
   * @param {Object} filters
   * @returns {Object[]} Matching records.
   */
  query(filters = {}) {
    let candidateIdxs = null;

    const intersect = (setOrNull) => {
      if (!setOrNull) return;
      if (candidateIdxs === null) {
        candidateIdxs = new Set(setOrNull);
      } else {
        for (const idx of candidateIdxs) {
          if (!setOrNull.has(idx)) candidateIdxs.delete(idx);
        }
      }
    };

    // Indexed lookups (O(1))
    if (filters.category)        intersect(this._idxCategory.get(filters.category));
    if (filters.subSector)       intersect(this._idxSubSector.get(filters.subSector));
    if (filters.state)           intersect(this._idxState.get(filters.state));
    if (filters.region)          intersect(this._idxRegion.get(filters.region));
    if (filters.city)            intersect(this._idxCity.get(filters.city));
    if (filters.listedStatus)    intersect(this._idxListed.get(filters.listedStatus));
    if (filters.cloudMaturity)   intersect(this._idxCloudMat.get(filters.cloudMaturity));
    if (filters.aiReadiness)     intersect(this._idxAiReady.get(filters.aiReadiness));
    if (filters.cyberMaturity)   intersect(this._idxCyberMat.get(filters.cyberMaturity));
    if (filters.digitalMaturity) intersect(this._idxDigitalMat.get(filters.digitalMaturity));

    let results = candidateIdxs === null
      ? [...this._records]
      : Array.from(candidateIdxs).map(i => this._records[i]);

    // District filter — matches when any branch of the company is in that district
    if (filters.district) {
      const d = String(filters.district).toLowerCase();
      results = results.filter(r => {
        const tops = r.topBranchDistricts || [];
        return tops.some(entry => String(entry[0] || '').toLowerCase() === d);
      });
    }

    // Range filters (revenue, employees)
    if (filters.revenueMin != null) results = results.filter(r => r.revenue >= filters.revenueMin);
    if (filters.revenueMax != null) results = results.filter(r => r.revenue != null && r.revenue <= filters.revenueMax);
    if (filters.employeeMin != null) results = results.filter(r => r.employeeCount >= filters.employeeMin);
    if (filters.employeeMax != null) results = results.filter(r => r.employeeCount != null && r.employeeCount <= filters.employeeMax);

    // ICP filters — opportunityTier/icpScore/opportunityTags are plain
    // fields already on each record (populated by the backend's ICP engine
    // via GET /organizations), so no cross-module resolver is needed here,
    // unlike owner/delta/signal below.
    if (filters.opportunityTiers && filters.opportunityTiers.length) {
      results = results.filter(r => filters.opportunityTiers.includes(r.opportunityTier));
    }
    if (filters.icpScoreMin != null) {
      results = results.filter(r => r.icpScore != null && r.icpScore >= filters.icpScoreMin);
    }
    if (filters.icpScoreMax != null) {
      results = results.filter(r => r.icpScore != null && r.icpScore <= filters.icpScoreMax);
    }
    if (filters.opportunityTags && filters.opportunityTags.length) {
      results = results.filter(r => filters.opportunityTags.some(t => (r.opportunityTags || []).includes(t)));
    }

    // Leadership text filters
    if (filters.ceo) { const q = filters.ceo.toLowerCase(); results = results.filter(r => r.ceo && r.ceo.toLowerCase().includes(q)); }
    if (filters.cto) { const q = filters.cto.toLowerCase(); results = results.filter(r => r.cto && r.cto.toLowerCase().includes(q)); }
    if (filters.cio) { const q = filters.cio.toLowerCase(); results = results.filter(r => r.cio && r.cio.toLowerCase().includes(q)); }

    // Pain points keyword filter
    if (filters.painPoint) {
      const q = filters.painPoint.toLowerCase();
      results = results.filter(r => r.painPoints && r.painPoints.toLowerCase().includes(q));
    }

    // ESDS product recommendation filter
    if (filters.esdsProduct) {
      const prodName = filters.esdsProduct;
      results = results.filter(r => {
        const pp = (r.painPoints || '').toLowerCase();
        const es = (r.esdsFitNotes || '').toLowerCase();
        const pn = prodName.toLowerCase();
        return pp.includes(pn) || es.includes(pn);
      });
    }

    // Owner filter — resolvers registered at boot via DataCache.registerFilterResolvers()
    if (filters.owner && DataCache._resolvers.ownerOf && DataCache._resolvers.currentUserId) {
      const ownerOf = DataCache._resolvers.ownerOf;
      if (filters.owner === 'me') {
        const uid = DataCache._resolvers.currentUserId();
        results = results.filter(r => ownerOf(r._dedupeKey) === uid);
      } else if (filters.owner === 'unassigned') {
        results = results.filter(r => !ownerOf(r._dedupeKey));
      } else {
        results = results.filter(r => ownerOf(r._dedupeKey) === filters.owner);
      }
    }

    // Δ-score filter — minimum absolute score change since previous snapshot
    if (filters.deltaMin != null && DataCache._resolvers.delta) {
      const deltaFn = DataCache._resolvers.delta;
      const min = Number(filters.deltaMin);
      results = results.filter(r => {
        const d = deltaFn(r._dedupeKey);
        return d != null && Math.abs(d) >= min;
      });
    }

    // Buying-signal filter — any signal, or a specific type
    if (filters.signal && DataCache._resolvers.hasSignal) {
      const hasSignal = DataCache._resolvers.hasSignal;
      results = results.filter(r => hasSignal(r, filters.signal));
    }

    // Text search filter (global)
    if (filters.search) {
      const q = filters.search.toLowerCase();
      results = results.filter(r =>
        (r.companyName && r.companyName.toLowerCase().includes(q)) ||
        (r.category    && r.category.toLowerCase().includes(q)) ||
        (r.subSector   && r.subSector.toLowerCase().includes(q)) ||
        (r.hqCity      && r.hqCity.toLowerCase().includes(q)) ||
        (r.state       && r.state.toLowerCase().includes(q)) ||
        (r.ceo         && r.ceo.toLowerCase().includes(q)) ||
        (r.cto         && r.cto.toLowerCase().includes(q)) ||
        (r.painPoints  && r.painPoints.toLowerCase().includes(q)) ||
        (r.techStack   && r.techStack.toLowerCase().includes(q))
      );
    }

    return results;
  }

  // ─── KPI Aggregates ──────────────────────────────

  /**
   * Compute KPI summary from current dataset (or a filtered subset).
   */
  computeKPIs(records) {
    const data = records || this._records;
    let totalRevenue = 0, totalProfit = 0, totalIT = 0, totalCloud = 0;
    let revenueCount = 0, profitCount = 0;

    for (const r of data) {
      if (r.revenue != null)    { totalRevenue += r.revenue; revenueCount++; }
      if (r.netProfit != null)  { totalProfit += r.netProfit; profitCount++; }
      if (r.itSpend != null)    totalIT += r.itSpend;
      if (r.cloudSpend != null) totalCloud += r.cloudSpend;
    }

    return {
      totalCompanies: data.length,
      totalCategories: new Set(data.map(r => r.category)).size,
      totalStates: new Set(data.filter(r => r.state).map(r => r.state)).size,
      totalRevenue,
      totalProfit,
      totalIT,
      totalCloud,
      companiesWithRevenue: revenueCount,
      companiesWithProfit: profitCount,
    };
  }

  /** Full diagnostic stats. */
  diagnostics() {
    return {
      totalRecords: this._records.length,
      duplicatesSkipped: this._dupeCount,
      recordsMerged: this._mergeCount,
      categories: this.categoryCounts(),
      regions: this.regionCounts(),
      states: Object.keys(this.stateCounts()).length,
      cities: this.cities().length,
    };
  }
}
