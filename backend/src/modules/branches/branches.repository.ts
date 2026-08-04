import { prisma } from '../../db';

export class BranchesRepository {
  async findAll() {
    return prisma.branch.findMany({
      include: {
        organization: { select: { legalName: true } },
        city: true,
        state: true,
      },
      orderBy: { branchName: 'asc' },
    });
  }
}
