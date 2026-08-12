#!/usr/bin/env bash
# Compares row counts between the old portable source instance and the
# new Docker postgres container, table by table, for every table that had
# data at the time of the last verification pass. Exits non-zero if any
# count doesn't match -- meant to be a hard gate before decommissioning
# the old instance, not just an FYI.
set -euo pipefail
cd "$(dirname "$0")/.."

PG_BIN="/c/Program Files/PostgreSQL/18/bin"
# The old portable (non-Docker) instance this migrated from -- decommissioned
# after a verified migration. Kept for reference; only reachable if that
# instance is running again (e.g. to re-verify after restoring it from backup).
SOURCE_URL="postgresql://esds_app:devpassword@localhost:5433/esds_eip_dev"

set -a
# shellcheck disable=SC1091
source .env
set +a
TARGET_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@localhost:${POSTGRES_HOST_PORT:-5434}/${POSTGRES_DB}"

TABLES="organizations branches users sessions roles sectors states cities subsectors
addresses leadership leadership_profiles financial_metrics technology_metrics
technology_profiles organization_tags opportunity_tags qualification_results
score_history tier_history metric_definitions score_models score_weights
rule_groups qualification_rules change_history processing_logs job_history
errors business_intent_score_history business_intent_removal_log"

fail=0
printf "%-30s %10s %10s\n" "table" "source" "docker"
for t in $TABLES; do
  src=$("$PG_BIN/psql.exe" "$SOURCE_URL" -tAc "SELECT COUNT(*) FROM $t" 2>/dev/null || echo "ERR")
  dst=$("$PG_BIN/psql.exe" "$TARGET_URL" -tAc "SELECT COUNT(*) FROM $t" 2>/dev/null || echo "ERR")
  mark="OK"
  if [ "$src" != "$dst" ]; then mark="MISMATCH"; fail=1; fi
  printf "%-30s %10s %10s   %s\n" "$t" "$src" "$dst" "$mark"
done

if [ "$fail" = "1" ]; then
  echo "VERIFICATION FAILED -- do not decommission the old instance."
  exit 1
fi
echo "All row counts match."
