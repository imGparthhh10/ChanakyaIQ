# EIP Backend

Node/Express/Prisma/PostgreSQL backend for the ESDS Executive Intelligence Platform. Sits behind the existing static frontend (`../index.html`, `../assets/`) — see `../assets/js/data/data.js` for the integration point.

## Local dev setup

This machine has no admin rights available, so Node.js and PostgreSQL run as **portable, non-service installs** under `%USERPROFILE%\.eip-tools\` rather than via the normal Windows installers. If you're setting this up fresh with admin rights available, a normal `winget install OpenJS.NodeJS` / `winget install PostgreSQL.PostgreSQL.18` (or Docker, via `docker-compose.yml` in this folder) works just as well — nothing here is portable-install-specific except the exact paths below.

```
%USERPROFILE%\.eip-tools\node\      — Node.js 24 LTS (portable zip build)
%USERPROFILE%\.eip-tools\pgsql\     — PostgreSQL 18.4 (portable binaries)
%USERPROFILE%\.eip-tools\pgdata\    — the actual database files
```

### Start Postgres (if not already running)

```
"%USERPROFILE%\.eip-tools\pgsql\bin\pg_ctl.exe" -D "%USERPROFILE%\.eip-tools\pgdata" -l "%USERPROFILE%\.eip-tools\pgdata\server.log" -o "-p 5433" start
```

Dev database: `esds_eip_dev`, role `esds_app` / `devpassword` (see `.env`). Trust auth is configured for local connections — the password in `.env` is a placeholder for connection-string shape, not a real credential boundary.

### Install & run

```
npm install
npm run dev              # starts on http://localhost:4000, GET /api/health
```

### Migrations (already applied — for reference)

```
psql -p 5433 -U esds_app -d esds_eip_dev -f prisma/eip_schema.sql   # source of truth, applied once
npx prisma db pull                                                    # introspect (already done + hand-cleaned)
npx prisma generate
npx prisma migrate resolve --applied 0_init                          # baseline, already done
```

`eip_schema.sql` is never hand-edited. Any real schema gap found later becomes a new additive migration file under `prisma/migrations/`, not an edit to that file.

### Run the Excel import

```
npm run import:excel
```

Reads the 5 files in `../data/*.xlsx` directly (no upload needed for local runs), reusing `assets/js/data/parser.js`/`validator.js`/`branches.js` unmodified. Prints a JSON summary: rows read, created/updated/failed counts.

### Run ICP scoring

```
curl -X POST http://localhost:4000/api/icp/run
```

## Frontend integration

`assets/js/data/data.js` has a `USE_LEGACY_EXCEL_PIPELINE` flag (currently `false`). With it `false`, the dashboard fetches from this backend (`GET /organizations`, `GET /branches`) instead of parsing Excel in-browser. Flip it to `true` to instantly roll back to the original Excel pipeline — nothing in `excel.js`/`parser.js`/`validator.js`/`branches.js`/`karnataka.js`/`gujarat.js` has been deleted.

## Known field gaps

The dashboard's legacy record shape has ~50 fields; `eip_schema.sql` doesn't have a column for all of them. `organizations.mapper.ts` documents this — fields like `painPoints`, `techStack`, `notes`, `corePlatform`, `esdsFitNotes`, `verificationSources`, `recommendedProducts`, `businessJustification`, `regulatoryNotes`, `customerBase`, `stockSymbol`, `parentCompany`, `marketCapDate`, `sourceAsOfDate`, `countryOfOrigin`, `formOfPresence` currently come back `null` from the API — there's no home for them in the schema as given. Flagged, not silently dropped.

`fiscal_year` is written as `NULL` for every imported financial/technology metric — `parser.js`'s canonical output discards the source column header (e.g. `"Revenue / Total Income (FY26)"`) before the import job ever sees it, so the FY tag isn't recoverable without a deeper change to `parser.js` than the additive `export` already made on `normalizeCategory`.

`GET /branches` is leaner than the old browser-side `branches.js` aggregator's output — the schema's `branches` table has no IFSC code or per-district breakdown columns, so those fields aren't in the API response.

**Known pre-existing data-quality issues, faithfully reproduced (not introduced by this backend):**
- 1,931 of 5,051 branch rows in the source Excel couldn't be matched to a parent company (e.g. all of Axis Bank's branches) — those parent companies never appear as entity-level rows under a header `parser.js` recognizes anywhere in the 5 files. Logged to the `errors` table, not silently dropped.
- At least one company-level row is really a documentation footnote ("Bank Name" search result) that slipped through because `parser.js` only requires a non-blank name column — this mirrors a bug already flagged during an earlier data-classification audit of the same source files (Categories A/B in that audit), not something new.

## ICP scoring design notes

`eip_schema.sql`'s seeded `score_weights` rows have `metric_id = NULL` for all 7 components (the seed `INSERT` only sets `component_name`/`weight_pct`) — there's no formal link from a weight component to a metric. `icp.service.ts` resolves 5 of the 7 components (Revenue, IT Spend, Cloud Spend, Cybersecurity, Net Profit) to their `metric_key` itself; "Organization Scale" and "Leadership" have no numeric metric equivalent in the imported data and use documented heuristics (employee/branch-count percentile; leadership-field-fill-rate). Sub-scores are percentile ranks within the actual imported population (self-calibrating, no fabricated ceilings). Tier thresholds (Strategic ≥80, Tier 1 ≥60, Tier 2 ≥40, Tier 3 ≥20, else Watchlist) are this service's own default, not specified anywhere in the original spec — trivial to change in `icp.service.ts`, nothing downstream hardcodes them.

## Deferred scope (flagged, not silent)

- **Auth**: every endpoint is unauthenticated for local dev (`// TODO: auth` markers in `security.repository.ts`) — nothing in the required endpoint list needs it yet.
- **BullMQ/Redis**: not installed; `/crawl`, `/enrich`, `/icp/run` run in-process. `job_history` is the job ledger.
- **Crawler/Enrichment**: real Camoufox/LLM integration isn't wired up (matches the project's own "Phase 5/6 — Queued" roadmap in `PRESENTATION_BRIEF.md`). Both are isolated behind a one-method interface (`DocumentFetcher`, `EnrichmentEngine`) so swapping in a real implementation is a one-file change.
