import path from 'node:path';
import { prisma } from '../../db';
// Reused unmodified from the frontend — pure functions, zero browser deps.
// @ts-ignore
import { parseAllSheets } from '../../../../assets/js/data/parser.js';
// @ts-ignore
import { validateRecords } from '../../../../assets/js/data/validator.js';
// @ts-ignore
import { aggregateBranches } from '../../../../assets/js/data/branches.js';

import { readWorkbook } from './excelReader';
import { loadKarnataka } from './karnataka.node';
import { loadGujarat } from './gujarat.node';
import { buildDedupeIndex } from './dedupe';
import { upsertOrganizationFromRecord, resolveState, resolveCity } from './mapping';

const DATA_DIR = path.join(__dirname, '../../../../data');

const GENERIC_FILES = [
  'BFSI_Master_Database.xlsx',
  'ESDS_BFSI_MASTER_ALL_CATEGORIES_v3.xlsx',
  'ESDS_Banking_Master_Database.xlsx',
];

export interface ImportSummary {
  rowsRead: number;
  created: number;
  updated: number;
  failed: number;
  invalidSkipped: number;
  branchesInserted: number;
  branchesFailed: number;
  failures: { companyName: string; error: string }[];
}

export async function runExcelImport(): Promise<ImportSummary> {
  const job = await prisma.jobHistory.create({
    data: { workerName: 'ImportWorker', status: 'STARTED' },
  });

  const summary: ImportSummary = {
    rowsRead: 0, created: 0, updated: 0, failed: 0,
    invalidSkipped: 0, branchesInserted: 0, branchesFailed: 0, failures: [],
  };

  try {
    // 1. Generic files -> parser.js/validator.js/branches.js (unmodified)
    let rawSheets: any[] = [];
    for (const fileName of GENERIC_FILES) {
      rawSheets.push(...readWorkbook(path.join(DATA_DIR, fileName), fileName));
    }
    const entitySheets = rawSheets.filter((s) => s.kind !== 'branches');
    const branchSheets = rawSheets.filter((s) => s.kind === 'branches');

    const { records: parsed } = parseAllSheets(entitySheets);
    const { valid, invalid } = validateRecords(parsed);
    summary.invalidSkipped = invalid.length;

    for (const bad of invalid as any[]) {
      await prisma.errorLog.create({
        data: {
          workerName: 'ImportWorker',
          errorType: 'validation',
          errorMessage: `Row rejected: ${(bad._errors ?? []).join(', ')} (companyName="${bad.companyName ?? ''}")`,
        },
      });
    }

    const branchAgg = branchSheets.length > 0
      ? aggregateBranches(branchSheets)
      : { branches: [] as any[] };

    // 2. Karnataka + Gujarat dedicated loaders
    const kar = loadKarnataka(path.join(DATA_DIR, 'MASTER_DATABASE_KARNATAKA.xlsx'));
    const guj = loadGujarat(path.join(DATA_DIR, 'MASTER_DATABASE_GUJARAT.xlsx'));

    const allRecords = [...valid, ...kar.records, ...guj.records];
    const allBranches = [...branchAgg.branches, ...kar.branches, ...guj.branches];

    // 3. Upsert organizations
    const index = await buildDedupeIndex();
    for (const rec of allRecords) {
      summary.rowsRead++;
      const result = await upsertOrganizationFromRecord(rec, index);
      if (result.outcome === 'failed') {
        summary.failed++;
        summary.failures.push({ companyName: result.companyName, error: result.error ?? 'unknown error' });
        await prisma.errorLog.create({
          data: { workerName: 'ImportWorker', errorType: 'upsert', errorMessage: `${result.companyName}: ${result.error}` },
        });
      } else {
        if (result.outcome === 'created') summary.created++; else summary.updated++;
        await prisma.processingLog.create({
          data: {
            organizationId: result.organizationId,
            stage: 'IMPORT',
            message: `${result.outcome}: ${result.companyName}`,
          },
        });
      }
    }

    // 4. Insert branches (per-branch rows; parentKey resolved via the
    // dedupe index built up during step 3)
    for (const b of allBranches) {
      const orgId = index.byKey.get(b.parentKey);
      if (!orgId) {
        summary.branchesFailed++;
        await prisma.errorLog.create({
          data: { workerName: 'ImportWorker', errorType: 'branch_no_parent', errorMessage: `Branch "${b.branchName}" has no matching parent org for key ${b.parentKey}` },
        });
        continue;
      }
      try {
        const stateId = await resolveState(b.state || null, b.region || null);
        const cityId = await resolveCity(b.city || null, stateId);
        await prisma.branch.create({
          data: { organizationId: orgId, branchName: b.branchName || null, cityId, stateId, branchType: 'Branch' },
        });
        summary.branchesInserted++;
      } catch (err: any) {
        summary.branchesFailed++;
        await prisma.errorLog.create({
          data: { workerName: 'ImportWorker', errorType: 'branch_insert', errorMessage: `${b.branchName}: ${err?.message ?? err}` },
        });
      }
    }

    await prisma.jobHistory.update({
      where: { jobHistoryId: job.jobHistoryId },
      data: { status: 'SUCCESS', finishedAt: new Date(), detailsJson: summary as any },
    });
  } catch (err: any) {
    await prisma.jobHistory.update({
      where: { jobHistoryId: job.jobHistoryId },
      data: { status: 'FAILED', finishedAt: new Date(), detailsJson: { error: err?.message ?? String(err), ...summary } as any },
    });
    throw err;
  }

  return summary;
}
