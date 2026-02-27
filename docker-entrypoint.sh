#!/bin/sh
set -e

# Wait for database to be reachable (useful when running outside compose)
MAX_RETRIES=30
RETRY_INTERVAL=2
for i in $(seq 1 $MAX_RETRIES); do
  if node --input-type=commonjs -e "
    const pg = require('pg');
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    pool.query('SELECT 1').then(() => { pool.end(); process.exit(0); }).catch(() => { pool.end(); process.exit(1); });
  " 2>/dev/null; then
    break
  fi
  if [ "$i" = "$MAX_RETRIES" ]; then
    echo "ERROR: Could not connect to database after ${MAX_RETRIES} attempts"
    exit 1
  fi
  echo "Waiting for database... (attempt $i/$MAX_RETRIES)"
  sleep $RETRY_INTERVAL
done

echo "Running database migrations..."
node scripts/migrate.mjs

echo "Starting Next.js server..."
exec node server.js
