#!/usr/bin/env bash
# Migrates real data from the old portable (non-Docker) Postgres instance
# into the Docker Compose "postgres" service. Safe to re-run: it always
# restores into a completely fresh, empty database inside the container
# (never touches the source instance beyond reading from it).
#
# Usage:
#   ./scripts/migrate-data.sh                      # dump the live source + restore
#   ./scripts/migrate-data.sh backups/some.dump     # restore an existing dump instead
set -euo pipefail
cd "$(dirname "$0")/.."

PG_BIN="/c/Program Files/PostgreSQL/18/bin"
# The old portable (non-Docker) instance this migrated from -- decommissioned
# after a verified migration (see verify-migration.sh). Kept here for
# reference/reproducibility; only reachable if that instance is running again.
SOURCE_URL="postgresql://esds_app:devpassword@localhost:5433/esds_eip_dev"
DUMP_FILE="${1:-}"

if [ -z "$DUMP_FILE" ]; then
  mkdir -p backups
  TIMESTAMP=$(date +%Y%m%d_%H%M%S)
  DUMP_FILE="backups/esds_eip_dev_${TIMESTAMP}.dump"
  echo "==> Dumping source database ($SOURCE_URL) to $DUMP_FILE"
  "$PG_BIN/pg_dump.exe" "$SOURCE_URL" -Fc -f "$DUMP_FILE"
else
  echo "==> Using existing dump: $DUMP_FILE"
fi

echo "==> Starting the postgres container (fresh volume if this is the first run)"
docker compose up -d postgres
echo "==> Waiting for postgres to be healthy..."
until [ "$(docker inspect -f '{{.State.Health.Status}}' "$(docker compose ps -q postgres)")" = "healthy" ]; do
  sleep 2
done

set -a
# shellcheck disable=SC1091
source .env
set +a

TARGET_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@localhost:${POSTGRES_HOST_PORT:-5434}/${POSTGRES_DB}"

echo "==> Restoring $DUMP_FILE into the container"
"$PG_BIN/pg_restore.exe" -d "$TARGET_URL" --no-owner --no-privileges -v "$DUMP_FILE"

echo "==> Done. Run scripts/verify-migration.sh to confirm row counts match."
