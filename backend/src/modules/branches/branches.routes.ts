import { Router } from 'express';
import { normalizeForDedup } from '../../utils/dedupeKey';
import { BranchesRepository } from './branches.repository';

const repo = new BranchesRepository();
export const branchesRoutes = Router();

// Bulk, unpaginated — dataEngine.branches / branchesFor(parentKey) need one
// flat array at boot, not per-org calls (added to the endpoint list, see
// plan's flagged scope decision #1).
//
// NOTE: eip_schema.sql's `branches` table is leaner than the old branches.js
// aggregator's output — no IFSC code and no per-district rollups exist in
// this schema (branch_id, organization_id, branch_name, city_id, state_id,
// branch_type only). ifscSample/topBranchDistricts fields from the legacy
// shape are therefore omitted here, not silently faked.
branchesRoutes.get('/', async (_req, res, next) => {
  try {
    const branches = await repo.findAll();
    res.json(
      branches.map((b) => ({
        id: b.branchId,
        parentKey: normalizeForDedup(b.organization.legalName),
        organizationId: b.organizationId,
        branchName: b.branchName,
        city: b.city?.cityName ?? null,
        state: b.state?.stateName ?? null,
        region: b.state?.region ?? null,
        branchType: b.branchType,
      })),
    );
  } catch (err) {
    next(err);
  }
});
