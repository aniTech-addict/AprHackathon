import { pool } from "../db";

export async function ensureCoreSchema(): Promise<void> {
  await pool.query(`
    CREATE EXTENSION IF NOT EXISTS vector;

    CREATE TABLE IF NOT EXISTS sessions (
      id UUID PRIMARY KEY,
      topic TEXT NOT NULL,
      raw_input TEXT NOT NULL,
      input_category TEXT NOT NULL CHECK (input_category IN ('descriptive', 'vague')),
      status TEXT NOT NULL DEFAULT 'input_categorized',
      user_background TEXT,
      research_goal TEXT,
      source_preferences JSONB NOT NULL DEFAULT '[]'::jsonb,
      preferred_sites JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_created_at ON sessions (created_at DESC);
  `);
}
