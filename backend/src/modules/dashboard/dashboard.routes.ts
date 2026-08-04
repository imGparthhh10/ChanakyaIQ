import { Router } from 'express';
import { DashboardRepository } from './dashboard.repository';

const repo = new DashboardRepository();
export const dashboardRoutes = Router();

dashboardRoutes.get('/', async (_req, res, next) => {
  try {
    const [totalOrganizations, totalRevenue, byCategory, funnel] = await Promise.all([
      repo.totalOrganizations(),
      repo.totalRevenue(),
      repo.totalsByCategory(),
      repo.pipelineFunnel(),
    ]);
    res.json({
      totalOrganizations,
      totalRevenueCr: totalRevenue,
      byCategory,
      pipelineFunnel: funnel.map((f) => ({ status: f.status, count: Number(f.org_count) })),
    });
  } catch (err) {
    next(err);
  }
});
