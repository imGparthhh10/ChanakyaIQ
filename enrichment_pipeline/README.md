# Enrichment Pipeline

A containerized pipeline that enriches a list of companies or banks with
**real, sourced** financial and IT-spend disclosures -- revenue (India or
state-specific only, never global), IT / Data Centre / Cybersecurity /
Cloud / Digital CapEx spend, financial year, report name, source URL, and
page number. Every value is either backed by a real fetched source or
written as `"N/A"`. Nothing is fabricated, estimated, or simulated.

Ships pre-loaded with the RBI's list of 1,377 Non-Scheduled Urban
Co-operative Banks (`data/input/non_scheduled_urban_coop_banks.csv`) as
the seed input, ready to run.

## Architecture

Eight independent containers, each its own Dockerfile, communicating
**only** through Redis Streams -- no service ever calls another
service's code or HTTP API directly:

```
seed_loader --> [crawl-jobs] --> crawler --> [translate-jobs] --> translator
                                                                        |
                                                                        v
write-jobs <-- icp_scorer <-- [score-jobs] <-- extractor <-- [extract-jobs]
    |
    v
db_writer --> Postgres + enriched .xlsx

icp_scorer also writes disqualified records to [rejected]
every stage publishes structured events to [logs]
logger consumes [logs] + [rejected] -> data/logs/audit_log.jsonl
orchestrator watches every stream's pending-entries list, requeues
  stuck jobs up to a retry budget, then dead-letters them -- never
  blocking the rest of the run
```

| Stream | Producer | Consumer |
|---|---|---|
| `crawl-jobs` | seed_loader | crawler |
| `translate-jobs` | crawler | translator |
| `extract-jobs` | translator | extractor |
| `score-jobs` | extractor | icp_scorer |
| `write-jobs` | icp_scorer (qualified) | db_writer |
| `rejected` | icp_scorer (disqualified) | logger |
| `logs` | every service | logger |
| `dead-letter` | orchestrator | logger (audit only) |

## Running it

```bash
cp .env.example .env        # edit POSTGRES_PASSWORD at minimum
docker compose up --build
```

- **Input**: drop any `.csv` or `.xlsx` file (columns: a name column --
  `bank_name`/`company_name`/`name` -- and a `state` column) into
  `data/input/`. Everything found there is loaded on startup. The RBI
  co-op bank list is already there.
- **Output**:
  - Postgres table `enriched_entities` (connect on `localhost:${POSTGRES_HOST_PORT}`,
    default `5544`).
  - `data/output/*_enriched_<timestamp>.xlsx` -- if `data/input/` contains
    exactly one `.xlsx`, its original formatting/formulas/merged
    cells/filters/hidden sheets are preserved and a new "Enriched Data"
    sheet is added; the original file itself is never modified. With
    only the shipped CSV present, a fresh workbook is created instead.
- **Logs**: `docker compose logs -f logger` is the single, human-readable,
  centralized feed of the entire run (every stage's events + every
  rejection reason). The same data is persisted to
  `data/logs/audit_log.jsonl` (one JSON object per line) so it survives
  restarts and is `grep`/`jq`-able after the fact.
- **Health**: `curl http://localhost:8080/status` (orchestrator) returns
  queue depth + pending count per stage, cumulative requeue/dead-letter
  counts, and the current retry configuration.
- Stop everything: `docker compose down` (add `-v` to also delete the
  Postgres volume).

`seed_loader` is one-shot (`restart: "no"`) -- it loads the input files,
pushes jobs, and exits; `crawler` won't start until it has exited
successfully (`depends_on: condition: service_completed_successfully`).
Every other service runs continuously (`restart: unless-stopped`) and
just idles, blocked on its Redis read, once its queue is empty.

## Reliability model

- **A bad job never crashes a container.** Every consumer loop wraps
  per-message handling in `try/except`; a malformed payload is dead-lettered
  and acked immediately (it can never succeed on retry), while an
  unexpected processing failure is logged and the message is left
  **un-acked** -- deliberately, so the orchestrator's sweep can find and
  retry it.
- **Stuck jobs never block the pipeline.** The orchestrator (`services/orchestrator/monitor.py`)
  periodically scans every stream's consumer-group pending-entries list.
  A message idle longer than `ORCH_STUCK_IDLE_MS` (default 2 minutes) is
  requeued (re-published fresh, with an internal retry counter carried in
  the payload) up to `ORCH_MAX_RETRIES` times, then moved to the
  `dead-letter` stream and acked off the original queue -- the rest of
  the run never waits on it.
- **"Found nothing" still flows through.** If the crawler can't find
  anything for an entity after trying every search-priority tier, it
  still publishes a payload (`found_nothing=true`, zero documents) rather
  than dropping the entity. Every field downstream stays `"N/A"`. In
  practice such entities score 0 in icp_scorer and end up in `rejected`
  with a clear reason -- they're accounted for, not silently lost.

## Design decisions (and why)

**Search discovery doesn't scrape Google's results page.** Automated
scraping of Google's own SERP violates Google's Terms of Service and gets
blocked quickly regardless of stealth tooling. `services/crawler/search.py`
instead tries, in order: Google's own **sanctioned** Programmable Search
Engine JSON API (if `GOOGLE_CSE_API_KEY`/`GOOGLE_CSE_ID` are set --
this literally *is* Google search, used the way Google intends automated
callers to use it), then Microsoft's official Bing Web Search API (if
`BING_SEARCH_API_KEY` is set), and falls back to DuckDuckGo's HTML-lite
endpoint (no key required) so the pipeline runs out of the box with zero
paid dependencies. All three are real, working search against real
engines -- never mocked.

**Extraction is rule-based (regex/keyword), not an LLM**, matching the
same "auditable, reproducible, config-driven" principle the spec
explicitly requires for `icp_scorer` -- applied consistently to
`extractor` too. Every value written to the database traces back to an
exact matched snippet of real source text (see `raw_snippet` in
`enriched_entities`). This is a real limitation compared to an
LLM-assisted extractor: phrasing the regex/keyword lists didn't
anticipate will be missed, and a missed field is honestly written as
`"N/A"` rather than guessed.

**PDF page-number tracking lives in `translator`, not `extractor`.**
`translator` extracts PDF text page-by-page (via `pdfplumber`) so it can
translate (or pass through) each page independently; that per-page
breakdown is exactly what's needed to cite a page number later, so it's
carried forward on `TranslatedDocument.pages` rather than re-parsed by
`extractor`. `extractor` still does all the actual field-extraction work
and page-number citation -- it just consumes already-paginated,
already-English text instead of opening the PDF a second time. This also
means every extraction regex only ever has to match English phrasing,
never every regional language's own keyword variants.

**Translation (IndicTrans2) is large and can be disabled.** The
`ai4bharat/indictrans2-indic-en-1B` model is ~1B parameters; the first
real translation in a run downloads several GB from HuggingFace and needs
meaningful RAM. If that's not available in your environment, set
`TRANSLATION_ENABLED=false` in `.env` -- non-English content then flows
through untranslated (honestly logged), and extractor simply finds fewer
matches on it rather than the container crashing. The download is cached
in a named volume (`enrichment_indictrans_cache`) so it only happens once
across restarts.

**Money amounts are normalized to INR Crore**, the unit Indian financial
disclosures conventionally use and what `icp_scorer`'s thresholds are
expressed in.

**Revenue is never written unless it's explicitly India- or
state-scoped.** `services/extractor/fields.py::find_scoped_money` actively
rejects any match sitting next to "global"/"worldwide"/"consolidated
worldwide" and requires an explicit "India"/state-name marker nearby;
absent that, revenue stays `"N/A"` even if a number was found near a
revenue keyword. This is the literal, non-negotiable "never global"
requirement.

**Fuzzy "is this evidence really about this entity" check** (`db_writer/validators.py::entity_confirmed_in_evidence`)
checks that at least one of the entity's distinctive name tokens (bank
name minus generic words like "bank"/"urban"/"co-operative") appears in
the captured snippet, report title, or source URL -- catching "found a
number, but on someone else's page." `state_match` cross-checks a state
`extractor` independently detects from the citation text (`detected_state`)
against the seed's state, catching the same-named-entity-in-a-different-state
failure mode.

**ICP scoring config**: `services/icp_scorer/config/scoring_rules.yaml`.
Edit the point weights, the qualification threshold, or
`minimum_revenue_inr_cr` there and restart `icp_scorer` -- no code
changes needed. Default rules and points (out of 100, qualifies at
>= 40): any real IT/Cybersecurity/Cloud/DataCentre/DigitalCapex spend
disclosed (30), revenue disclosed and properly scoped (20), revenue above
the configured minimum (15), no incumbent cloud/DR/cybersecurity vendor
mentioned (15), state on file (10), any branch/employee scale signal (10).

**Duplicate prevention**: the Postgres `entity_id` primary key makes
"same entity written twice" durable across restarts (upserted only if
`OVERWRITE_EXISTING=true`, otherwise skipped with a logged reason). A
second, softer in-run check flags "two *different* entities produced
identical sourced values" (same source URL + revenue + IT spend) as a
likely crawl mistake (generic/wrong page) and rejects the second one with
a logged reason, rather than writing suspicious duplicate data.

## Scaling

Every consumer group supports multiple consumers safely (Redis Streams'
consumer-group semantics guarantee each message goes to exactly one
consumer in the group). To run more crawler workers in parallel:

```bash
docker compose up --build --scale crawler=3
```

The same applies to any other stage. `crawler`'s own internal 10-concurrent-tab
cap (`asyncio.Semaphore(10)`) is per-container, so 3 crawler replicas
means up to 30 concurrent tabs total across the run.

## Repository layout

```
enrichment_pipeline/
├── docker-compose.yml
├── .env.example
├── shared/                  # imported by every service (COPYed into each image)
│   ├── models.py            # pydantic job-payload schemas for every stream
│   ├── queue_client.py      # Redis Streams wrapper (publish/read_group/ack/dead_letter/autoclaim)
│   └── logging_events.py    # stdout + centralized `logs` stream logging in one call
├── services/
│   ├── seed_loader/         # one-shot: data/input/* -> crawl-jobs
│   ├── crawler/              # Camoufox, search discovery, source-priority crawl -> translate-jobs
│   ├── translator/           # langdetect + IndicTrans2, per-page PDF text -> extract-jobs
│   ├── extractor/             # regex/keyword field extraction -> score-jobs
│   ├── icp_scorer/            # configurable rule-based scoring -> write-jobs / rejected
│   ├── db_writer/              # validation + dedup + Postgres + enriched .xlsx
│   ├── logger/                 # logs + rejected -> data/logs/audit_log.jsonl
│   └── orchestrator/           # stuck-job sweep + /status endpoint
└── data/
    ├── input/                # drop your .csv/.xlsx here (seed CSV already included)
    ├── raw/                  # crawler-fetched PDFs (shared with translator)
    ├── output/                # enriched .xlsx lands here
    └── logs/                  # audit_log.jsonl lands here
```

## Local (non-Docker) development

Every service is a plain Python 3.12 script with its own `requirements.txt`.
To run one locally against a Dockerized Redis/Postgres:

```bash
docker compose up -d redis postgres
cd services/extractor
pip install -r requirements.txt
REDIS_URL=redis://localhost:6379/0 python main.py
```

(`sys.path.insert` in every `main.py` locates `shared/` two directories
up, so this works without installing `shared` as a package.)
