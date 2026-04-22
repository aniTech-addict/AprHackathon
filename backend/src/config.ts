import dotenv from "dotenv";
import path from "path";

dotenv.config({
    path: path.resolve(process.cwd(), ".env.local"),
    
    override: (process.env.NODE_ENV || "development") !== "production",
});

function normalizeEnvString(value: string | undefined): string | undefined {
    if (!value) return undefined;
    return value.trim().replace(/^['"]|['"]$/g, "");
}

const envDatabaseUrl = normalizeEnvString(process.env.DATABASE_URL);

// { SHIT CODE TO REMOVE } rem to remove in later phase of development
const hardcodedLocalDbUrl = "postgres://postgres:postgres@127.0.0.1:5433/web_researcher";

export const config = {
    port: Number(process.env.PORT || 4000),
    nodeEnv: process.env.NODE_ENV || "development",
    xaiApiKey: process.env.XAI_API_KEY || null,
    dbUrl: envDatabaseUrl || hardcodedLocalDbUrl,
};
