# Build Prompt — Python Enterprise Intelligence Scraper Pipeline

> **Archived 2026-08-12 — do not re-run this prompt.** It produced `pipeline/`, which was
> archived in favor of `enrichment_pipeline/` (see `pipeline/README.md` for why). Running this
> again would create a third, parallel crawler effort — exactly the problem that consolidation
> pass fixed. If `pipeline/`'s domain-based discovery or LLM-extraction stage is ever needed
> again, extend `pipeline/` directly rather than regenerating it from this prompt.

> Paste everything below the line into a fresh Claude Code session opened at the
> `ESDS Dashbord` repo root.

---

## Role & Goal

You are building a **Python 3.11+ web scraping and enrichment pipeline** for the ESDS
Enterprise Intelligence Platform (EIP). The pipeline takes an organization, discovers its
public documents, downloads them, extracts structured intelligence with an LLM, resolves
entities, detects changes over time, and writes everything into the **existing PostgreSQL
database** so the existing dashboard renders it live.

Build it as a new top-level `pipeline/` package. Do **not** modify the frontend. Touch the
Node backend only where explicitly listed.

## What already exists — read before writing code

This is a brownfield repo. The database schema for this entire pipeline **already exists**.
Your job is to fill it, not design it.

- **Database**: PostgreSQL, connection string in `backend/.env` as `DATABASE_URL`
  (`postgresql://esds_app:***@localhost:5433/esds_eip_dev`). Schema is defined by
  `backend/prisma/schema.prisma` and `backend/prisma/eip_schema.sql`. **Read the schema
  first.** Prisma owns migrations — Python must never run DDL, only DML.
- **Tables you will write to** (Prisma model → SQL table):
  `crawl_sources`, `crawl_jobs`, `documents`, `document_versions`, `document_chunks`,
  `translations`, `enrichment_jobs`, `extracted_entities`, `entity_resolutions`,
  `llm_profiles`, `organization_profiles`, `leadership`, `leadership_profiles`,
  `financial_metrics`, `technology_metrics`, `timeline_events`, `contacts`,
  `processing_logs`, `job_history`, `errors`, and the `organizations.status` column.
- **Postgres enums already define the pipeline vocabulary** — use them, do not invent new
  strings. Values must be cast explicitly in SQL (e.g. `%s::document_type`):
  - `document_type`: `Official Website`, `Investor Page`, `Annual Report`, `AGM Report`,
    `Financial Statement`, `News`, `Government Website`, `RBI Publication`,
    `Press Release`, `Social Media`, `Sustainability/CSR`, `Career`, `Other`
  - `document_status`: `DOWNLOADED`, `FAILED`, `RETRYING`, `OCR_PENDING`, `OCR_DONE`, `PROCESSED`
  - `crawl_job_status`: `QUEUED`, `RUNNING`, `SUCCESS`, `FAILED`, `RETRY`
  - `extraction_status`: `PENDING`, `RUNNING`, `PASSED`, `FAILED`, `MANUAL_REVIEW`
  - `org_status`: `NEW` → `DISCOVERING_SOURCES` → `CRAWLING` → `DOCUMENTS_COLLECTED` →
    `OCR_COMPLETE` → `TRANSLATED` → `EXTRACTING` → `ENTITY_RESOLUTION` → `ENRICHED` →
    `ICP_RUNNING` → `QUALIFIED` → `ACTIVE`, plus `REVIEW_QUEUE`, `REJECTED`, `FAILED`.
    **Advance `organizations.status` through these as each stage completes** — this is how
    the dashboard shows live progress.
- **ICP scoring already exists and is not stubbed** — `backend/src/modules/icp/icp.service.ts`
  implements within-sector percentile scoring, weighted `score_weights`, qualification rules,
  tier thresholds (≥90 Strategic, ≥75 Tier 1, ≥60 Tier 2, ≥40 Tier 3, else Watchlist) and
  opportunity tags. **Do not reimplement any of this in Python.** After enrichment, trigger it
  via `POST /api/icp/run` on the Node backend and record the outcome.
- **Existing stubs you are replacing**: `backend/src/modules/crawler/crawler.service.ts` and
  `backend/src/modules/enrichment/enrichment.service.ts` are placeholders that log a WARN
  because Camoufox was never installed. Follow their established convention: an unavailable
  dependency is isolated behind an interface and logged loudly, never silently faked.
- **Environment note**: Python is **not currently installed** on this machine (`python` resolves
  to the Microsoft Store stub). Include exact install/setup steps in the README, and make
  `pipeline/` runnable from a clean venv.

## Non-negotiable rules

1. **Never fabricate data.** If OCR, translation, or the LLM cannot produce a value, write
   `NULL` and route the record to `MANUAL_REVIEW` / `REVIEW_QUEUE`. A missing field is correct;
   an invented one corrupts the dashboard.
2. **Every heavy dependency is optional and lazily imported** (Camoufox, OCR engines, torch,
   IndicTrans2). If a dependency is missing, the stage degrades to a documented no-op that
   marks the document for manual review and writes a `WARN` to `processing_logs` — it must
   never crash the run and never silently pretend to have succeeded.
3. **Idempotent and resumable.** Re-running the pipeline on the same organization must not
   duplicate rows. `documents` has a unique constraint on `(organization_id, checksum)` — use
   it. Unchanged documents are skipped; changed ones create a new `document_versions` row.
4. **Every stage logs.** Write stage transitions to `processing_logs` (organization_id, stage,
   message, level) and each worker run to `job_history`. Exceptions go to `errors` with a stack
   trace. This is the operator's only window into the pipeline.
5. **Be a polite crawler.** Respect `robots.txt`, per-domain rate limiting with jitter,
   configurable concurrency, a real descriptive User-Agent, and exponential backoff. Only
   public sources. No auth walls, no paywalls, no CAPTCHA solving.
6. **Config over hardcoding.** All thresholds, timeouts, retry counts, model names, and paths
   live in a typed settings object loaded from env / `.env`, mirroring `backend/.env`.

## Pipeline stages to implement

Each stage is a module with a single entry function, a typed input, a typed output, and its own
tests. The orchestrator composes them and can run any single stage in isolation.

### 1. Source Discovery Engine → `pipeline/discovery/`
From an organization (name, domain, CIN), discover candidate document URLs and write them to
`crawl_sources` with the right `source_type`. Cover: official site, investor-relations page,
annual report, AGM report, sustainability report, CSR report, press releases, career portal,
news sources, and regulator sources (RBI / SEBI / MCA). Output a deduplicated, prioritized
list of available documents. Discovery is heuristic — score each candidate's confidence and
record how it was found.

### 2. Document Collection → `pipeline/collection/`
Fetch each source through a **Camoufox** browser session (behind a `DocumentFetcher` protocol
so the engine is swappable). Download HTML and PDF. On failure, **retry up to 3 times** with
backoff; if still failing, push to a **failed queue** for later replay — do not lose it.
On success, save the raw file to a content-addressed document repository and record in
`documents` / `document_versions`: storage path, source URL, download date, SHA-256 checksum,
version number, file format, and metadata. Save associated images.

### 3. Document Classification → `pipeline/classification/`
Determine each document's `document_type` from URL patterns, page structure, title, and content
signals. Must map onto the existing `document_type` enum exactly. Emit a confidence; low
confidence goes to review rather than a wrong label.

### 4. Document Processing → `pipeline/processing/`
- Detect whether the PDF is **scanned** (set `documents.is_scanned`).
- Scanned → **OCR extraction**; native → **direct text extraction**.
- **Language detection** → set `documents.detected_language`.
- Regional Indian language → translate via **IndicTrans2**, storing source language, engine, and
  output in `translations`. English → pass through.
- **Text cleaning**: header/footer removal, duplicate-block removal, whitespace/hyphenation repair.
- **Quality validation**: if too little usable text was extracted, route to manual review instead
  of feeding garbage downstream.
- **Chunk** the cleaned text into `document_chunks` with `chunk_index` and `token_count`,
  respecting the unique `(document_id, chunk_index)` constraint.

### 5. LLM Extraction Engine → `pipeline/extraction/`
Use the **Anthropic Claude API** (`anthropic` SDK; default model `claude-sonnet-5`). Create an
`enrichment_jobs` row per run and store the raw response in `raw_response_json`, the validated
profile in `llm_profiles.profile_json`, and a `confidence_score`.

Extract, as a **strictly validated JSON schema** (Pydantic): company profile, revenue, net
profit, assets, branches, employees, headquarters, CEO, CIO, CTO, CISO, board members, products,
services, technology stack, AI projects, cloud projects, cybersecurity, digital initiatives,
awards, partnerships, certifications, hiring signals, and contact details.

Every extracted field must carry a **source citation** (document id + chunk index) and a
per-field confidence. On JSON validation failure, retry with the validation error fed back to
the model; after the retry budget, set the job to `MANUAL_REVIEW`. Use prompt caching for the
long document context and version your prompts in `prompt_version`.

### 6. Entity Resolution → `pipeline/resolution/`
Write raw extractions to `extracted_entities` (type, value, normalized value, confidence), then
normalize and merge: company names (strip suffixes, alias table), people, locations,
technologies, products, vendors, cloud providers. Link resolved entities to canonical
organizations via `entity_resolutions`, recording the `resolution_method`. Use the existing
`organization_aliases` table and the DB's trigram index on `organizations.legal_name` for
fuzzy candidate lookup.

### 7. Timeline Engine → `pipeline/timeline/`
Diff the newly extracted profile against the organization's stored profile and emit
`timeline_events` (event type, summary, date, `old_value`, `new_value`, source document,
confidence) for: revenue change, CEO change, technology change, cloud adoption, new partnership,
new award, expansion, hiring spike, and AI initiative. Only emit an event on a **material**
change — define and document the thresholds. No diff means no event.

### 8. Organization Profile Update → `pipeline/profile/`
Merge validated results into the master organization record: `organization_profiles`,
`leadership` + `leadership_profiles`, `financial_metrics`, `technology_metrics`, `contacts`, and
`addresses`. Merge policy: higher-confidence and more-recent data wins; log every field change to
`change_history`. If overall confidence is **below the configured threshold**, set status to
`REVIEW_QUEUE` instead of overwriting good data. Otherwise mark the record complete.

### 9. ICP Match & Dashboard Handoff → `pipeline/icp/`
Set status to `ICP_RUNNING`, call the backend's existing `POST /api/icp/run`, then read back the
resulting `icp_score`, `opportunity_tier`, qualification result, and tags. Set the final status to
`QUALIFIED` / `ACTIVE` / `REJECTED` accordingly so the live dashboard reflects it immediately.

## Orchestration

- A CLI: run the full pipeline for one org, a batch of orgs, or a single named stage; re-run
  failed stages; replay the failed queue; show pipeline status.
- Concurrency across organizations with a bounded worker pool; per-domain rate limits enforced
  globally.
- Graceful shutdown that leaves no job stuck in `RUNNING`.
- Structured logging to stdout **and** to the database tables above.

## Tech choices

- Python 3.11+, `pyproject.toml`, `ruff` + `mypy` clean, `pytest`.
- DB access via `psycopg` (v3) with an explicit repository layer and parameterized SQL. **No
  second ORM** — Prisma remains the schema owner; Python only reads and writes rows.
- `pydantic-settings` for config, `pydantic` for all stage contracts.
- `httpx` for plain HTTP, Camoufox only where browser rendering is actually needed.
- Tests must run **without** network, without a browser, and without the optional ML
  dependencies — fixtures and fakes for all of it. Include at least one end-to-end test that
  runs the whole pipeline against a temp schema with a fake fetcher and a fake LLM client.

## Deliverables

1. The `pipeline/` package implementing stages 1–9 plus the orchestrator and CLI.
2. `pipeline/README.md`: setup from zero (including installing Python on Windows), env vars,
   how to run each stage, and a table of which optional dependencies unlock which capability.
3. Tests as described above.
4. A short note listing every place you had to make a judgment call the spec did not settle.

## Acceptance criteria

- `pipeline` runs end-to-end for one organization on a clean venv with **only** the core
  dependencies installed — degrading loudly, not crashing, wherever an optional dependency is
  absent.
- Running it twice produces no duplicate rows.
- `organizations.status` visibly advances through the `org_status` values during a run.
- Every populated field is traceable to a source document.
- Nothing anywhere fabricates a value to fill a gap.

## Working style

Read the Prisma schema and the existing `icp.service.ts`, `crawler.service.ts`, and
`enrichment.service.ts` before designing anything. Build stage by stage, in order, verifying each
against the real database before moving on. If a requirement conflicts with the existing schema,
stop and flag it rather than silently reshaping the data.
