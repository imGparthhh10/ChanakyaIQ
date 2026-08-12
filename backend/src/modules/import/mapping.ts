import { OwnershipType } from '@prisma/client';
import { prisma } from '../../db';
import { FinancialsRepository } from '../financials/financials.repository';
import { TechnologyRepository } from '../technology/technology.repository';
import {
  FINANCIAL_METRIC_FIELDS,
  TECHNOLOGY_METRIC_FIELDS,
  TECHNOLOGY_PROFILE_FIELDS,
  METRIC_DISPLAY_NAMES,
} from '../../utils/metricFieldMap';
import { findExistingOrgId, type DedupeIndex } from './dedupe';
import { normalizeForDedup } from '../../utils/dedupeKey';

const financials = new FinancialsRepository();
const technology = new TechnologyRepository();

const stateCache = new Map<string, number>();
const cityCache = new Map<string, number>();
const subsectorCache = new Map<string, number>();
const sectorIdCache = new Map<string, number>();

async function getSectorId(sectorName: string): Promise<number> {
  const cached = sectorIdCache.get(sectorName);
  if (cached != null) return cached;
  const s = await prisma.sector.findUnique({ where: { sectorName } });
  if (!s) throw new Error(`Sector "${sectorName}" missing from seed data`);
  sectorIdCache.set(sectorName, s.sectorId);
  return s.sectorId;
}

/** Back-compat name for the BFSI-only callers below. */
async function getBfsiSectorId(): Promise<number> {
  return getSectorId('BFSI');
}

export async function resolveState(stateName: string | null | undefined, region: string | null | undefined): Promise<number | null> {
  if (!stateName) return null;
  if (stateCache.has(stateName)) return stateCache.get(stateName)!;
  const existing = await prisma.state.findUnique({ where: { stateName } });
  const state = existing ?? (await prisma.state.create({ data: { stateName, region: region || null } }));
  stateCache.set(stateName, state.stateId);
  return state.stateId;
}

export async function resolveCity(cityName: string | null | undefined, stateId: number | null): Promise<number | null> {
  if (!cityName || !stateId) return null;
  const cacheKey = `${stateId}:${cityName}`;
  if (cityCache.has(cacheKey)) return cityCache.get(cacheKey)!;
  const existing = await prisma.city.findUnique({ where: { cityName_stateId: { cityName, stateId } } });
  const city = existing ?? (await prisma.city.create({ data: { cityName, stateId } }));
  cityCache.set(cacheKey, city.cityId);
  return city.cityId;
}

/** Lookup-or-create against subsectors — the taxonomy is auto-extended per
 *  the plan's instruction ("sector_id/subsector_id via lookup-or-create"),
 *  not restricted to the 11 rows eip_schema.sql happens to pre-seed. */
async function resolveSubsector(categoryName: string | null | undefined, sectorId: number): Promise<number | null> {
  if (!categoryName) return null;
  const cacheKey = `${sectorId}:${categoryName}`;
  if (subsectorCache.has(cacheKey)) return subsectorCache.get(cacheKey)!;
  const existing = await prisma.subsector.findFirst({ where: { sectorId, subsectorName: categoryName } });
  const sub = existing ?? (await prisma.subsector.create({ data: { sectorId, subsectorName: categoryName } }));
  subsectorCache.set(cacheKey, sub.subsectorId);
  return sub.subsectorId;
}

function mapOwnership(rec: any): OwnershipType | null {
  const raw = (rec.ownership || '').toLowerCase();
  if (raw.includes('govern') || raw.includes('psu') || raw.includes('public sector')) return 'Government';
  if (raw.includes('coop') || raw.includes('co-op')) return 'Cooperative';
  if (raw.includes('foreign')) return 'Foreign';
  if (raw.includes('private')) return 'Private';
  if (rec.listedStatus === 'Listed') return OwnershipType.Public_Listed;
  if (rec.category && /cooperative|co-operative/i.test(rec.category)) return 'Cooperative';
  return null;
}

export interface ImportRowResult {
  outcome: 'created' | 'updated' | 'failed';
  organizationId?: string;
  companyName: string;
  error?: string;
}

/** Maps + upserts one canonical record (from parser.js/validator.js output,
 *  or the Karnataka/Gujarat/Industrial Clusters/Govt Finance loaders) into
 *  the full set of Postgres tables. `sectorName` defaults to 'BFSI' so
 *  every pre-existing caller (generic files, Karnataka, Gujarat) keeps its
 *  original behavior unchanged. */
export async function upsertOrganizationFromRecord(rec: any, index: DedupeIndex, sectorName = 'BFSI', allowFuzzy = true): Promise<ImportRowResult> {
  const companyName: string = rec.companyName;
  try {
    const existingId = await findExistingOrgId(index, companyName, rec.state || null, allowFuzzy);
    const sectorId = await getSectorId(sectorName);
    const subsectorId = await resolveSubsector(rec.category || rec.subSector || null, sectorId);
    const stateId = await resolveState(rec.state || null, rec.region || null);
    const cityId = await resolveCity(rec.hqCity || null, stateId);
    const ownershipType = mapOwnership(rec);

    const orgData = {
      legalName: companyName,
      sectorId,
      subsectorId,
      ownershipType,
      incorporationYear: rec.yearFounded ?? null,
      cinNumber: rec.cin || null,
      domain: rec.website || null,
      status: 'ACTIVE' as const,
      sourceOfEntry: 'Excel Import',
    };

    let organizationId: string;
    let outcome: 'created' | 'updated';
    if (existingId) {
      await prisma.organization.update({ where: { organizationId: existingId }, data: orgData });
      organizationId = existingId;
      outcome = 'updated';
    } else {
      const created = await prisma.organization.create({ data: orgData });
      organizationId = created.organizationId;
      outcome = 'created';
      index.byKey.set(normalizeForDedup(companyName), organizationId);
    }

    // HQ address
    if (stateId || cityId) {
      const existingAddr = await prisma.address.findFirst({ where: { organizationId, isHeadquarters: true } });
      if (existingAddr) {
        await prisma.address.update({ where: { addressId: existingAddr.addressId }, data: { cityId, stateId, addressLine: rec.hqAddress || undefined } });
      } else {
        await prisma.address.create({ data: { organizationId, cityId, stateId, isHeadquarters: true, addressLine: rec.hqAddress || null } });
      }
    }

    // Leadership — one row per role in `leadership` (source-of-truth, per
    // the plan's instruction), plus a denormalized snapshot in
    // `leadership_profiles` (the schema's own "fast dashboard read" table,
    // which organizations.mapper.ts reads from).
    const roles: [string, string | undefined][] = [
      ['CEO', rec.ceo], ['CTO', rec.cto], ['CIO', rec.cio], ['Chairman', rec.chairman],
    ];
    for (const [designation, personName] of roles) {
      if (!personName) continue;
      const existingLeader = await prisma.leadership.findFirst({ where: { organizationId, designation, isCurrent: true } });
      if (existingLeader) {
        if (existingLeader.personName !== personName) {
          await prisma.leadership.update({ where: { leadershipId: existingLeader.leadershipId }, data: { personName } });
        }
      } else {
        await prisma.leadership.create({ data: { organizationId, designation, personName, isCurrent: true } });
      }
    }
    if (rec.ceo || rec.cto || rec.cio || rec.chairman) {
      await prisma.leadershipProfile.upsert({
        where: { organizationId },
        create: {
          organizationId,
          ceoName: rec.ceo || null,
          ctoName: rec.cto || null,
          cioName: rec.cio || null,
          chairmanName: rec.chairman || null,
        },
        update: {
          ceoName: rec.ceo || undefined,
          ctoName: rec.cto || undefined,
          cioName: rec.cio || undefined,
          chairmanName: rec.chairman || undefined,
        },
      });
    }

    // Financial metrics — fiscal_year left NULL uniformly (see backend/README.md
    // "Known field gaps": parser.js's canonical output discards the source
    // header text, e.g. "Revenue / Total Income (FY26)", before this stage
    // ever sees it, so the FY tag isn't recoverable here without a deeper
    // change to parser.js than the additive `export` already made).
    for (const [field, metricKey] of Object.entries(FINANCIAL_METRIC_FIELDS)) {
      const value = rec[field];
      if (value == null || Number.isNaN(value)) continue;
      await financials.upsertMetric(organizationId, metricKey, null, Number(value), null, null, METRIC_DISPLAY_NAMES[metricKey] ?? metricKey);
    }
    for (const [field, metricKey] of Object.entries(TECHNOLOGY_METRIC_FIELDS)) {
      const value = rec[field];
      if (value == null || Number.isNaN(value)) continue;
      await technology.upsertMetric(organizationId, metricKey, null, Number(value), null, null, METRIC_DISPLAY_NAMES[metricKey] ?? metricKey);
    }
    for (const [field, category] of Object.entries(TECHNOLOGY_PROFILE_FIELDS)) {
      const value = rec[field];
      if (!value) continue;
      await technology.upsertProfile(organizationId, category, String(value));
    }

    // Free-text context that doesn't have a structured column of its own
    // (cluster Notes, Parent Ministry/Department Type) -- organization_profiles.summary,
    // per the plan's "propose where these actually belong" instruction.
    if (rec.profileSummary) {
      await prisma.organizationProfile.upsert({
        where: { organizationId },
        create: { organizationId, summary: rec.profileSummary },
        update: { summary: rec.profileSummary },
      });
    }

    return { outcome, organizationId, companyName };
  } catch (err: any) {
    return { outcome: 'failed', companyName, error: err?.message ?? String(err) };
  }
}
