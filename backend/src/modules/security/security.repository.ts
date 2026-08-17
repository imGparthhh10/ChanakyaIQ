import { prisma } from '../../db';

// Real auth is wired in now (auth.routes.ts + middleware/auth.ts) — the
// // TODO: auth marker this file used to carry is resolved.
export class SecurityRepository {
  findUserByEmail(email: string) {
    return prisma.user.findUnique({ where: { email }, include: { role: true } });
  }

  createUser(fullName: string, email: string, passwordHash: string, roleId: number) {
    return prisma.user.create({ data: { fullName, email, passwordHash, roleId } });
  }

  listRoles() {
    return prisma.role.findMany({ include: { rolePermissions: { include: { permission: true } } } });
  }

  createSession(userId: string, jwtId: string, expiresAt: Date, ipAddress: string | null) {
    return prisma.session.create({
      data: { userId, jwtId, expiresAt, ipAddress: ipAddress ?? undefined },
    });
  }

  /** revoked=false AND not expired — the allowlist check requireAuth runs on every protected request. */
  findValidSession(jwtId: string) {
    return prisma.session.findFirst({
      where: { jwtId, revoked: false, expiresAt: { gt: new Date() } },
      include: { user: { include: { role: true } } },
    });
  }

  revokeSession(jwtId: string) {
    return prisma.session.updateMany({
      where: { jwtId },
      data: { revoked: true },
    });
  }
}
