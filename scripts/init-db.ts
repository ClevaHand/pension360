import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { Pool } from "pg";

dotenv.config();

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.log("No DATABASE_URL set. Skipping schema init (app will use in-memory store).");
    process.exit(0);
  }

  const pool = new Pool({ connectionString: url });
  try {
    await pool.query("SELECT 1");
    try {
      await pool.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto"');
    } catch {
      console.warn("Could not create pgcrypto extension (may need superuser). UUID defaults may still work.");
    }
    const schemaPath = path.resolve(__dirname, "../db/schema.sql");
    const sql = fs.readFileSync(schemaPath, "utf8");
    await pool.query(sql);
    console.log("Database schema applied successfully.");
  } catch (err) {
    console.error("Failed to initialize database:", (err as Error).message);
    console.error("The app can still run in in-memory mode if Postgres is unavailable.");
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
