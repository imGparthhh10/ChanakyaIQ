# EIP Pipeline — ARCHIVED, not the active crawler

ESDS Enterprise Intelligence Platform (EIP) web scraping, enrichment, and ICP handoff pipeline.

**Status as of 2026-08-12: archived, not deleted.** `enrichment_pipeline/` (repo root) is the
active crawler — it's the one that's actually been running, and its search-by-company-name
discovery is the only one of the two that can work against this platform's real data (a 2026-08-12
audit found only 3.7% of organizations have a `domain` on file; this package's discovery stage is
domain-based, so it could only ever have attempted that 3.7%).

This package is kept because its LLM-extraction stage (real Anthropic API call, honest
zero-confidence stub when no key is set) and OCR/PDF-text stages are more built-out than
`enrichment_pipeline/`'s extractor, and could be worth reusing later — for orgs that *do* have a
known domain, or if `enrichment_pipeline/`'s extractor ever needs a real LLM pass. It has
essentially never been run for real (one smoke-test row, 2026-08-04, 11ms, no real crawl source).

Do not build new features on this package without first checking with whoever owns the crawler
work — building on two parallel, non-integrated pipelines is exactly what led to this archival.

---

> Full setup, environment variables, per-stage usage, and the optional-dependency capability
> table are being written up as the package is finished — this is a placeholder so the package
> installs cleanly in the meantime. See `pipeline/` for the implementation.
