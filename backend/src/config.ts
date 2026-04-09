import dotenv from "dotenv";
import path from "path";

dotenv.config({
    path: path.resolve(process.cwd(), ".env.local"),
    // In local development, prefer repo .env.local over machine-level inherited vars.
    override: (process.env.NODE_ENV || "development") !== "production",
});

function normalizeEnvString(value: string | undefined): string | undefined {
    if (!value) return undefined;
    return value.trim().replace(/^['"]|['"]$/g, "");
}

const envDatabaseUrl = normalizeEnvString(process.env.DATABASE_URL);

export const config = {
    port: Number(process.env.PORT || 4000),
    nodeEnv: process.env.NODE_ENV || "development",
    openRouterApiKey: process.env.OPENROUTER_API_KEY || null,
    dbUrl:
        envDatabaseUrl ||
        "postgres://postgres:postgres@localhost:5432/web_researcher",
};
