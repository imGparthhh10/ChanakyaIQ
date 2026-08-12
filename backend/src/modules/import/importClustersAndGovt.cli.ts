// One-shot CLI for the two new master files (Industrial Clusters,
// Government Finance/Budget). Separate from cli.ts/importJob.service.ts
// (the existing BFSI-only generic+Karnataka+Gujarat pipeline) because both
// new files need a non-BFSI sector and File 2 needs its own metric-writing
// step (allocated_budget/it_spend with citation/confidence) that doesn't
// fit the shared FINANCIAL_METRIC_FIELDS loop.
//
// `--dry-run`: parses + maps both files and prints counts only, no DB
// writes at all (not even a JobHistory row). Default: real import, wrapped
// in JobHistory/ErrorLog/ProcessingLog the same way runExcelImport() is,
// so one bad row logs and moves on instead of aborting the batch.
import fs from 'node:fs';
import path from 'node:path';
import { prisma } from '../../db';
import { FinancialsRepository } from '../financials/financials.repository';
import { TechnologyRepository } from '../technology/technology.repository';
import { buildDedupeIndex } from './dedupe';
import { loadIndustrialClusters } from './industrialClusters.node';
import { loadGovtFinance } from './govtFinance.node';
import { resolveState, resolveCity, upsertOrganizationFromRecord } from './mapping';

const DATA_DIR = path.join(__dirname, '../../../../data');
const DRY_RUN = process.argv.includes('--dry-run');

const financials = new FinancialsRepository();
const technology = new TechnologyRepository();

function findFile(pattern: RegExp): string | null {
  const match = fs.readdirSync(DATA_DIR).find((f) => pattern.test(f));
  return match ? path.join(DATA_DIR, match) : null;
}

async function main() {
  const clustersPath = findFile(/master_industrial_clusters.*\.xlsx$/i);
  const govtPath = findFile(/master_govt_finance_database.*\.xlsx$/i);
  if (!clustersPath) throw new Error('No master_industrial_clusters*.xlsx found in data/');
  if (!govtPath) throw new Error('No master_govt_finance_database*.xlsx found in data/');

  const clusters = loadIndustrialClusters(clustersPath);
  const govt = loadGovtFinance(govtPath);

  console.log('[parse] Industrial Clusters:', JSON.stringify(clusters.stats, null, 2));
  console.log('[parse] Govt Finance:', JSON.stringify(govt.stats, null, 2));

  if (DRY_RUN) {
    console.log('[dry-run] no writes performed. Sample cluster record:', clusters.records[0]);
    console.log('[dry-run] sample cluster branch:', clusters.branches[0]);
    console.log('[dry-run] sample govt record:', govt.records.find((r) => r._allocatedBudget != null) ?? govt.records[0]);
    return;
  }

  const job = await prisma.jobHistory.create({ data: { workerName: 'ImportClustersAndGovtWorker', status: 'STARTED' } });
  const summary = {
    clusters: { created: 0, updated: 0, failed: 0, branchesInserted: 0, branchesFailed: 0 },
    govt: { created: 0, updated: 0, failed: 0, metricsWritten: 0 },
  };

  try {
    const index = await buildDedupeIndex();

    // --- File 1: Industrial Clusters (Manufacturing) ---
    for (const rec of clusters.records) {
      const result = await upsertOrganizationFromRecord(rec, index, 'Manufacturing', false);
      if (result.outcome === 'failed') {
        summary.clusters.failed++;
        await prisma.errorLog.create({
          data: { workerName: 'ImportClustersAndGovtWorker', errorType: 'upsert', errorMessage: `${result.companyName}: ${result.error}` },
        });
      } else {
        if (result.outcome === 'created') summary.clusters.created++; else summary.clusters.updated++;
      }
    }

    for (const b of clusters.branches) {
      const orgId = index.byKey.get(b.parentKey);
      if (!orgId) {
        summary.clusters.branchesFailed++;
        continue;
      }
      try {
        const stateId = await resolveState(b.state || null, b.region || null);
        const cityId = await resolveCity(b.city || null, stateId);
        await prisma.branch.create({
          data: { organizationId: orgId, branchName: b.branchName || null, cityId, stateId, branchType: b.branchType || 'Branch' },
        });
        summary.clusters.branchesInserted++;
      } catch (err: any) {
        summary.clusters.branchesFailed++;
        await prisma.errorLog.create({
          data: { workerName: 'ImportClustersAndGovtWorker', errorType: 'branch_insert', errorMessage: `${b.branchName}: ${err?.message ?? err}` },
        });
      }
    }

    // --- File 2: Government Finance ---
    for (const rec of govt.records) {
      const result = await upsertOrganizationFromRecord(rec, index, 'Government', false);
      if (result.outcome === 'failed') {
        summary.govt.failed++;
        await prisma.errorLog.create({
          data: { workerName: 'ImportClustersAndGovtWorker', errorType: 'upsert', errorMessage: `${result.companyName}: ${result.error}` },
        });
        continue;
      }
      if (result.outcome === 'created') summary.govt.created++; else summary.govt.updated++;

      try {
        if (rec._allocatedBudget != null) {
          await financials.upsertMetric(
            result.organizationId!, 'allocated_budget', rec._fiscalYear, rec._allocatedBudget,
            null, rec._confidence, 'Allocated Budget', rec._sourceCitation, rec._sourceUrl,
          );
          summary.govt.metricsWritten++;
        }
        if (rec._itSpend != null) {
          await technology.upsertMetric(
            result.organizationId!, 'it_spend', rec._fiscalYear, rec._itSpend,
            null, rec._confidence, 'IT Spend', rec._sourceCitation, rec._sourceUrl,
          );
          summary.govt.metricsWritten++;
        }
      } catch (err: any) {
        await prisma.errorLog.create({
          data: { workerName: 'ImportClustersAndGovtWorker', errorType: 'metric_write', errorMessage: `${result.companyName}: ${err?.message ?? err}` },
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

  console.log('[import] summary:', JSON.stringify(summary, null, 2));
}

main()
  .then(() => prisma.$disconnect())
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[importClustersAndGovt] failed:', err);
    process.exit(1);
  });
