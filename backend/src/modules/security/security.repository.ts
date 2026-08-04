import { prisma } from '../../db';

// Schema-complete per the plan, but every endpoint currently ships
// unauthenticated for local dev (flagged scope decision #4 — no endpoint
// in the required list needs auth). // TODO: auth
export class SecurityRepository {
  findUserByEmail(email: string) {
    return prisma.user.findUnique({ where: { email }, include: { role: true } });
  }

  listRoles() {
    return prisma.role.findMany({ include: { rolePermissions: { include: { permission: true } } } });
  }
}
