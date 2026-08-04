import { Router } from 'express';
import { z } from 'zod';
import { runEnrichment } from './enrichment.service';

export const enrichmentRoutes = Router();

const BodySchema = z.object({ organizationId: z.string().uuid(), documentId: z.string().uuid().optional() });

enrichmentRoutes.post('/', async (req, res, next) => {
  try {
    const { organizationId, documentId } = BodySchema.parse(req.body);
    const result = await runEnrichment(organizationId, documentId ?? null);
    res.json(result);
  } catch (err) {
    next(err);
  }
});
