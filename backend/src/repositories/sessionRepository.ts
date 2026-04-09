import { pool } from "../db";
import { InputCategory } from "../services/inputClassifier";

export interface SessionRecord {
  id: string;
  topic: string;
  rawInput: string;
  inputCategory: InputCategory;
  preferredSites: string[];
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
