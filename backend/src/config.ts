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
    llmProvider: (process.env.LLM_PROVIDER || "openrouter").toLowerCase(),
    searchProvider: (process.env.SEARCH_PROVIDER || "legacy").toLowerCase(),
    openRouterApiKey: process.env.OPENROUTER_API_KEY || null,
    openRouterModel: process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini",
    groqApiKey: process.env.GROQ_API_KEY || null,
    groqModel: process.env.GROQ_MODEL || "openai/gpt-oss-20b",
    groqApiBaseUrl: process.env.GROQ_API_BASE_URL || "https://api.groq.com/openai/v1/chat/completions",
    grokApiKey: process.env.GROK_API_KEY || null,
    grokModel: process.env.GROK_MODEL || "grok-3-mini",
    tavilyApiKey: process.env.TAVILY_API_KEY || null,
    tavilySearchDepth: process.env.TAVILY_SEARCH_DEPTH || "advanced",
    tavilyMaxResults: Number(process.env.TAVILY_MAX_RESULTS || 8),
    tavilySearchTimeoutMs: Number(process.env.TAVILY_SEARCH_TIMEOUT_MS || 14000),
    tavilyExtractTimeoutMs: Number(process.env.TAVILY_EXTRACT_TIMEOUT_MS || 12000),
    tavilyIncludeAnswer: (process.env.TAVILY_INCLUDE_ANSWER || "false").toLowerCase() === "true",
    dbUrl: envDatabaseUrl || hardcodedLocalDbUrl,
};
