import { normalizeForDedup } from '../../utils/dedupeKey';
import {
  FINANCIAL_METRIC_FIELDS,
  TECHNOLOGY_METRIC_FIELDS,
  TECHNOLOGY_PROFILE_FIELDS,
} from '../../utils/metricFieldMap';

// Reverse lookups: metric_key -> canonical field name.
const FIN_KEY_TO_FIELD = Object.fromEntries(Object.entries(FINANCIAL_METRIC_FIELDS).map(([f, k]) => [k, f]));
const TECH_KEY_TO_FIELD = Object.fromEntries(Object.entries(TECHNOLOGY_METRIC_FIELDS).map(([f, k]) => [k, f]));
const PROFILE_CATEGORY_TO_FIELD = Object.fromEntries(
  Object.entries(TECHNOLOGY_PROFILE_FIELDS).map(([f, cat]) => [cat, f]),
);

/**
 * Maps a Prisma organization (with its includes) into the exact canonical
 * record shape assets/js/data/parser.js + validator.js produce today, so
 * the Phase 4 frontend swap only changes *where* data comes from.
 *
 * Fields with no home in eip_schema.sql (painPoints, techStack, notes,
 * corePlatform, esdsFitNotes, verificationSources, recommendedProducts,
 * businessJustification, regulatoryNotes, customerBase, stockSymbol,
 * parentCompany, marketCapDate, sourceAsOfDate, countryOfOrigin,
 * formOfPresence) are surfaced as null — flagged here, not silently
 * dropped. See backend/README.md "Known field gaps".
 */
export function mapOrganization(org: any) {
  const hq = (org.addresses ?? []).find((a: any) => a.isHeadquarters) ?? org.addresses?.[0] ?? null;

  const financials: Record<string, number | null> = {};
  for (const fm of org.financialMetrics ?? []) {
    const field = FIN_KEY_TO_FIELD[fm.metricDefinition.metricKey];
    if (field) financials[field] = Number(fm.value);
  }
  const technology: Record<string, number | null> = {};
  for (const tm of org.technologyMetrics ?? []) {
    const field = TECH_KEY_TO_FIELD[tm.metricDefinition.metricKey];
    if (field) technology[field] = Number(tm.value);
  }
  const profiles: Record<string, string | null> = {};
  for (const tp of org.technologyProfiles ?? []) {
    const field = PROFILE_CATEGORY_TO_FIELD[tp.category];
    if (field) profiles[field] = tp.valueText;
  }

  return {
    // Identity
    companyName: org.legalName,
    parentCompany: null,
    category: org.subsector?.subsectorName ?? org.sector?.sectorName ?? null,
    subSector: org.subsector?.subsectorName ?? null,
    // Distinct from `category` (which falls back to subsector) — Stage 8's
    // own sector-level filter. Real and generic, but a structural no-op
    // today: all 297 imported orgs are sector_id=1 (BFSI).
    sector: org.sector?.sectorName ?? null,
    ownership: org.ownershipType ? String(org.ownershipType).replace(/_/g, ' ') : null,
    // 3-state, not a binary guess: ownership_type's own taxonomy treats
    // "Public Listed" as mutually exclusive with Private/Government/
    // Cooperative/Foreign, so any other non-null value confidently means
    // Unlisted — but 152 of 297 orgs (51%) have no ownership_type on file
    // at all, and those stay "Unknown" rather than being assumed either way.
    listedStatus: org.ownershipType === 'Public_Listed' ? 'Listed' : org.ownershipType != null ? 'Unlisted' : 'Unknown',
    stockSymbol: null,
    cin: org.cinNumber ?? null,
    website: org.domain ?? null,
    yearFounded: org.incorporationYear ?? null,
    hqCity: hq?.city?.cityName ?? null,
    state: hq?.state?.stateName ?? null,
    region: hq?.state?.region ?? null,

    // Banking-specific
    govtShareholding: financials.govtShareholding ?? null,
    countryOfOrigin: null,
    formOfPresence: null,
    sourceAsOfDate: null,

    // Financials (via metric_definitions)
    revenue: financials.revenue ?? null,
    netProfit: financials.netProfit ?? null,
    marketCap: financials.marketCap ?? null,
    marketCapDate: null,
    aum: financials.aum ?? null,
    employeeCount: financials.employeeCount ?? null,
    branchCount: financials.branchCount ?? org._branchCount ?? null,
    // Government-sector metric (Allocated Budget, Cr) -- null for every
    // other sector, same convention as aum being null outside BFSI's AMC
    // subsector.
    allocatedBudget: financials.allocatedBudget ?? null,
    customerBase: null,

    // Leadership
    ceo: org.leadershipProfile?.ceoName ?? null,
    chairman: org.leadershipProfile?.chairmanName ?? null,
    cio: org.leadershipProfile?.cioName ?? null,
    cto: org.leadershipProfile?.ctoName ?? null,
    cfo: null,
    ciso: null,

    // Contact Profile (ICP spec Stage 3F) — the contacts/contact_profiles
    // tables are 100% empty database-wide (no Point-of-Contact/Email/Phone
    // columns were ever mapped during import). Flagged, not fabricated —
    // stays null for every org until real contact data exists.
    pointOfContact: (org.contacts ?? []).find((c: any) => c.isPrimary)?.fullName ?? null,
    contactEmail: (org.contacts ?? []).find((c: any) => c.channel === 'Email')?.value ?? null,
    contactPhone: (org.contacts ?? []).find((c: any) => c.channel === 'Phone')?.value ?? null,

    // Technology spend (via metric_definitions)
    itSpend: technology.itSpend ?? null,
    cloudSpend: technology.cloudSpend ?? null,
    cyberSpend: technology.cyberSpend ?? null,
    dcSpend: technology.dcSpend ?? null,
    aiSpend: technology.aiSpend ?? null,

    corePlatform: null,
    techStack: null,

    // Maturity levels (via technology_profiles)
    digitalMaturity: profiles.digitalMaturity ?? null,
    cloudMaturity: profiles.cloudMaturity ?? null,
    aiReadiness: profiles.aiReadiness ?? null,
    cyberMaturity: profiles.cyberMaturity ?? null,

    regulatoryNotes: null,
    painPoints: null,
    initiatives: null,
    buyingPotential: financials.buyingPotential ?? null,

    notes: null,
    esdsFitNotes: null,
    verificationSources: null,

    urgencyScore: financials.urgencyScore ?? null,
    dealSize: financials.dealSize ?? null,
    recommendedProducts: null,
    businessJustification: null,
    dataConfidenceScore: financials.dataConfidenceScore ?? null,

    // Branch summary — the flat per-branch list (GET /branches) carries the
    // detail; this is just the total count for KPI cards.
    branchTotal: org._branchCount ?? 0,

    // ICP (see backend/src/modules/icp/) — null until POST /icp/run has
    // scored this org at least once. isQualified/tags/tier reflect the most
    // recent run only; GET /organizations/:id/icp has full explainability
    // (matched rules, qualification date, etc.).
    icpScore: org.icpScore != null ? Number(org.icpScore) : null,
    opportunityTier: org.opportunityTier ? String(org.opportunityTier).replace(/_/g, ' ') : null,
    isQualified: org.qualificationResults?.[0]?.isQualified ?? null,
    opportunityTags: (org.organizationTags ?? []).map((t: any) => t.opportunityTag.tagName),

    // Business Intent Engine (see backend/src/modules/businessIntent/) —
    // 'Not Scored' / score 0 until POST /business-intent/run has scored
    // this org at least once. finalPriority is null until then too (it's
    // only ever set alongside a real score).
    businessIntentScore: org.businessIntentScore ?? 0,
    businessIntentClassification: org.businessIntentClassification
      ? String(org.businessIntentClassification).replace(/_/g, ' ')
      : 'Not Scored',
    lettersMatched: org.lettersMatched ?? [],
    finalPriority: org.finalPriority ?? null,

    _source: 'postgres',
    _dedupeKey: normalizeForDedup(org.legalName),
    _organizationId: org.organizationId,
    _status: org.status,
  };
}
