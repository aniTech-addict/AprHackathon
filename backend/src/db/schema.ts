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

    CREATE TABLE IF NOT EXISTS research_plans (
      id UUID PRIMARY KEY,
      session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      total_pages INT NOT NULL,
      structure JSONB NOT NULL,
      plan_markdown TEXT NOT NULL,
      search_queries JSONB NOT NULL DEFAULT '[]'::jsonb,
      status TEXT NOT NULL DEFAULT 'pending_approval',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_research_plans_session_id ON research_plans (session_id);

    CREATE TABLE IF NOT EXISTS segments (
      id UUID PRIMARY KEY,
      session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      research_plan_id UUID NOT NULL REFERENCES research_plans(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      topic TEXT NOT NULL,
      segment_order INT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_segments_session_id ON segments (session_id);
    CREATE INDEX IF NOT EXISTS idx_segments_plan_id ON segments (research_plan_id);

    CREATE TABLE IF NOT EXISTS review_paragraphs (
      id UUID PRIMARY KEY,
      session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      plan_id UUID NOT NULL REFERENCES research_plans(id) ON DELETE CASCADE,
      paragraph_order INT NOT NULL,
      segment_title TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (plan_id, paragraph_order)
    );

    ALTER TABLE review_paragraphs
      ADD COLUMN IF NOT EXISTS segment_order INT NOT NULL DEFAULT 1;

    ALTER TABLE review_paragraphs
      ADD COLUMN IF NOT EXISTS paragraph_index INT NOT NULL DEFAULT 1;

    ALTER TABLE review_paragraphs
      ADD COLUMN IF NOT EXISTS previous_content TEXT;

    ALTER TABLE review_paragraphs
      ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending_review';

    ALTER TABLE review_paragraphs
      ADD COLUMN IF NOT EXISTS last_edited_by TEXT;

    ALTER TABLE review_paragraphs
      ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;

    ALTER TABLE review_paragraphs
      DROP CONSTRAINT IF EXISTS review_paragraphs_status_check;

    ALTER TABLE review_paragraphs
      ADD CONSTRAINT review_paragraphs_status_check
      CHECK (status IN ('pending_review', 'approved', 'deleted'));

    ALTER TABLE review_paragraphs
      DROP CONSTRAINT IF EXISTS review_paragraphs_last_edited_by_check;

    ALTER TABLE review_paragraphs
      ADD CONSTRAINT review_paragraphs_last_edited_by_check
      CHECK (last_edited_by IS NULL OR last_edited_by IN ('manual', 'ai'));

    CREATE INDEX IF NOT EXISTS idx_review_paragraphs_session_id ON review_paragraphs (session_id);
    CREATE INDEX IF NOT EXISTS idx_review_paragraphs_plan_id ON review_paragraphs (plan_id);

    CREATE TABLE IF NOT EXISTS review_sources (
      id UUID PRIMARY KEY,
      paragraph_id UUID NOT NULL REFERENCES review_paragraphs(id) ON DELETE CASCADE,
      source_order INT NOT NULL,
      title TEXT NOT NULL,
      url TEXT NOT NULL,
      excerpt TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (paragraph_id, source_order)
    );

    CREATE INDEX IF NOT EXISTS idx_review_sources_paragraph_id ON review_sources (paragraph_id);

    CREATE TABLE IF NOT EXISTS review_page_approvals (
      id UUID PRIMARY KEY,
      session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      plan_id UUID NOT NULL REFERENCES research_plans(id) ON DELETE CASCADE,
      segment_order INT NOT NULL,
      approved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (session_id, plan_id, segment_order)
    );

    CREATE INDEX IF NOT EXISTS idx_review_page_approvals_plan_id
      ON review_page_approvals (plan_id, segment_order);
  `);
}

