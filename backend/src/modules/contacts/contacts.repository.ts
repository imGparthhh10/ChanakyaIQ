import { prisma } from '../../db';

export class ContactsRepository {
  listLeadershipForOrg(organizationId: string) {
    return prisma.leadership.findMany({ where: { organizationId, isCurrent: true } });
  }

  listContactsForOrg(organizationId: string) {
    return prisma.contact.findMany({ where: { organizationId } });
  }
}
