import { Router } from 'express';
import { ApiError } from '../../middleware/errorHandler';
import { OrganizationsRepository } from './organizations.repository';
import { mapOrganization } from './organizations.mapper';
import { getOrgIcp } from '../icp/icp.routes';

const repo = new OrganizationsRepository();
export const organizationsRoutes = Router();

// Full, unpaginated result set by default — matches today's "load everything
// once, filter client-side" behavior that DataCache.load() depends on.
// Optional page/pageSize accepted for future use but not required.
organizationsRoutes.get('/', async (_req, res, next) => {
  try {
    const orgs = await repo.findAll();
    res.json(orgs.map(mapOrganization));
  } catch (err) {
    next(err);
  }
});

organizationsRoutes.get('/:id', async (req, res, next) => {
  try {
    const org = await repo.findById(req.params.id);
    if (!org) throw new ApiError(404, `Organization not found: ${req.params.id}`);
    res.json(mapOrganization(org));
  } catch (err) {
    next(err);
  }
});

organizationsRoutes.get('/:id/profile', async (req, res, next) => {
  try {
    const org = await repo.findById(req.params.id);
    if (!org) throw new ApiError(404, `Organization not found: ${req.params.id}`);
    res.json(mapOrganization(org));
  } catch (err) {
    next(err);
  }
});

organizationsRoutes.get('/:id/icp', async (req, res, next) => {
  try {
    res.json(await getOrgIcp(req.params.id));
  } catch (err) {
    next(err);
  }
});
