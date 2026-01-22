#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { drizzle } from "drizzle-orm/vercel-postgres";
import { createPool } from "@vercel/postgres";
import { migrate } from "drizzle-orm/vercel-postgres/migrator";

const pool = createPool({
  connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL
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
    console.log("检查迁移表...");
    
    await pool.query("CREATE SCHEMA IF NOT EXISTS drizzle");
    await pool.query(
      "CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (id SERIAL PRIMARY KEY, hash TEXT NOT NULL, created_at BIGINT)"
    );

    // 检查是否已有迁移记录
    const existingMigrations = await pool.query(
      "SELECT id FROM drizzle.__drizzle_migrations LIMIT 1"
    );

    // 如果表已存在但无迁移记录，手动插入
    if (existingMigrations.rowCount === 0) {
      const tableExists = await pool.query(
        "SELECT to_regclass('public.model_prices') as exists"
      );
      
      if (tableExists.rows[0]?.exists) {
        console.log("检测到表已存在，标记迁移为已执行...");
        const migrationMeta = getMigrationMeta("./drizzle").filter((meta) =>
          meta.tag.startsWith("0000_")
        );
        if (migrationMeta.length > 0) {
          const values = [];
          const params = [];
          let paramIndex = 1;

          for (const meta of migrationMeta) {
            values.push(`($${paramIndex++}, $${paramIndex++})`);
            params.push(meta.hash, meta.createdAt);
          }

          await pool.query(
            `INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ${values.join(", ")}`,
            params
          );
        }
        console.log("✓ 已标记现有迁移");
        process.exit(0);
      }
    }

    console.log("执行数据库迁移...");
    await migrate(db, { migrationsFolder: "./drizzle" });
    console.log("✓ 迁移完成");
    
    process.exit(0);
  } catch (error) {
    console.error("迁移失败:", error);
    // 不阻止构建继续
    process.exit(0);
  }
}

runMigrations();
