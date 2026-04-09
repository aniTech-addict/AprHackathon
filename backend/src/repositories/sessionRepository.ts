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
