import { prisma } from '../../db';
import type { BusinessIntentOrgInput, BusinessIntentResult, FinalPriority } from './businessIntent.types';

// "Recent" document activity window for the D-process signal. There is no
// RFP-specific document_type in the schema (see businessIntent.types.ts) —
// this is the honest substitute: any document collected within the window,
// regardless of type.
const RECENT_DOCUMENT_WINDOW_DAYS = 180;

export class BusinessIntentRepository {
  /** One query per org would be 297 round trips — this pulls everything
   *  computeBusinessIntent() needs for every organization in a small,
   *  fixed number of queries instead. */
  async loadOrgsForScoring(): Promise<BusinessIntentOrgInput[]> {
    const recentCutoff = new Date(Date.now() - RECENT_DOCUMENT_WINDOW_DAYS * 24 * 60 * 60 * 1000);

    const [orgs, recentDocumentOrgIds] = await Promise.all([
      prisma.organization.findMany({
        include: {
          sector: true,
          financialMetrics: { include: { metricDefinition: true } },
          technologyMetrics: { include: { metricDefinition: true } },
          technologyProfiles: true,
          leadership: { where: { isCurrent: true }, select: { designation: true } },
        },
      }),
      prisma.document.findMany({
        where: { downloadedAt: { gte: recentCutoff } },
        select: { organizationId: true },
        distinct: ['organizationId'],
      }),
    ]);

    const recentDocSet = new Set(recentDocumentOrgIds.map((d) => d.organizationId));

    return orgs.map((org) => {
      const revenue = org.financialMetrics.find((m) => m.metricDefinition.metricKey === 'revenue');
      const itSpend = org.technologyMetrics.find((m) => m.metricDefinition.metricKey === 'it_spend');
      const cloudSpend = org.technologyMetrics.find((m) => m.metricDefinition.metricKey === 'cloud_spend');

      return {
        organizationId: org.organizationId,
        legalName: org.legalName,
        sectorName: org.sector?.sectorName ?? null,
        metrics: {
          revenue: revenue ? Number(revenue.value) : null,
          itSpend: itSpend ? Number(itSpend.value) : null,
          cloudSpend: cloudSpend ? Number(cloudSpend.value) : null,
        },
        technologyProfiles: org.technologyProfiles.map((p) => ({ category: p.category, valueText: p.valueText })),
        leadershipDesignations: org.leadership.map((l) => l.designation),
        hasRecentDocumentActivity: recentDocSet.has(org.organizationId),
      };
    });
  }

  /** organizations.icp_score/opportunity_tier for every org, for Step 3's
   *  final_priority cross-reference — a separate lightweight query since
   *  loadOrgsForScoring()'s include is already large. */
  async loadIcpTiers(): Promise<Map<string, { icpScore: number | null; opportunityTier: string | null }>> {
    const rows = await prisma.organization.findMany({
      select: { organizationId: true, icpScore: true, opportunityTier: true },
    });
    return new Map(
      rows.map((r) => [r.organizationId, { icpScore: r.icpScore ? Number(r.icpScore) : null, opportunityTier: r.opportunityTier }]),
    );
  }

  /** Transaction per org (mandatory per spec: "Wrap score+delete+cache-
   *  refresh in a transaction per org") — score history insert + the
   *  organizations row update happen together or not at all. */
  async saveScoringResult(organizationId: string, result: BusinessIntentResult, finalPriority: FinalPriority | null) {
    await prisma.$transaction([
      prisma.businessIntentScoreHistory.create({
        data: {
          organizationId,
          score: result.score,
          classification: toEnum(result.classification),
          lettersMatched: result.lettersMatched,
        },
      }),
      prisma.organization.update({
        where: { organizationId },
        data: {
          businessIntentScore: result.score,
          businessIntentClassification: toEnum(result.classification),
          lettersMatched: result.lettersMatched,
          finalPriority,
          businessIntentLastScoredAt: new Date(),
        },
      }),
    ]);
  }

  /** Writes the removal-log snapshot BEFORE the status flip, in the same
   *  transaction, per the spec's mandatory safety requirement — if this
   *  transaction fails partway, neither half is committed (Postgres
   *  transactional guarantee), so there is never a status flip without a
   *  matching audit row. Soft-delete: sets status=REJECTED, never a real
   *  DELETE — see migration.sql's header comment for why. */
  async archiveOrganization(params: {
    organizationId: string;
    organizationName: string;
    businessIntentScore: number;
    businessIntentClassification: BusinessIntentResult['classification'];
    icpScore: number | null;
    icpTier: string | null;
    reason: string;
  }) {
    await prisma.$transaction([
      // Removal-log snapshot is written first (spec: "BEFORE the DELETE, in
      // the same transaction") -- Prisma's $transaction array runs its
      // statements in the given order within one transaction, so this is
      // both first *and* atomic with the status flip below.
      prisma.businessIntentRemovalLog.create({
        data: {
          organizationId: params.organizationId,
          organizationName: params.organizationName,
          businessIntentScore: params.businessIntentScore,
          businessIntentClassification: toEnum(params.businessIntentClassification),
          icpScore: params.icpScore,
          icpTier: params.icpTier as any,
          reason: params.reason,
        },
      }),
      prisma.organization.update({
        where: { organizationId: params.organizationId },
        data: { status: 'REJECTED' },
      }),
      // Audit event, same transaction — spec: actor='engine:business_intent',
      // event_type='org_deleted', payload={org_id, org_name, reason}. Mapped
      // onto audit_logs' real columns (action/entityType/entityId/metadataJson,
      // verified against schema.prisma) rather than inventing new ones.
      prisma.auditLog.create({
        data: {
          action: 'org_deleted',
          entityType: 'organization',
          entityId: params.organizationId,
          metadataJson: {
            actor: 'engine:business_intent',
            orgId: params.organizationId,
            orgName: params.organizationName,
            reason: params.reason,
          },
        },
      }),
    ]);
  }

  async listRemovals(page: number, pageSize: number) {
    const [rows, total] = await Promise.all([
      prisma.businessIntentRemovalLog.findMany({
        orderBy: { removedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.businessIntentRemovalLog.count(),
    ]);
    return { rows, total, page, pageSize };
  }
}

function toEnum(classification: BusinessIntentResult['classification']) {
  return classification.replace(/ /g, '_') as 'Qualified' | 'Watch' | 'Not_Qualified' | 'Not_Scored';
}
