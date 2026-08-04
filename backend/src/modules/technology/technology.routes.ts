import { Router } from 'express';
import { TechnologyRepository } from './technology.repository';

const repo = new TechnologyRepository();
export const technologyRoutes = Router();

technologyRoutes.get('/:id/technology', async (req, res, next) => {
  try {
    const [metrics, profiles] = await Promise.all([
      repo.listMetricsForOrg(req.params.id),
      repo.listProfilesForOrg(req.params.id),
    ]);
    res.json({
      metrics: metrics.map((r) => ({
        metricKey: r.metricDefinition.metricKey,
        displayName: r.metricDefinition.displayName,
        unit: r.metricDefinition.unit,
        fiscalYear: r.fiscalYear,
        value: Number(r.value),
        confidence: r.confidence != null ? Number(r.confidence) : null,
      })),
      profiles: profiles.map((p) => ({ category: p.category, value: p.valueText })),
    });
  } catch (err) {
    next(err);
  }
});
