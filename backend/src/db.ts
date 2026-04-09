import { Pool } from "pg";
import { config } from "./config";

function validateDatabaseUrl(connectionString: string): void {
  try {
    const parsed = new URL(connectionString);
    const isPostgresProtocol =
      parsed.protocol === "postgres:" || parsed.protocol === "postgresql:";

    if (!isPostgresProtocol) {
      console.error(
        `[db] Unexpected DATABASE_URL protocol '${parsed.protocol}'. Expected postgres:// or postgresql://`
      );
      return;
    }

    if (!parsed.password) {
      throw new Error(
        "DATABASE_URL is missing a password. Use format postgres://user:password@host:port/dbname"
      );
    }
  } catch (error) {
    const details =
      error instanceof Error ? error.message : "Invalid DATABASE_URL value";
    throw new Error(`[db] ${details}`);
  }
}

validateDatabaseUrl(config.dbUrl);

export const pool = new Pool({
  connectionString: config.dbUrl,
});

export async function checkDatabaseConnection(): Promise<void> {
  await pool.query("SELECT 1");
}
