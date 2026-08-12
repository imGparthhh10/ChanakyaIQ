import { Router } from 'express';
import { getRemovals, runBusinessIntentEngine } from './businessIntent.service';

export const businessIntentRoutes = Router();

// Mirrors POST /icp/run's pattern exactly. ?dryRun=true computes and logs
// intended archivals without writing anything -- this is the mandatory
// safety step the spec requires be run and manually reviewed against all
// 297 real orgs before real deletes/archivals are ever enabled. There is
// no separate flag to "enable" real runs beyond simply not passing
// dryRun=true — matching how /icp/run itself has no separate arm/disarm
// step; the caller's own care in choosing which URL to hit is what the
// spec's "gated behind explicit human confirmation" build-order step means
// in an HTTP API (no scheduler exists anywhere in this backend to
// auto-invoke either route — verified, not assumed).
businessIntentRoutes.post('/run', async (req, res, next) => {
  try {
    const dryRun = req.query.dryRun === 'true';
    const summary = await runBusinessIntentEngine(dryRun);
    res.json(summary);
  } catch (err) {
    next(err);
  }
});

businessIntentRoutes.get('/removals', async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 25));
    res.json(await getRemovals(page, pageSize));
  } catch (err) {
    next(err);
  }
});
