import bcrypt from 'bcryptjs';
import { prisma } from '../db';
import { env } from '../config/env';

/**
 * Seeds Admin users, run once at server boot (see server.ts).
 * Idempotent via upsert-by-email: update:{} means a repeat run (every
 * `npm run dev` restart) never re-hashes or duplicates the row — it's a
 * true no-op after the first successful run.
 *
 * Never logs the plaintext password. Skips (with a log line, not silently)
 * a given admin slot if its EMAIL/PASSWORD env pair isn't set — no
 * hardcoded fallback credential exists anywhere in this file.
 */
async function seedOneAdmin(label: string, fullName: string, email: string | undefined, password: string | undefined) {
  if (!email || !password) {
    console.log(`[seedAdmin] ${label} EMAIL/PASSWORD not set — skipping.`);
    return;
  }

  const adminRole = await prisma.role.findUnique({ where: { roleName: 'Admin' } });
  if (!adminRole) {
    console.warn('[seedAdmin] No "Admin" role found in roles table — skipping admin seed.');
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);

  await prisma.user.upsert({
    where: { email },
    update: {}, // already exists — never re-touch on subsequent boots
    create: {
      fullName,
      email,
      passwordHash,
      roleId: adminRole.roleId,
    },
  });

  console.log(`[seedAdmin] Admin user ready: ${email}`);
}

export async function seedAdminUser() {
  await seedOneAdmin('SEED_ADMIN', 'Parth Ghongane', env.SEED_ADMIN_EMAIL, env.SEED_ADMIN_PASSWORD);
  await seedOneAdmin(
    'SEED_ADMIN2',
    env.SEED_ADMIN2_FULLNAME || 'Garima Nahata',
    env.SEED_ADMIN2_EMAIL,
    env.SEED_ADMIN2_PASSWORD,
  );
}
