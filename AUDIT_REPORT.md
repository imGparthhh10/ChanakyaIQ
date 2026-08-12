# ESDS Platform — Read-Only Audit Report

**Date:** 2026-08-07
**Scope:** Database, ingestion, ICP engine, Business Intent engine, API, cache, dashboard, cross-system consistency, dead code
**Nature:** Read-only inspection. No file, table, or row was modified, fixed, or deleted during this audit.

---

## ⚠️ Verification Constraint — read this first

**PostgreSQL (`localhost:5433`) is down at the time of this audit** and could not be restarted.
Root cause identified but unresolved: `postgres.exe` receives `Permission denied` on
`C:\Program Files\PostgreSQL\18\data` **even after** ownership/ACLs were reset and verified
(`icacls` shows `NETWORK SERVICE:(OI)(CI)(F)` and `BUILTIN\Administrators:(OI)(CI)(F)`), and
even from a confirmed-elevated Administrator token. A plain `New-Item` in that same folder
**succeeds**, proving the block is specific to the `postgres.exe` binary rather than to the
folder — consistent with endpoint-security (EDR/AV) application-level blocking. Windows
Defender Controlled Folder Access is off (`0`) and the folder is not EFS-encrypted, both ruled
out. The Node backend (port 4000) is down as a direct consequence; the static frontend server
(port 8080) is up, which is why the login page renders but returns "Failed to fetch".

**Consequence for this audit:** every finding below is either (a) verified against actual
source code, or (b) explicitly marked `CANNOT VERIFY` where it requires a live query. Row
counts quoted are a real point-in-time snapshot taken earlier the same day, before the outage,
and are labelled as such. **Section 8 (cross-system consistency) is substantially
unverifiable** and is the single biggest gap in this report.

---

## 1. Database schema audit

Schema source of truth: `backend/prisma/schema.prisma` (57 models) + `backend/prisma/eip_schema.sql` (901 lines).
Prisma owns migrations; nothing else issues DDL.

### Row counts — point-in-time snapshot (2026-08-07, pre-outage)

Captured via a Prisma `count()` sweep across all 57 models. **Not re-verifiable right now.**

| Populated | Rows | | Empty (0 rows) |
|---|---|---|---|
| `branches` | 3,120 | | `api_keys`, `audit_logs`, `change_history` |
| `errors` | 1,931 | | `contact_profiles`, `contacts` |
| `cities` | 1,666 | | `crawl_sources`, `dashboard_cache`, `dashboard_views` |
| `processing_logs` | 1,086 | | `document_chunks`, `document_versions` |
| `qualification_results` | 891 | | `entity_resolutions`, `extracted_entities` |
| `score_history` | 891 | | `financial_profiles`, `news_articles`, `news_entities` |
| `tier_history` | 891 | | `news_sources`, `organization_aliases` |
| `organization_tags` | 715 | | `organization_profiles`, `reports` |
| `financial_metrics` | 589 | | `role_permissions`, `saved_filters` |
| `organizations` | **297** | | `sentiment_scores`, `technology_profile_summary` |
| `technology_metrics` | 235 | | `timeline_events`, `translations` |
| `technology_profiles` | 220 | | |
| `addresses` | 211 | | |
| `leadership` | 139 | | |
| `leadership_profiles` | 119 | | |
| `states` 38 · `subsectors` 31 · `metric_definitions` 20 · `sessions` 14 · `opportunity_tags` 14 · `sectors` 8 · `score_weights` 7 · `permissions` 5 · `qualification_rules` 5 · `roles` 4 · `job_history` 3 · `users` 2 · `documents` 1 · `crawl_jobs` 1 · `enrichment_jobs` 1 · `llm_profiles` 1 · `rule_groups` 1 · `score_models` 1 | | |

---

```
[SEVERITY: Critical]  organizations.pain_point does not exist — MEDDPICC "I" letter has no data source
Where: backend/prisma/schema.prisma (Organization model), backend/src/modules/organizations/organizations.mapper.ts:120
What: Multiple specs assert `organizations.pain_point` is an existing production field. It does
      not exist as a column anywhere in the schema. The API surfaces `painPoints: null` as a
      hardcoded literal, documented in that file's own header as a known field gap.
Evidence: `grep -rn "pain_point" backend/prisma/` → zero matches in schema.prisma and
      eip_schema.sql. organizations.mapper.ts:120 reads exactly `painPoints: null,` and the
      file header (lines 20-25) lists painPoints among "Fields with no home in eip_schema.sql".
Impact: Any scoring logic written against pain_point scores every organization identically
      (no signal). The MEDDPICC "I — Identify Pain" letter, which the spec weights highest
      (20 points), cannot be computed at all from current data.
```

```
[SEVERITY: Critical]  organizations.cloud_provider does not exist — MEDDPICC "C-Competition" has no data source
Where: backend/prisma/schema.prisma, entire backend + frontend
What: Specs assert `organizations.cloud_provider` exists. It has zero references anywhere in
      the codebase — not in the schema, not in the mapper, not even as a null stub the way
      painPoints has.
Evidence: `grep -rni "cloudprovider|cloud_provider" backend/src backend/prisma assets/js` →
      zero matches (only `cloudSpend`, a different numeric metric, exists).
Impact: The "C — Competition" letter is uncomputable. Also means both spec-stated hard
      exclusion filters ("pain_point IS NULL AND cloud_provider IS NULL") reference two
      non-existent fields, so that exclusion can never fire as written.
```

```
[SEVERITY: High]  Primary-key naming mismatch between specs and actual schema
Where: backend/prisma/schema.prisma:486
What: Specs repeatedly reference `organizations(id)` (e.g. in proposed FK definitions). The
      actual PK column is `organization_id`.
Evidence: schema.prisma:486 — `organizationId String @id ... @map("organization_id")`.
Impact: Any migration written literally from those specs (`REFERENCES organizations(id)`)
      fails outright at apply time. Caught before the Business Intent migration was written;
      that migration correctly uses `organization_id`.
```

```
[SEVERITY: Medium]  opportunity_tier enum stores underscored values, presented with spaces
Where: backend/prisma/schema.prisma (OpportunityTier enum), organizations.mapper.ts:143
What: The enum members are `Tier_1`/`Tier_2`/`Tier_3` with `@map("Tier 1")` etc. Prisma
      returns the member name; the mapper converts underscores to spaces before the API
      responds.
Evidence: mapper:143 — `String(org.opportunityTier).replace(/_/g, ' ')`.
Impact: Any backend code comparing `opportunityTier === 'Tier 1'` on a raw Prisma result
      silently never matches (it's `Tier_1` at that layer). Frontend comparisons against
      'Tier 1' are correct because they read post-mapper data. A real footgun for new backend
      code; no current bug found from it.
```

```
[SEVERITY: High]  documents table has 1 row platform-wide — D-process signal is effectively dead
Where: documents table (row count above)
What: The MEDDPICC "D — Decision Process" letter is specified to use `documents` as an RFP
      activity proxy. The table contains exactly one row across all 297 organizations, and
      that row is a crawler stub, not a real document.
Evidence: Row count snapshot: `documents 1`. Also `crawl_sources 0`, `document_chunks 0`,
      `document_versions 0` — nothing has ever really been collected.
Impact: The D-process signal will evaluate false for ~297/297 organizations, meaning the
      3-letter breadth bonus is effectively unreachable and Business Intent scores will
      cluster far lower than the thresholds assume. Not a code bug — a data-availability
      reality that materially changes score distribution.
```

```
[SEVERITY: High]  There is no document_type value representing an RFP
Where: backend/prisma/schema.prisma (DocumentType enum)
What: Spec calls for detecting "recent RFP/document activity". The DocumentType enum has 13
      values (Official Website, Investor Page, Annual Report, AGM Report, Financial Statement,
      News, Government Website, RBI Publication, Press Release, Social Media,
      Sustainability/CSR, Career, Other) — none is RFP or procurement-related.
Evidence: schema.prisma DocumentType enum, lines 889-905.
Impact: "RFP activity" cannot be distinguished from any other document. The implemented
      D-process check therefore uses *any* recent document as the proxy — an honest
      substitute, but weaker than the spec implies.
```

```
[SEVERITY: Medium]  contacts / contact_profiles are 100% empty, and ICP scoring depends on them
Where: contacts (0 rows), backend/src/modules/icp/icp.service.ts:160-165
What: The ICP "Leadership & Contact Availability" score component averages a leadership score
      with a contact score. The contact half is always 0 because the table is empty.
Evidence: Row count `contacts 0`; icp.service.ts:164 — `org.contacts.length > 0 ? 100 : 0`,
      with an inline comment already acknowledging this.
Impact: That component is permanently capped at 50% of its possible value for every
      organization, systematically depressing all ICP scores by a constant factor. Not
      incorrect per se (it's honest about missing data), but it means ICP scores are not
      comparable to what they'd be with contact data present.
```

```
[SEVERITY: Low]  CANNOT VERIFY — orphaned rows across FK relationships
Where: all tables
What: Requires live queries across every FK relationship. Postgres is down.
Evidence: N/A — not verifiable.
Impact: Unknown. Note that all FKs are declared with explicit onDelete behavior in
      schema.prisma (mostly Cascade for org-owned children, NoAction for lookups), and no
      hard-DELETE code path against organizations exists anywhere in the codebase (verified
      by grep), so orphan creation is structurally unlikely.
```

```
[SEVERITY: Low]  CANNOT VERIFY — NULL rates for scoring-critical fields, and duplicate organization rows
Where: organizations, financial_metrics, technology_metrics, leadership
What: Requires live aggregate queries. Postgres is down.
Evidence: N/A. Partial inference only: financial_metrics has 589 rows across 297 orgs
      (~2 metrics/org, so most metric types are absent for most orgs), technology_metrics 235
      rows (~0.8/org), leadership 139 rows across 297 orgs (so >50% of orgs likely have zero
      leadership rows → would be hard-excluded by Business Intent's economic-buyer filter).
Impact: The leadership sparsity estimate above, if borne out, means roughly half of all
      organizations would be excluded before scoring even begins. This must be confirmed with
      a live query before enabling any archival logic.
```

**Safe to build on top of: Yes with caveats** — schema is sound and well-normalized; the
caveat is that two fields specs depend on don't exist, and several tables scoring depends on
are empty or near-empty.

---

## 2. Ingestion pipeline audit

Three distinct write paths were found.

| Path | Entry point | Writes to | Transaction? | Validates? | Logs failures? |
|---|---|---|---|---|---|
| Excel import (CLI) | `backend/src/modules/import/cli.ts` | organizations, addresses, leadership, leadership_profiles, financial_metrics, technology_metrics, technology_profiles, branches, states, cities, subsectors | **No** | Partial | Yes (`errors`, `processing_logs`) |
| Excel import (HTTP) | `POST /api/import/excel` | same as above | **No** | Partial | Yes |
| Python pipeline | `pipeline/` package (built this session) | crawl_sources, crawl_jobs, documents, document_versions, document_chunks, translations, enrichment_jobs, extracted_entities, entity_resolutions, llm_profiles, organization_profiles, leadership, financial_metrics, technology_metrics, timeline_events, contacts, addresses, change_history, processing_logs, job_history, errors, organizations.status | Per-unit-of-work | Yes (pydantic) | Yes |

```
[SEVERITY: Critical]  Excel import force-sets status='ACTIVE' on every org — will silently un-archive Business Intent removals
Where: backend/src/modules/import/mapping.ts:99
What: Every import run writes `status: 'ACTIVE'` to every matched organization, on both the
      create and the update branch. The Business Intent engine's cleanup step archives orgs by
      setting `status = 'REJECTED'`. A subsequent Excel import silently reverts every archived
      organization back to ACTIVE, with no log, no audit entry, and no removal_log
      counterpart.
Evidence: mapping.ts:99 — `status: 'ACTIVE' as const,` inside `orgData`, which is passed to
      BOTH `prisma.organization.update(...)` (line 106) and `.create(...)` (line 110).
Impact: The audit trail and the actual state diverge permanently — business_intent_removal_log
      says an org was removed, but the org is live in the dashboard again. This also silently
      overwrites the Python pipeline's org_status progression (NEW → ... → QUALIFIED). This is
      the single highest-risk finding in this report and must be resolved before the Business
      Intent cleanup step is ever run for real.
```

```
[SEVERITY: High]  Excel import runs without a transaction — a mid-run failure leaves partially-written organizations
Where: backend/src/modules/import/mapping.ts (entire upsertOrganization flow), importJob.service.ts
What: Each organization is written via a sequence of separate awaited Prisma calls
      (organization → address → leadership → leadership_profile → metrics → branches) with no
      enclosing $transaction. A failure or crash partway through leaves an organization row
      with some children written and others missing.
Evidence: mapping.ts lines 106-160 are consecutive independent `await prisma.X.create/update`
      calls; `grep -n "\$transaction" backend/src/modules/import/*.ts` → zero matches.
Impact: Dirty, half-populated organization records that look complete to the API. Combined
      with the fact that the errors table already holds 1,931 rows, partial writes may already
      exist in the current dataset.
```

```
[SEVERITY: Medium]  Two independent write paths with incompatible status semantics
Where: backend/src/modules/import/mapping.ts:99 vs pipeline/pipeline/db/org_status.py
What: The Excel importer treats `status` as a constant ('ACTIVE'). The Python pipeline treats
      it as a lifecycle state machine it advances stage by stage (NEW → DISCOVERING_SOURCES →
      ... → QUALIFIED). The two disagree about what the column means.
Evidence: mapping.ts:99 sets ACTIVE unconditionally; pipeline_runner.py calls
      `set_org_status()` at nine separate stage boundaries.
Impact: Whichever ran most recently wins. `organizations.status` is not a trustworthy
      indicator of pipeline progress while both paths are in use.
```

```
[SEVERITY: Low]  Re-running the Excel import does NOT create duplicates (verified good)
Where: backend/src/modules/import/dedupe.ts, mapping.ts:85
What: Import resolves an existing organization via `findExistingOrgId(index, companyName,
      state)` using a normalized dedupe key before deciding create-vs-update.
Evidence: mapping.ts:85 and the create/update branch at 105-114; `normalizeForDedup` is shared
      with the API's `_dedupeKey` so both sides agree.
Impact: None — this is correct behavior, recorded here as a positive verification.
```

**Safe to build on top of: No — needs fixes first.** The `status: 'ACTIVE'` overwrite is a
direct, active conflict with the Business Intent archival design.

---

## 3. ICP Engine audit

```
[SEVERITY: Low]  Trigger is manual HTTP only — no scheduler exists anywhere in the backend
Where: backend/src/modules/icp/icp.routes.ts:13, backend/src/app.ts:44
What: `POST /api/icp/run` is the only trigger. There is no cron, no setInterval, no job
      scheduler of any kind in the backend.
Evidence: `grep -rni "cron|setInterval|schedule" backend/src` returns only unrelated matches
      (co-operative bank category names containing "Scheduled").
Impact: None functionally, but it resolves the open "should Business Intent run after ICP or on
      its own schedule?" question definitively: there is no scheduling infrastructure to hook
      into, so both engines are manual-trigger by design.
```

```
[SEVERITY: High]  ICP run is not atomic across organizations — a mid-run failure leaves the dataset half-scored
Where: backend/src/modules/icp/icp.service.ts:126-186
What: `recordScore()` correctly wraps its three writes (score_history + tier_history +
      organizations.update) in a `$transaction`. But the outer `for (const org of orgs)` loop
      has no enclosing transaction, and `recordQualification` / `replaceOrgTags` are separate
      calls again. A failure at organization 150 of 297 leaves 149 orgs scored against the new
      rules and 148 against the old.
Evidence: icp.repository.ts:39-47 shows the inner `$transaction`; icp.service.ts:126 opens a
      plain `for` loop with awaits inside and no transaction wrapper.
Impact: Silent, partial scoring state. Tier comparisons across organizations become invalid
      after a failed run, and nothing in the response or logs signals that it happened.
```

```
[SEVERITY: Low]  History tables verified append-only (positive finding)
Where: score_history, tier_history
What: No UPDATE or DELETE statement targets either table anywhere in the codebase.
Evidence: `grep -rnE "scoreHistory\.(update|delete)|tierHistory\.(update|delete)"
      backend/src --include=*.ts` → zero matches (only a code comment mentions the word
      UPDATE).
Impact: None — append-only guarantee holds in practice, as intended.
```

```
[SEVERITY: Medium]  score_weights.metric_id is NULL for every seeded row; the metric mapping lives in code, not the DB
Where: backend/src/modules/icp/icp.service.ts:14-20
What: The ICP scoring design intends score components to link to metrics via
      `score_weights.metric_id`, but the seed INSERT only populates component_name/weight_pct,
      leaving metric_id NULL for all 7 rows. The service compensates with a hardcoded
      `COMPONENT_TO_METRIC_KEY` map.
Evidence: icp.service.ts:6-20 — the comment explicitly documents this gap, and the map covers
      only 5 of 7 components; the other two ("Organization Scale", "Leadership & Contact
      Availability") use inline heuristics.
Impact: "Thresholds are DB-driven, not hardcoded" (the stated design goal, and what the
      /settings/icp admin page exists to deliver) is only true for qualification_rules, not for
      score weighting. Adding a new score component requires a code change, not a DB change.
```

**Safe to build on top of: Yes with caveats** — logic is real and not stubbed, history is
clean; the atomicity gap should be fixed before the dataset grows.

---

## 4. Business Intent Engine audit

**Status: implemented in code this session, never executed, migration never applied.**

Files that exist (all new, all typecheck clean, 17/17 unit tests passing):

| File | Purpose |
|---|---|
| `backend/prisma/migrations/2_business_intent_engine/migration.sql` | Schema — **NOT YET APPLIED to any database** |
| `businessIntent.types.ts` | Contracts |
| `businessIntent.scoring.ts` | `computeBusinessIntent()` — pure, no I/O |
| `businessIntent.priority.ts` | `computeFinalPriority()` — tier × classification |
| `businessIntent.repository.ts` | All DML |
| `businessIntent.service.ts` | Batch orchestration + dry-run |
| `businessIntent.routes.ts` | `POST /run`, `POST /run?dryRun=true`, `GET /removals` |
| `assets/js/pages/businessIntent.js` | Admin UI |
| 2 × `*.test.ts` | 17 unit tests |

```
[SEVERITY: Critical]  Migration has never been applied — none of these columns/tables exist in the live database
Where: backend/prisma/migrations/2_business_intent_engine/migration.sql
What: The migration file is written and the Prisma schema is updated (prisma generate succeeds),
      but the migration has never been run against Postgres because the database has been
      unreachable since before it was written.
Evidence: Postgres down since ~13:50 IST; no `prisma migrate deploy` or psql apply was executed.
Impact: Every Business Intent API route will fail at runtime against the current database
      (columns don't exist). `GET /api/organizations` will also fail, because the mapper now
      reads `org.businessIntentScore` etc. — **this means the Business Intent work has made the
      existing organizations endpoint dependent on an unapplied migration.** Applying the
      migration is a hard prerequisite to the platform working at all now.
```

```
[SEVERITY: High]  Classification thresholds were recalibrated from spec (70/40 → 45/25) out of mathematical necessity
Where: backend/src/modules/businessIntent/businessIntent.scoring.ts:60-67
What: The spec's thresholds assume 5 scorable letters totalling max 85 points. With I and
      C-Competition dropped (no data source — see Section 1), the real maximum is 55, making
      "Qualified" (>=70) mathematically unreachable for every organization. Thresholds were
      rescaled by the same ratio to 45/25.
Evidence: scoring.ts:60-67 documents the arithmetic inline; the max-55 path is asserted in
      `businessIntent.scoring.test.ts` ("breadth bonus requires all 3 distinct letters" →
      score 55).
Impact: Classification distribution will not match anything the original spec predicted. These
      numbers are a judgment call, not a derived truth, and should be reviewed against a real
      dry-run distribution before archival is enabled.
```

```
[SEVERITY: High]  Spec's spend/revenue thresholds are in raw rupees; the database stores INR crore
Where: businessIntent.scoring.ts:28-30, backend/src/utils/metricFieldMap.ts
What: Spec specifies `it_cloud_spend > 5000000` and `revenue > 1000000000` (raw rupees).
      Every value in financial_metrics/technology_metrics is stored in INR crore
      (metric_definitions.unit defaults to 'INR_CR').
Evidence: metricFieldMap.ts:9 documents the unit convention; earlier live queries this session
      confirmed IT Spend ranges 0.02–900 and revenue is two-to-four digit — i.e. crore.
      Implemented as 0.5 Cr / 100 Cr with the conversion documented inline.
Impact: Had the literal figures been used, the M signal would never have fired for any
      organization (no value in the DB approaches 5,000,000 in crore terms). Corrected, but
      worth confirming 0.5 Cr / 100 Cr are the business-intended cutoffs.
```

```
[SEVERITY: High]  Spec places it_spend/cloud_spend in financial_metrics; they actually live in technology_metrics
Where: businessIntent.repository.ts:36-38, backend/src/utils/metricFieldMap.ts:26-32
What: The spec's scoring pseudocode reads `financial_metrics.it_cloud_spend` and
      `financial_metrics.cloud_spend`. Both are technology_metrics rows.
Evidence: metricFieldMap.ts:26-32 — `TECHNOLOGY_METRIC_FIELDS = { itSpend: 'it_spend',
      cloudSpend: 'cloud_spend', ... }`.
Impact: A literal implementation would have queried the wrong table and found nothing.
      Corrected in the implementation.
```

```
[SEVERITY: Medium]  final_priority mapping does not distinguish 'Not Scored' from 'Not Qualified' — a real gap
Where: backend/src/modules/businessIntent/businessIntent.priority.ts:11-22
What: `business_intent_classification` has four possible values. `computeFinalPriority()`
      handles Qualified and Watch explicitly and falls through to the "Not Qualified" branch
      for everything else — meaning a never-scored organization ('Not Scored') is labelled
      "Deprioritize" or "Strategic fit, no signal yet", identical to one that was scored and
      genuinely failed.
Evidence: priority.ts:14-21 — two `if` checks then an unconditional `return`, with no
      'Not Scored' case.
Impact: An unscored organization is presented to users as a judged one. In practice
      final_priority is only written alongside a real score (service.ts:87), so this is latent
      rather than active — but the mapping is genuinely non-total, exactly the gap the audit
      spec asked to be flagged.
```

```
[SEVERITY: Low]  Dry-run verified to perform zero writes (positive finding)
Where: backend/src/modules/businessIntent/businessIntent.service.ts:56-91
What: Every write in the batch loop is guarded by `if (!dryRun)`. There is no unguarded write
      anywhere in the run path.
Evidence: service.ts:78 (`if (!dryRun) await repo.archiveOrganization(...)`) and service.ts:86
      (`if (!dryRun) await repo.saveScoringResult(...)`) are the only two write call sites in
      the function.
Impact: None — dry-run safety confirmed by code reading. NOT confirmed by execution, since the
      database is down.
```

```
[SEVERITY: Low]  Removal log writes before the status change, in the same transaction (positive finding)
Where: backend/src/modules/businessIntent/businessIntent.repository.ts:103-141
What: `archiveOrganization()` issues a single `prisma.$transaction([...])` containing, in
      order: removal_log insert → organizations status update → audit_logs insert.
Evidence: repository.ts:104-140. Prisma executes array-form $transaction statements in the
      given order within one transaction.
Impact: None — the spec's mandatory safety requirement is satisfied. Also note: this build
      soft-deletes (status='REJECTED'), so **no cascade deletes occur at all** and the
      "orphaned rows after deletion" risk does not apply to this design.
```

**Safe to build on top of: No — needs fixes first.** Not because the code is wrong, but because
it has never been executed and its migration is unapplied — and because the Section 2
`status: 'ACTIVE'` conflict would defeat its archival behavior.

---

## 5. API layer audit

All routes registered in `backend/src/app.ts`. `api.use(requireAuth)` sits at line 33, after
`/auth` and `/health`, before everything else.

| Method | Path | Auth | Called by frontend? |
|---|---|---|---|
| GET | `/api/health` | ✗ (intentional) | No |
| POST | `/api/auth/login` | ✗ (intentional) | Yes |
| POST | `/api/auth/logout` | ✓ (self-applied) | Yes |
| GET | `/api/auth/me` | ✓ (self-applied) | Yes |
| GET | `/api/organizations` | ✓ | Yes |
| GET | `/api/organizations/:id` | ✓ | No |
| GET | `/api/organizations/:id/profile` | ✓ | No |
| GET | `/api/organizations/:id/icp` | ✓ | Yes |
| GET | `/api/organizations/:id/financials` | ✓ | No |
| GET | `/api/organizations/:id/technology` | ✓ | No |
| GET | `/api/branches` | ✓ | Yes |
| GET | `/api/dashboard` | ✓ | **No** |
| GET | `/api/search` | ✓ | **No** |
| POST | `/api/import/excel` | ✓ | **No** |
| POST | `/api/crawl` | ✓ | **No** |
| POST | `/api/enrich` | ✓ | **No** |
| POST | `/api/icp/run` | ✓ | **No** |
| GET | `/api/icp/rules` | ✓ | Yes |
| PATCH | `/api/icp/rules/:ruleId` | ✓ | Yes |
| POST | `/api/business-intent/run` | ✓ | Yes (new admin page) |
| GET | `/api/business-intent/removals` | ✓ | Yes (new admin page) |

```
[SEVERITY: Low]  No route is missing auth (positive finding)
Where: backend/src/app.ts:32-45
What: Only /health and /auth/login are unauthenticated, both intentionally. Every data route
      sits below the `api.use(requireAuth)` line.
Evidence: app.ts:33 places requireAuth before all data route mounts; auth.routes.ts:66,78 show
      logout/me self-applying requireAuth.
Impact: None — auth coverage is correct.
```

```
[SEVERITY: Low]  No frontend call targets a nonexistent backend route (positive finding)
Where: assets/js (all API_BASE call sites) vs app.ts
What: Cross-checked all 10 distinct frontend endpoint patterns against the registered route
      table. All resolve.
Evidence: `grep -rnoE "API_BASE\}[^\`'\"]*" assets/js | sort -u` yields 10 patterns, each
      matching a route above.
Impact: None — no dead frontend fetches.
```

```
[SEVERITY: Medium]  Unhandled errors return raw internal exception messages to the client
Where: backend/src/middleware/errorHandler.ts:17-18
What: Any non-ApiError falls through to `res.status(500).json({ error: err.message })`, which
      leaks Prisma/internal error text (table names, column names, constraint names, and
      potentially query fragments) to any authenticated caller.
Evidence: errorHandler.ts:16-18.
Impact: Information disclosure. Low exploitability (all such routes require auth) but it is
      real, and it will get noisier once the Business Intent migration mismatch starts throwing
      Prisma column errors.
```

```
[SEVERITY: High]  GET /api/organizations now depends on columns that don't exist in the live DB
Where: backend/src/modules/organizations/organizations.mapper.ts (businessIntentScore block)
What: The mapper was extended this session to return businessIntentScore /
      businessIntentClassification / lettersMatched / finalPriority. Those columns only exist
      after the unapplied migration.
Evidence: mapper reads `org.businessIntentScore ?? 0` etc.; migration 2 is unapplied.
Impact: Until the migration is applied, Prisma's generated client will request columns the
      database doesn't have, and `GET /api/organizations` — the single endpoint the entire
      dashboard depends on — will error. **This is a deployment-ordering hazard: migration must
      be applied before this backend build is started.**
```

**Safe to build on top of: Yes with caveats** — routing/auth are clean; the migration-ordering
dependency must be resolved first.

---

## 6. Cache layer audit

```
[SEVERITY: Medium]  "DataCache" is a browser-side in-memory cache only — there is no server-side cache
Where: assets/js/data/data.js, assets/js/data/cache.js
What: The audit brief describes DataCache as "a shared cache layer between API and frontend".
      It is not shared: it lives entirely in the browser tab's memory, populated by
      `dataEngine.load()` from `GET /api/organizations` + `GET /api/branches`, and broadcast
      via `bus.emit('data:ready', { cache, stats, branches })`.
Evidence: data.js:93 and :223 are the only `data:ready` emitters; the `dashboard_cache` table
      exists in the schema but has 0 rows and no code reads or writes it.
Impact: "Stale cache" can only affect an already-open browser tab — a page refresh always
      re-fetches from the database. Materially lower risk than a server-side cache would
      carry, but also means cache invalidation must be triggered client-side, per-tab.
```

```
[SEVERITY: High]  POST /api/icp/run has no cache invalidation and no UI trigger at all
Where: assets/js (entire frontend)
What: Nothing in the frontend ever calls /icp/run, and nothing refreshes the cache after an
      ICP run. An operator runs it via curl/Postman; any open dashboard keeps showing
      pre-run scores until manually reloaded.
Evidence: `grep -rn "icp/run" assets/js` → three matches, all code comments telling the reader
      to run it manually. `grep -rn "dataEngine.reload"` → dashboard.js:110 (manual refresh
      button), dashboard.js:189 (error retry), businessIntent.js:112 (new). None tied to ICP.
Impact: Confirmed stale-data path for the ICP engine. The dashboard silently shows outdated
      tiers/scores after every ICP run until someone hits refresh.
```

```
[SEVERITY: Low]  Business Intent run DOES invalidate the cache (positive finding)
Where: assets/js/pages/businessIntent.js:112
What: After a successful non-dry run, the page awaits `dataEngine.reload()`, which resets
      STATE and re-runs the full pipeline against the API.
Evidence: businessIntent.js:105-112; data.js:254-261 shows reload() clearing STATE.cache and
      re-running runPipeline().
Impact: None — invalidation is wired to a real function, not assumed. **NOT verified by
      execution** (database down); verified by tracing the call chain only.
```

```
[SEVERITY: Low]  CANNOT VERIFY — post-run read reflects new data vs stale
Where: N/A
What: Requires running ICP and Business Intent against a live database and observing a
      subsequent read. Postgres is down.
Evidence: N/A.
Impact: Unknown. This is the explicit "test it, don't assume it" item from the brief and it
      remains untested.
```

**Safe to build on top of: Yes with caveats** — architecture is simple and sound; the ICP
invalidation gap is real and should be closed.

---

## 7. Dashboard / frontend audit

15 page modules exist; 14 are registered as routes plus 4 persistent containers.

| Route | Page | Primary data |
|---|---|---|
| `/` | home.js | greeting + placeholders |
| `/companies` | (persistent) | filters, map, Company 360 split |
| `/analytics` | (persistent) | KPI grid, charts |
| `/recommendations` | (persistent) | recommendation cards |
| `/executive` | executive.js | exec summary |
| `/my-territory` | myTerritory.js | owned accounts |
| `/digest` | digest.js | weekly digest |
| `/whitespace` | whitespace.js | untouched accounts |
| `/sectors`, `/sector/:key` | sectorsIndex.js, sector.js | sector rollups |
| `/company/:key` | company360.js | full org profile |
| `/directory` | companyDirectory.js | full org table + export |
| `/lists`, `/lists/:id` | lists.js | saved lists |
| `/signals` | signals.js | signal feed |
| `/settings/icp` | icpSettings.js | qualification rules admin |
| `/settings/business-intent` | businessIntent.js | BI run + removals admin |

```
[SEVERITY: Medium]  assets/js/pages/branches.js is dead code — never imported, never routed
Where: assets/js/pages/branches.js
What: A full page module exists but nothing imports it and no route registers it.
Evidence: `grep -rn "pages/branches" assets/js` → zero matches. Not present in dashboard.js's
      registerRoute list (lines 148-165).
Impact: Dead code. It fetches/renders branch data that is unreachable from the running app.
```

```
[SEVERITY: Medium]  painPoint filter in cache.js filters on a field that is always null
Where: assets/js/data/cache.js:311-321, :367
What: `query()` supports a `painPoint` filter and the search path also matches against
      `r.painPoints`. The API sets painPoints to null for every record (Section 1).
Evidence: cache.js:313 — `results.filter(r => r.painPoints && ...)`, which is always false
      under the current API. mapper:120 — `painPoints: null`.
Impact: Dead filter — silently returns zero results if ever used. Same applies to the
      `extractPainKeywords(cache)` call in filters.js:172, which will always produce an empty
      keyword list. Not user-visible today only because no filter UI exposes it.
```

```
[SEVERITY: Low]  Business Intent filters target real API fields (positive finding)
Where: assets/js/components/filters.js, assets/js/data/cache.js
What: The two new filters (`businessIntentClassifications`, `finalPriorities`) filter against
      `r.businessIntentClassification` / `r.finalPriority`, both of which the mapper now
      returns, with option values matching the engine's own literal strings exactly.
Evidence: filters.js option constants mirror businessIntent.scoring.ts's classification set and
      businessIntent.priority.ts's six FinalPriority values; cache.js filters on those exact
      record fields.
Impact: None — no placeholder/assumed values. Contingent on the migration being applied.
```

```
[SEVERITY: Low]  CANNOT VERIFY — rendered dashboard state vs live database
Where: all views
What: Requires a running backend + database and a browser. Both are down, and this environment
      has no browser automation.
Evidence: N/A.
Impact: Unknown. Items unverified: whether displayed data is current, whether any org appears
      in one view but not another, whether any org renders that no longer exists in the DB.
```

**Safe to build on top of: Yes with caveats** — structure is clean and filters are honestly
wired; two dead-code items to clean up.

---

## 8. Cross-system consistency check

```
[SEVERITY: Critical]  CANNOT VERIFY — the entire section
Where: N/A
What: This section requires tracing >=15 named organizations through DB row → ICP stored
      values → Business Intent stored values → API response → rendered dashboard. Every step
      after "DB row" requires a live database and a running backend. Both are down.
Evidence: Postgres refuses connections on :5433; backend process is not running.
Impact: **The most important section of this audit is unverified.** No sample org IDs can be
      quoted, because they cannot be read. This section must be re-run once Postgres is
      restored, before any further feature work — it is the only section that would catch a
      silent disagreement between the four systems.
```

Findings reachable by code analysis alone, which this section would otherwise have caught:

```
[SEVERITY: Critical]  Guaranteed DB↔dashboard disagreement path: Excel import reverts archival
Where: mapping.ts:99 vs businessIntent.repository.ts archiveOrganization()
What: (Full detail in Section 2.) An org archived by Business Intent (status=REJECTED, with a
      removal_log row) is silently returned to ACTIVE by the next Excel import. The removal_log
      still claims it was removed.
Evidence: as Section 2.
Impact: business_intent_removal_log and organizations.status will disagree permanently, and the
      "Removed Organizations" admin panel will list organizations that are live in the
      dashboard — precisely the class of cross-system disagreement this audit exists to find.
```

```
[SEVERITY: Medium]  final_priority mapping is non-total (see Section 4)
Where: businessIntent.priority.ts
What: 'Not Scored' × any tier is not explicitly handled and silently collapses into the
      Not-Qualified branch.
Evidence: priority.ts:14-21.
Impact: The exact "combination not handled by final_priority mapping" gap the brief asked to be
      flagged.
```

**Safe to build on top of: No — needs verification first.** Not "needs fixes" — needs the
verification that could not be performed.

---

## 9. Dead code / unused pipeline audit

```
[SEVERITY: Low]  Five backend routes are never called by any frontend code
Where: GET /api/dashboard, GET /api/search, POST /api/import/excel, POST /api/crawl, POST /api/enrich
What: Registered and auth-protected, but no frontend call site exists.
Evidence: Frontend endpoint sweep (Section 5 table). /import/excel has a legitimate CLI
      equivalent (`npm run import:excel`), and /crawl + /enrich are the documented stubs the
      Python pipeline is intended to replace — so only /dashboard and /search are truly
      orphaned.
Impact: Maintenance surface with no consumer. /dashboard in particular computes KPI
      aggregates the frontend recomputes client-side from the full dataset instead.
```

```
[SEVERITY: Low]  assets/js/components/table.js (DataTable) is dead
Where: assets/js/components/table.js
What: Only importer is the design-system showcase page; every real table in the app is
      hand-rolled.
Evidence: Established in earlier work this session; companyDirectory.js, myTerritory.js,
      whitespace.js, lists.js, sector.js each build their own table markup.
Impact: Dead component; also the reason table behavior (sorting, etc.) is inconsistent across
      pages.
```

```
[SEVERITY: Low]  16 schema tables have never held a row
Where: dashboard_cache, dashboard_views, saved_filters, reports, api_keys, audit_logs,
      change_history, contacts, contact_profiles, news_articles, news_entities, news_sources,
      sentiment_scores, organization_aliases, organization_profiles, timeline_events, and others
What: Present in the schema, zero rows, and mostly zero code paths that would ever write them.
Evidence: Row count snapshot, Section 1.
Impact: Not a defect — the schema was designed ahead of the pipeline. Worth noting that
      `audit_logs` and `change_history` being empty means there is currently **no audit trail
      of any kind** in production; the Business Intent engine would be the first writer to
      both.
```

```
[SEVERITY: Low]  Python pipeline (pipeline/) is built but has never run against the real database
Where: pipeline/
What: 72 source files, ruff+mypy clean, 37 unit tests passing, but its end-to-end test and
      any real run are blocked by the same Postgres outage.
Evidence: pytest run this session: 37 passed (unit); e2e test errored at DB fixture setup.
Impact: An entire ingestion path exists that has never touched production data. Treat as
      unproven until its e2e test passes.
```

---

## Summary — findings by severity and section

| Section | Critical | High | Medium | Low | Total |
|---|---|---|---|---|---|
| 1. Database schema | 2 | 3 | 2 | 2 | 9 |
| 2. Ingestion | 1 | 1 | 1 | 1 | 4 |
| 3. ICP engine | 0 | 1 | 1 | 2 | 4 |
| 4. Business Intent | 1 | 3 | 1 | 2 | 7 |
| 5. API layer | 0 | 1 | 1 | 2 | 4 |
| 6. Cache | 0 | 1 | 1 | 2 | 4 |
| 7. Dashboard | 0 | 0 | 2 | 2 | 4 |
| 8. Cross-system | 2 | 0 | 1 | 0 | 3 |
| 9. Dead code | 0 | 0 | 0 | 4 | 4 |
| **Total** | **6** | **10** | **10** | **17** | **43** |

## Safe-to-build-on-top-of verdict

| # | Area | Verdict |
|---|---|---|
| 1 | Database schema | **Yes with caveats** — sound design; two spec-assumed fields don't exist |
| 2 | Ingestion pipeline | **No — needs fixes first** — status:'ACTIVE' overwrite + no transactions |
| 3 | ICP engine | **Yes with caveats** — real logic, clean history; not atomic across orgs |
| 4 | Business Intent engine | **No — needs fixes first** — migration unapplied, never executed |
| 5 | API layer | **Yes with caveats** — auth clean; migration-ordering hazard |
| 6 | Cache layer | **Yes with caveats** — ICP invalidation missing |
| 7 | Dashboard | **Yes with caveats** — two dead-code items |
| 8 | Cross-system consistency | **No — needs verification first** (not fixes — verification) |
| 9 | Dead code | **Yes** — cosmetic only |

## Top 10 to fix before further feature work — ranked by risk

Data-loss-adjacent items ranked highest regardless of severity label.

| # | Issue | Why this rank |
|---|---|---|
| 1 | **Excel import resets status to 'ACTIVE', un-archiving Business Intent removals** (§2) | Directly defeats the archival mechanism and permanently desyncs the audit log from reality. Must be fixed *before* any archival run, dry or real. |
| 2 | **Business Intent migration unapplied, yet GET /api/organizations already depends on it** (§4, §5) | The platform's core endpoint is currently broken-by-design against the live schema. Deployment-ordering hazard. |
| 3 | **Section 8 cross-system trace never performed** (§8) | The one check that would catch silent four-way disagreement. Blocking on Postgres, not on effort. |
| 4 | **Excel import has no transaction — partial organization writes** (§2) | Silently produces half-populated records that look complete; 1,931 rows already in `errors`. |
| 5 | **Business Intent thresholds (45/25) are an unvalidated judgment call** (§4) | They gate archival. Wrong thresholds → wrong organizations archived. Validate against a real dry-run distribution first. |
| 6 | **Leadership data sparsity (139 rows / 297 orgs) may hard-exclude ~half the dataset** (§1) | If confirmed, the economic-buyer exclusion silently removes most orgs from scoring before any signal is evaluated. Needs a live NULL-rate query. |
| 7 | **ICP run is not atomic across organizations** (§3) | A failed run leaves the dataset scored against two different rule sets, invisibly. |
| 8 | **ICP run has no cache invalidation and no UI trigger** (§6) | Confirmed stale-data path; users act on outdated tiers. |
| 9 | **final_priority mapping is non-total ('Not Scored' unhandled)** (§4, §8) | Latent today, active the moment any org is displayed before being scored. |
| 10 | **Unhandled errors leak internal exception text to clients** (§5) | Information disclosure; will worsen as Prisma column errors start surfacing. |

---

*Audit performed read-only. No file, table, or row was modified. Items marked CANNOT VERIFY
require PostgreSQL to be restored and must be re-run before this report can be considered
complete.*
