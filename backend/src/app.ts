import cors from 'cors';
import express from 'express';
import { env } from './config/env';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { requestLogger } from './middleware/requestLogger';
import { requireAuth } from './middleware/auth';
import { authRoutes } from './modules/auth/auth.routes';
import { organizationsRoutes } from './modules/organizations/organizations.routes';
import { branchesRoutes } from './modules/branches/branches.routes';
import { financialsRoutes } from './modules/financials/financials.routes';
import { technologyRoutes } from './modules/technology/technology.routes';
import { dashboardRoutes } from './modules/dashboard/dashboard.routes';
import { searchRoutes } from './modules/search/search.routes';
import { importRoutes } from './modules/import/import.routes';
import { crawlerRoutes } from './modules/crawler/crawler.routes';
import { enrichmentRoutes } from './modules/enrichment/enrichment.routes';
import { icpRoutes } from './modules/icp/icp.routes';
import { businessIntentRoutes } from './modules/businessIntent/businessIntent.routes';

export function createApp() {
  const app = express();

  app.use(cors({ origin: env.corsOrigins }));
  app.use(express.json());
  app.use(requestLogger);

  const api = express.Router();
  api.get('/health', (_req, res) => res.json({ ok: true }));

  // /auth/login is public; /auth/logout and /auth/me self-apply requireAuth
  // (see auth.routes.ts). Everything registered after the api.use(requireAuth)
  // line below requires a valid, non-revoked session.
  api.use('/auth', authRoutes);
  api.use(requireAuth);

  api.use('/organizations', organizationsRoutes); // includes /:id/icp
  api.use('/organizations', financialsRoutes); // mounts /:id/financials
  api.use('/organizations', technologyRoutes); // mounts /:id/technology
  api.use('/branches', branchesRoutes);
  api.use('/dashboard', dashboardRoutes);
  api.use('/search', searchRoutes);
  api.use('/import', importRoutes);
  api.use('/crawl', crawlerRoutes);
  api.use('/enrich', enrichmentRoutes);
  api.use('/icp', icpRoutes); // POST /icp/run only
  api.use('/business-intent', businessIntentRoutes); // POST /run, POST /run?dryRun=true, GET /removals

  app.use('/api', api);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
