import { Pool } from "pg";
import { config } from "./config";

export const pool = new Pool({
  connectionString: config.dbUrl,
});

export async function checkDatabaseConnection(): Promise<void> {
  await pool.query("SELECT 1");
}
