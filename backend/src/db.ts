import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();

async function shutdown() {
  await prisma.$disconnect();
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
process.once('beforeExit', shutdown);
