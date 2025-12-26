#!/usr/bin/env bash
set -euo pipefail

# Initialize additional databases for test isolation
for db in live_state_e2e_test live_state_query_engine_test; do
  exists=$(psql -tAc "SELECT 1 FROM pg_database WHERE datname='${db}'" --username "$POSTGRES_USER" --dbname "$POSTGRES_DB")
  if [ "$exists" != "1" ]; then
    createdb --username "$POSTGRES_USER" "$db"
  fi
done

