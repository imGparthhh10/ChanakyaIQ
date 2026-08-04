import { prisma } from '../../db';

export class DocumentsRepository {
  listForOrg(organizationId: string) {
    return prisma.document.findMany({ where: { organizationId }, orderBy: { downloadedAt: 'desc' } });
  }

  create(data: Parameters<typeof prisma.document.create>[0]['data']) {
    return prisma.document.create({ data });
  }
}
