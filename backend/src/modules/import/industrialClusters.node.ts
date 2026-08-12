// Loads data/master_industrial_clusters *.xlsx (State/Region, Cluster,
// Subsector, Company name, Notes, Revenue, IT Spend, Sources). 93 companies
// repeat across 2-6 state/cluster rows each (e.g. Tata Motors x6) with an
// identical Revenue figure on every repeat (verified against the real
// file) -- confirming Revenue is a company-wide total, not per-location.
// So: one Organization per unique company (dedupe key = normalized name),
// and EVERY row (including the first) becomes a Branch carrying that row's
// State + Cluster + Subsector, matching the existing Karnataka/Gujarat
// loader shape rather than creating a duplicate org per row.
import { normalizeForDedup } from '../../utils/dedupeKey';
import { readWorkbook } from './excelReader';
import { cleanCell, normalizeStateName } from './textNormalize';

function parseRevenueCr(raw: string): number | null {
  const s = cleanCell(raw);
  if (!s) return null;
  const m = s.replace(/,/g, '').match(/(\d+(\.\d+)?)\s*cr/i);
  return m ? parseFloat(m[1]) : null;
}

interface ClusterRow {
  state: string;
  cluster: string;
  subsector: string;
  companyName: string;
  notes: string;
  revenueCr: number | null;
}

function parseRows(filePath: string): ClusterRow[] {
  const [sheet] = readWorkbook(filePath, filePath);
  if (!sheet) return [];
  const out: ClusterRow[] = [];
  for (const row of sheet.rows) {
    const companyName = cleanCell(row['Company name']);
    if (!companyName) continue;
    out.push({
      state: normalizeStateName(row['State/Region']),
      cluster: cleanCell(row['Cluster']),
      subsector: cleanCell(row['Subsector']),
      companyName,
      notes: cleanCell(row['Notes']),
      revenueCr: parseRevenueCr(row['Revenue']),
    });
  }
  return out;
}

export function loadIndustrialClusters(filePath: string) {
  const rows = parseRows(filePath);

  const byKey = new Map<string, ClusterRow[]>();
  for (const row of rows) {
    const key = normalizeForDedup(row.companyName);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key)!.push(row);
  }

  const records: any[] = [];
  const branches: any[] = [];

  for (const [key, group] of byKey) {
    const first = group[0];
    const revenueRow = group.find((r) => r.revenueCr != null);
    const noteRow = group.find((r) => r.notes);

    const rec: any = {
      companyName: first.companyName,
      subSector: first.subsector || null,
      state: first.state || null,
      region: null,
      revenue: revenueRow ? revenueRow.revenueCr : null,
      profileSummary: noteRow ? noteRow.notes : null,
      listedStatus: 'Unlisted',
      _source: 'master_industrial_clusters.xlsx',
    };
    rec._dedupeKey = key;
    records.push(rec);

    group.forEach((row, i) => {
      branches.push({
        id: `iccl_${key}_${i}`,
        parentKey: key,
        branchName: row.cluster ? `${row.cluster} (${row.subsector || 'Cluster'})` : row.subsector || 'Manufacturing Cluster',
        state: row.state || null,
        region: null,
        city: null,
        branchType: 'Manufacturing Cluster',
      });
    });
  }

  return {
    records,
    branches,
    stats: {
      rowsRead: rows.length,
      uniqueCompanies: records.length,
      companiesWithRevenue: records.filter((r) => r.revenue != null).length,
      branchesTotal: branches.length,
    },
  };
}
