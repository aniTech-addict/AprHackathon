/**
 * Stores each research session in database
 * functions name are descritvie enough
 */


import { pool } from "../db";
import { InputCategory } from "../services/inputClassifier";

export interface SessionRecord {
  id: string;
  topic: string;
  rawInput: string;
  inputCategory: InputCategory;
  preferredSites: string[];
}

export interface ClarityData {
  userBackground: "researcher" | "student" | "teacher";
  researchGoal: string;
  sourcePreferences: (
    | "research_papers"
    | "articles_news"
    | "academic_papers"
    | "reputable_only"
  )[];
}

export async function createSession(record: SessionRecord): Promise<void> {
  await pool.query(
    `
      INSERT INTO sessions (id, topic, raw_input, input_category, preferred_sites)
      VALUES ($1, $2, $3, $4, $5::jsonb)
    `,
    [
      record.id,
      record.topic,
      record.rawInput,
      record.inputCategory,
      JSON.stringify(record.preferredSites),
    ],
  );
}

export async function updateSessionWithClarity(
  sessionId: string,
  clarity: ClarityData
): Promise<void> {
  await pool.query(
    `
      UPDATE sessions
      SET user_background = $1, research_goal = $2, source_preferences = $3::jsonb, status = $4
      WHERE id = $5
    `,
    [
      clarity.userBackground,
      clarity.researchGoal,
      JSON.stringify(clarity.sourcePreferences),
      "clarity_provided",
      sessionId,
    ]
  );
}

/**
 * Retrieves a research session from the database by its ID.
 * @param sessionId 
 * @returns {SessionRecord | null} SessionRecord if found, otherwise null
 * The function retrieves a research session from the database by its ID. It returns a SessionRecord object containing the session details if found, or null if no session with the given ID exists. The preferredSites field is stored as JSONB in the database and is parsed back into an array of strings before being returned in the SessionRecord.
 */
export async function getSession(
  sessionId: string
): Promise<SessionRecord | null> {
  const result = await pool.query(
    `SELECT id, topic, raw_input, input_category, preferred_sites FROM sessions WHERE id = $1`,
    [sessionId]
  );

  if (result.rows.length === 0) return null;

  const row = result.rows[0] as {
    id: string;
    topic: string;
    raw_input: string;
    input_category: InputCategory;
    preferred_sites: string[];
  };

  return {
    id: row.id,
    topic: row.topic,
    rawInput: row.raw_input,
    inputCategory: row.input_category,
    preferredSites: row.preferred_sites || [],
  };
}

export interface SessionListItem {
  id: string;
  topic: string;
  inputCategory: InputCategory;
  status: string;
  latestPlanId: string | null;
  createdAt: string;
  updatedAt: string;
}

export async function listSessions(): Promise<SessionListItem[]> {
  const result = await pool.query(
    `
      SELECT
        s.id,
        s.topic,
        s.input_category,
        COALESCE(s.status, 'input_provided') as status,
        (SELECT id FROM research_plans WHERE session_id = s.id ORDER BY created_at DESC LIMIT 1) as latest_plan_id,
        s.created_at,
        s.updated_at
      FROM sessions s
      ORDER BY s.updated_at DESC
      LIMIT 50
    `
  );

  return result.rows.map((row) => ({
    id: row.id as string,
    topic: row.topic as string,
    inputCategory: row.input_category as InputCategory,
    status: row.status as string,
    latestPlanId: row.latest_plan_id as string | null,
    createdAt: (row.created_at as Date).toISOString(),
    updatedAt: (row.updated_at as Date).toISOString(),
  }));
}
