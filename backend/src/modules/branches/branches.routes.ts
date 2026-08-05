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

    // normalizeForDedup() runs multiple regex passes — with 3,120 branches
    // but only ~39 distinct parent orgs, computing it per-branch redoes the
    // same work ~80x on average. Memoize per legalName instead (found via
    // profiling: this endpoint was 220-440ms vs. 30ms for the equivalent
    // raw SQL join).
    const dedupeKeyCache = new Map<string, string>();
    const dedupeKeyFor = (legalName: string) => {
      let key = dedupeKeyCache.get(legalName);
      if (key === undefined) {
        key = normalizeForDedup(legalName);
        dedupeKeyCache.set(legalName, key);
      }
      return key;
    };

    res.json(
      branches.map((b) => ({
        id: b.branchId,
        parentKey: dedupeKeyFor(b.organization.legalName),
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
