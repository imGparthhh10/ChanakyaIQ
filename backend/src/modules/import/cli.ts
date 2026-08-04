import { runExcelImport } from './importJob.service';
import { prisma } from '../../db';

runExcelImport()
  .then((summary) => {
    console.log(JSON.stringify(summary, null, 2));
    return prisma.$disconnect();
  })
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[import:excel] failed:', err);
    process.exit(1);
  });
