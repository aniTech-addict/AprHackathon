import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

export const config = {
    port: Number(process.env.PORT || 4000),
    nodeEnv: process.env.NODE_ENV || "development",
    openRouterApiKey: process.env.OPENROUTER_API_KEY || null,
    dbUrl:
        process.env.DATABASE_URL ||
        "postgres://postgres:postgres@localhost:5432/web_researcher",
};
