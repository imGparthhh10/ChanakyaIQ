import { Router } from 'express';
import { FinancialsRepository } from './financials.repository';

const repo = new FinancialsRepository();
export const financialsRoutes = Router();

financialsRoutes.get('/:id/financials', async (req, res, next) => {
  try {
    const rows = await repo.listForOrg(req.params.id);
    res.json(
      rows.map((r) => ({
        metricKey: r.metricDefinition.metricKey,
        displayName: r.metricDefinition.displayName,
        unit: r.metricDefinition.unit,
        fiscalYear: r.fiscalYear,
        value: Number(r.value),
        confidence: r.confidence != null ? Number(r.confidence) : null,
      })),
    );
  } catch (err) {
    next(err);
  }
});
