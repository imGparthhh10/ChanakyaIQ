import { prisma } from '../../db';
import { CrawlerRepository } from './crawler.repository';

const repo = new CrawlerRepository();

export interface RawDocument {
  storagePath: string;
  url: string | null;
}

/** Camoufox isn't installed in this environment (project's own roadmap
 *  lists it as Phase 5/6 "Queued") — this interface isolates the one
 *  missing piece so a real implementation is a one-file swap, not a
 *  rewrite of the job/status/audit plumbing around it. */
export interface DocumentFetcher {
  fetch(url: string): Promise<RawDocument>;
}

export class StubDocumentFetcher implements DocumentFetcher {
  async fetch(url: string): Promise<RawDocument> {
    return { storagePath: `stub://not-fetched/${encodeURIComponent(url)}`, url };
  }
}

let fetcher: DocumentFetcher = new StubDocumentFetcher();
export function setDocumentFetcher(f: DocumentFetcher) {
  fetcher = f;
}

export async function runCrawl(organizationId: string, url: string) {
  const jobHistory = await prisma.jobHistory.create({
    data: { workerName: 'CrawlerWorker', organizationId, status: 'STARTED' },
  });

  const crawlJob = await repo.createJob(organizationId, null);
  await repo.updateJobStatus(crawlJob.crawlJobId, 'RUNNING');

  try {
    const isStub = fetcher instanceof StubDocumentFetcher;
    const doc = await fetcher.fetch(url);
    await repo.createDocument(organizationId, crawlJob.crawlJobId, doc.storagePath, doc.url);
    await repo.updateJobStatus(crawlJob.crawlJobId, 'SUCCESS');

    if (isStub) {
      await prisma.processingLog.create({
        data: { organizationId, stage: 'DOCUMENT_COLLECTION', message: 'Camoufox not installed — see PRESENTATION_BRIEF.md Phase 5/6. No real document was fetched.', level: 'WARN' },
      });
    }

    await prisma.jobHistory.update({
      where: { jobHistoryId: jobHistory.jobHistoryId },
      data: { status: 'SUCCESS', finishedAt: new Date(), referenceId: crawlJob.crawlJobId, detailsJson: { stub: isStub } },
    });

    return { crawlJobId: crawlJob.crawlJobId, status: 'SUCCESS', stub: isStub };
  } catch (err: any) {
    await repo.updateJobStatus(crawlJob.crawlJobId, 'FAILED', err?.message ?? String(err));
    await prisma.jobHistory.update({
      where: { jobHistoryId: jobHistory.jobHistoryId },
      data: { status: 'FAILED', finishedAt: new Date(), referenceId: crawlJob.crawlJobId, detailsJson: { error: err?.message ?? String(err) } },
    });
    throw err;
  }
}
