import { Router } from 'express';
import { prisma } from '../../db';

export const searchRoutes = Router();

// pg_trgm-backed fuzzy name search — same extension the import job's
// dedupe step uses (Phase 3).
searchRoutes.get('/', async (req, res, next) => {
  try {
    const q = String(req.query.q ?? '').trim();
    if (!q) return res.json([]);
    const rows = await prisma.$queryRaw<{ organization_id: string; legal_name: string; score: number }[]>`
      SELECT organization_id, legal_name, similarity(legal_name, ${q}) AS score
      FROM organizations
      WHERE legal_name % ${q}
      ORDER BY score DESC
      LIMIT 25
    `;
    res.json(rows.map((r) => ({ organizationId: r.organization_id, companyName: r.legal_name, score: r.score })));
  } catch (err) {
    next(err);
  }
});
