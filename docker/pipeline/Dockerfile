# Python scraping/enrichment pipeline. Not a persistent server -- a CLI
# tool invoked on demand (see docker-compose.yml's "tools" profile: it
# does not start with `docker compose up`, only via
# `docker compose run pipeline ...`). Core dependencies only by default;
# optional extras (browser/ocr/pdf/lang/translate/llm) install on top of
# this image if/when actually needed -- see pipeline/README.md's
# capability table for what each unlocks.

FROM python:3.12-slim AS base
WORKDIR /app/pipeline

COPY pipeline/pyproject.toml pipeline/README.md ./
COPY pipeline/pipeline ./pipeline
RUN pip install --no-cache-dir .

ENTRYPOINT ["eip-pipeline"]
CMD ["--help"]
