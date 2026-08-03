/**
 * branches.js — Branch-level data aggregator.
 *
 * Bank workbooks may contain enormous "Branches" sheets — 25,000+
 * rows, one per branch. We do NOT want those bloating the company
 * cache (each bank is one entity, not 5,000 entities). Instead we:
 *
 *   1. Extract branch rows from sheets tagged kind='branches'
 *   2. Aggregate per parent bank name:
 *        - total branch count
 *        - branches per state (map)
 *        - branches per district (top 10)
 *        - branches per city (top 10)
 *        - regions the bank operates in
 *        - IFSC sample (first 5 for reference)
 *   3. Return a `{ bankKey → BranchProfile }` map that data.js
 *      merges onto the matching company record.
 *
 * The dedupeKey convention (lowercase name, alnum-only) is used to
 * match branch rows to their parent bank company record.
 */

// Match the dedupe key logic used by validator.js
function bankKey(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Aggregate branch rows into per-bank profiles AND flatten the raw branch
 * list for map / directory / search consumption.
 *
 * @param {Array<{rows:Array, headers:Array}>} branchSheets — sheets with kind='branches'
 * @returns {{
 *   profiles: Map<string, BranchProfile>,
 *   branches: Array<Branch>,           // flat list — feeds map + company 360 branch tab
 *   totalBranches: number,
 *   statsCoverage: Object,
 * }}
 *
 * Each Branch object:
 *   {
 *     id, parentName, parentKey, branchName, ifsc,
 *     address, city, district, state, region,
 *     hqLocation, website, category, subSector, ownership,
 *     source
 *   }
 */
/**
 * Compute a unique key for a branch. IFSC is the natural primary key
 * (globally unique per RBI). When IFSC is missing, fall back to a
 * composite of parent + branch name + city so we still dedupe.
 */
function branchUniqueKey(parentKey, ifsc, branchName, city) {
  const i = String(ifsc || '').trim().toUpperCase();
  if (i) return 'ifsc:' + i;
  return 'comp:' + parentKey + '|' + String(branchName || '').toLowerCase().trim() + '|' + String(city || '').toLowerCase().trim();
}

/**
 * Merge a duplicate branch row into an existing branch record —
 * fill blanks, never overwrite a non-empty value with an empty one.
 */
function mergeBranch(target, incoming) {
  for (const k of ['branchName', 'address', 'city', 'district', 'state',
                   'region', 'ifsc', 'hqLocation', 'website', 'category',
                   'subSector', 'ownership', 'source']) {
    const tv = target[k];
    const iv = incoming[k];
    // Fill if target empty; prefer longer (more complete) string otherwise
    if ((!tv || tv === '') && iv) target[k] = iv;
    else if (typeof tv === 'string' && typeof iv === 'string' && iv.length > tv.length) target[k] = iv;
  }
}

export function aggregateBranches(branchSheets) {
  const profiles = new Map();
  const branchByKey = new Map();   // uniqueKey → branch record (dedup)
  const statesSeen = new Set();
  const citiesSeen = new Set();
  const districtsSeen = new Set();

  let rowsRead = 0;
  let inserted = 0;
  let merged = 0;
  let skippedNoParent = 0;
  let branchCounter = 0;

  for (const sheet of branchSheets) {
    for (const row of sheet.rows) {
      rowsRead++;
      const parent = row['Parent Bank Name'] || row['Bank Name'] || row['Parent'] || '';
      if (!parent) { skippedNoParent++; continue; }

      const key = bankKey(parent);
      if (!key) { skippedNoParent++; continue; }

      const state    = String(row['State']    || '').trim();
      const district = String(row['District'] || '').trim();
      const city     = String(row['City']     || '').trim();
      const region   = String(row['Region']   || '').trim();
      const ifsc     = String(row['IFSC Code']|| '').trim();
      const branchName = String(row['Branch Name'] || '').trim();
      const address    = String(row['Branch Address'] || '').trim();

      const uk = branchUniqueKey(key, ifsc, branchName, city);

      // ─── UPSERT: dedupe branch by unique key ──────
      if (branchByKey.has(uk)) {
        // Duplicate — merge richer data into the existing record
        mergeBranch(branchByKey.get(uk), {
          branchName: branchName || `${parent} Branch`,
          address, city, district, state, region, ifsc,
          hqLocation: String(row['Headquarters Location (Parent)'] || '').trim(),
          website:    String(row['Official Website (Parent)']      || '').trim(),
          category:   String(row['BFSI Category']       || '').trim(),
          subSector:  String(row['Banking Subsector']   || '').trim(),
          ownership:  String(row['Ownership Type']      || '').trim(),
          source:     String(row['Source']              || '').trim(),
        });
        merged++;
        continue; // do NOT double-count in profile
      }

      // New unique branch — insert
      const branch = {
        id:         `br_${++branchCounter}`,
        uk,
        parentName: parent,
        parentKey:  key,
        branchName: branchName || `${parent} Branch`,
        ifsc,
        address,
        city,
        district,
        state,
        region,
        hqLocation: String(row['Headquarters Location (Parent)'] || '').trim(),
        website:    String(row['Official Website (Parent)']      || '').trim(),
        category:   String(row['BFSI Category']       || '').trim(),
        subSector:  String(row['Banking Subsector']   || '').trim(),
        ownership:  String(row['Ownership Type']      || '').trim(),
        source:     String(row['Source']              || '').trim(),
      };
      branchByKey.set(uk, branch);
      inserted++;

      // ─── Profile (aggregation) — unique branches only ─
      if (!profiles.has(key)) {
        profiles.set(key, {
          parentName: parent,
          total: 0,
          byState: {},
          byDistrict: {},
          byCity: {},
          byRegion: {},
          ifscSample: [],
          categoryHint: row['BFSI Category'] || '',
          subSectorHint: row['Banking Subsector'] || '',
          ownershipHint: row['Ownership Type'] || '',
        });
      }
      const p = profiles.get(key);
      p.total++;

      if (state)    { p.byState[state]       = (p.byState[state]    || 0) + 1; statesSeen.add(state); }
      if (district) { p.byDistrict[district] = (p.byDistrict[district] || 0) + 1; districtsSeen.add(district); }
      if (city)     { p.byCity[city]         = (p.byCity[city]     || 0) + 1; citiesSeen.add(city); }
      if (region)   { p.byRegion[region]     = (p.byRegion[region] || 0) + 1; }
      if (ifsc && p.ifscSample.length < 5) p.ifscSample.push(ifsc);
    }
  }

  const branches = [...branchByKey.values()];

  return {
    profiles,
    branches,
    totalBranches: branches.length,
    importReport: {
      rowsRead,
      uniqueBranches: inserted,
      duplicateBranchesMerged: merged,
      skippedNoParent,
      parentBanksWithBranches: profiles.size,
    },
    statsCoverage: {
      banksWithBranches: profiles.size,
      totalBranches: branches.length,
      distinctStates: statesSeen.size,
      distinctCities: citiesSeen.size,
      distinctDistricts: districtsSeen.size,
    },
  };
}

/**
 * Merge a bank's branch profile onto its company record. Adds:
 *   - branchTotal          (integer, verified branch count)
 *   - branchesByState      (object)
 *   - branchesByRegion     (object)
 *   - topBranchDistricts   (array of [name, count], top 10)
 *   - topBranchCities      (array of [name, count], top 10)
 *   - ifscSample           (array of up to 5 IFSCs)
 *
 * Does NOT overwrite an existing branchCount unless the current value
 * is null/0 — the workbook's declared count is treated as authoritative
 * where present; the aggregated total is stored under branchTotal for
 * cross-validation.
 */
export function attachBranchProfiles(records, profiles) {
  if (!profiles || profiles.size === 0) return { attached: 0, unmatched: 0 };

  let attached = 0;
  const matched = new Set();

  for (const rec of records) {
    const key = rec._dedupeKey || bankKey(rec.companyName);
    if (!key) continue;
    const p = profiles.get(key);
    if (!p) continue;

    matched.add(key);
    attached++;

    rec.branchTotal          = p.total;
    rec.branchesByState      = { ...p.byState };
    rec.branchesByRegion     = { ...p.byRegion };
    rec.topBranchDistricts   = Object.entries(p.byDistrict).sort((a, b) => b[1] - a[1]).slice(0, 10);
    rec.topBranchCities      = Object.entries(p.byCity).sort((a, b) => b[1] - a[1]).slice(0, 10);
    rec.ifscSample           = p.ifscSample.slice();

    // If declared branchCount is missing or clearly stale, fall back to the aggregate total
    if (!rec.branchCount || rec.branchCount === 0) {
      rec.branchCount = p.total;
    }
  }

  return {
    attached,
    unmatched: profiles.size - matched.size,
  };
}
