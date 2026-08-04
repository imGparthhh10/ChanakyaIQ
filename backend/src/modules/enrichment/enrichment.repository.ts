import { prisma } from '../../db';

export class EnrichmentRepository {
  createJob(organizationId: string, documentId: string | null) {
    return prisma.enrichmentJob.create({ data: { organizationId, documentId, status: 'PENDING' } });
  }

  updateJobStatus(enrichmentJobId: string, status: 'RUNNING' | 'PASSED' | 'FAILED' | 'MANUAL_REVIEW', errorMessage?: string) {
    return prisma.enrichmentJob.update({
      where: { enrichmentJobId },
      data: {
        status,
        startedAt: status === 'RUNNING' ? new Date() : undefined,
        finishedAt: status === 'PASSED' || status === 'FAILED' ? new Date() : undefined,
        errorMessage,
      },
    });
  }

  createLlmProfile(enrichmentJobId: string, organizationId: string, profileJson: unknown) {
    return prisma.llmProfile.create({ data: { enrichmentJobId, organizationId, profileJson: profileJson as any } });
  }
}
