import { DocumentType } from '@prisma/client';
import { prisma } from '../../db';

export class CrawlerRepository {
  createJob(organizationId: string, crawlSourceId: string | null) {
    return prisma.crawlJob.create({ data: { organizationId, crawlSourceId, status: 'QUEUED' } });
  }

  updateJobStatus(crawlJobId: string, status: 'RUNNING' | 'SUCCESS' | 'FAILED' | 'RETRY', errorMessage?: string) {
    return prisma.crawlJob.update({
      where: { crawlJobId },
      data: {
        status,
        startedAt: status === 'RUNNING' ? new Date() : undefined,
        finishedAt: status === 'SUCCESS' || status === 'FAILED' ? new Date() : undefined,
        errorMessage,
      },
    });
  }

  createDocument(organizationId: string, crawlJobId: string, storagePath: string, url: string | null) {
    return prisma.document.create({
      data: {
        organizationId,
        crawlJobId,
        documentType: DocumentType.Official_Website,
        url,
        storagePath,
        status: 'DOWNLOADED',
      },
    });
  }
}
