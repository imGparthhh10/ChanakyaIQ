import { prisma } from '../../db';
import { EnrichmentRepository } from './enrichment.repository';

const repo = new EnrichmentRepository();

export interface ExtractedProfile {
  model: string;
  confidence: number | null;
  data: Record<string, unknown>;
}

/** Real LLM enrichment isn't wired up in this environment (project's own
 *  roadmap lists it as Phase 5/6 "Queued") — isolated behind this interface
 *  so a real implementation is a one-file swap. */
export interface EnrichmentEngine {
  extract(organizationId: string, documentText: string | null): Promise<ExtractedProfile>;
}

export class StubEnrichmentEngine implements EnrichmentEngine {
  async extract(): Promise<ExtractedProfile> {
    return { model: 'stub', confidence: null, data: {} };
  }
}

let engine: EnrichmentEngine = new StubEnrichmentEngine();
export function setEnrichmentEngine(e: EnrichmentEngine) {
  engine = e;
}

export async function runEnrichment(organizationId: string, documentId: string | null) {
  const jobHistory = await prisma.jobHistory.create({
    data: { workerName: 'LLMWorker', organizationId, status: 'STARTED' },
  });

  const job = await repo.createJob(organizationId, documentId);
  await repo.updateJobStatus(job.enrichmentJobId, 'RUNNING');

  try {
    const isStub = engine instanceof StubEnrichmentEngine;
    const profile = await engine.extract(organizationId, null);
    await repo.createLlmProfile(job.enrichmentJobId, organizationId, profile);
    await repo.updateJobStatus(job.enrichmentJobId, isStub ? 'MANUAL_REVIEW' : 'PASSED');

    if (isStub) {
      await prisma.processingLog.create({
        data: { organizationId, stage: 'LLM_EXTRACTION', message: 'No real LLM configured — see PRESENTATION_BRIEF.md Phase 5/6. Placeholder profile only, not a fabricated result.', level: 'WARN' },
      });
    }

    await prisma.jobHistory.update({
      where: { jobHistoryId: jobHistory.jobHistoryId },
      data: { status: 'SUCCESS', finishedAt: new Date(), referenceId: job.enrichmentJobId, detailsJson: { stub: isStub } },
    });

    return { enrichmentJobId: job.enrichmentJobId, status: isStub ? 'MANUAL_REVIEW' : 'PASSED', stub: isStub };
  } catch (err: any) {
    await repo.updateJobStatus(job.enrichmentJobId, 'FAILED', err?.message ?? String(err));
    await prisma.jobHistory.update({
      where: { jobHistoryId: jobHistory.jobHistoryId },
      data: { status: 'FAILED', finishedAt: new Date(), referenceId: job.enrichmentJobId, detailsJson: { error: err?.message ?? String(err) } },
    });
    throw err;
  }
}
