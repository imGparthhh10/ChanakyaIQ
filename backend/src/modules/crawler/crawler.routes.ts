import { Router } from 'express';
import { z } from 'zod';
import { runCrawl } from './crawler.service';

export const crawlerRoutes = Router();

const BodySchema = z.object({ organizationId: z.string().uuid(), url: z.string().url() });

crawlerRoutes.post('/', async (req, res, next) => {
  try {
    const { organizationId, url } = BodySchema.parse(req.body);
    const result = await runCrawl(organizationId, url);
    res.json(result);
  } catch (err) {
    next(err);
  }
});
