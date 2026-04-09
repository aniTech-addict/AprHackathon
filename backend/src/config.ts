import dotenv from "dotenv";

dotenv.config({path:"../.env.local"});

export const config = {
    port: Number(process.env.PORT || 4000),
    nodeEnv: process.env.NODE_ENV || "development",
    openRouterApiKey: process.env.OPENROUTER_API_KEY || null,
    dbUrl:
        process.env.DATABASE_URL ||
        "postgres://postgres:postgres@localhost:5432/web_researcher",
};
