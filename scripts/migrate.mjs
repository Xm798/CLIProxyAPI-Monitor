#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { migrate } from "drizzle-orm/node-postgres/migrator";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

const db = drizzle(pool);

function getMigrationMeta(migrationsFolder) {
  const journalPath = `${migrationsFolder}/meta/_journal.json`;
  const journal = JSON.parse(readFileSync(journalPath, "utf8"));

  return journal.entries.map((entry) => {
    const sql = readFileSync(`${migrationsFolder}/${entry.tag}.sql`, "utf8");
    const hash = createHash("sha256").update(sql).digest("hex");

    return {
      tag: entry.tag,
      hash,
      createdAt: entry.when
    };
  });
}

async function runMigrations() {
  try {
    console.log("Checking migration table...");
    
    await pool.query("CREATE SCHEMA IF NOT EXISTS drizzle");
    await pool.query(
      "CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (id SERIAL PRIMARY KEY, hash TEXT NOT NULL, created_at BIGINT)"
    );

    const allMigrations = getMigrationMeta("./drizzle");

    const existingMigrations = await pool.query(
      "SELECT hash, created_at FROM drizzle.__drizzle_migrations"
    );
    const existingHashes = new Set(existingMigrations.rows.map((r) => r.hash));

    const tableExists = await pool.query(
      "SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE c.relname = 'model_prices' AND c.relkind IN ('r','p') LIMIT 1"
    );

    if (tableExists.rows.length > 0) {
      const initialMigration = allMigrations.find((m) => m.tag.startsWith("0000_"));

      if (initialMigration && !existingHashes.has(initialMigration.hash)) {
        console.log("Table exists but migration not marked, marking...");
        await pool.query(
          "INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)",
          [initialMigration.hash, initialMigration.createdAt]
        );
        console.log("✓ Marked initial migration as applied");
      }
    }

    console.log("Running database migrations...");
    await migrate(db, { migrationsFolder: "./drizzle" });
    console.log("✓ Migrations complete");
    
    process.exit(0);
  } catch (error) {
    console.error("Migration failed:", error);
    process.exit(1);
  }
}

runMigrations();
