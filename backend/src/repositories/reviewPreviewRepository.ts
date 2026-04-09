import { randomUUID } from "crypto";
import { pool } from "../db";

export interface PlanStructureSegment {
  order: number;
  title: string;
  topic: string;
}

export interface ReviewPreviewSource {
  id: string;
  title: string;
  url: string;
  excerpt: string;
}

export interface ReviewPreviewParagraph {
  id: string;
  order: number;
  segmentTitle: string;
  content: string;
  sources: ReviewPreviewSource[];
}

interface EnsureReviewPreviewArgs {
  sessionId: string;
  planId: string;
  topic: string;
  segments: PlanStructureSegment[];
}

interface ReviewParagraphRow {
  id: string;
  paragraph_order: number;
  segment_title: string;
  content: string;
}

interface ReviewSourceRow {
  id: string;
  paragraph_id: string;
  title: string;
  url: string;
  excerpt: string;
}

function buildReviewParagraphContent(topic: string, segment: PlanStructureSegment): string {
  return `This paragraph examines ${segment.topic} within the broader research scope of ${topic}. It highlights the main claims, supporting evidence, and practical implications that should be verified against the linked sources.`;
}

function buildReviewSources(topic: string, segment: PlanStructureSegment): Array<Omit<ReviewPreviewSource, "id">> {
  const encodedSegment = encodeURIComponent(segment.topic);
  const encodedTopic = encodeURIComponent(topic);

  return [
    {
      title: `${segment.title}: Background Reference`,
      url: `https://scholar.google.com/scholar?q=${encodedSegment}`,
      excerpt:
        "Use this source to validate foundational definitions, scope, and baseline evidence for the paragraph.",
    },
    {
      title: `${segment.title}: Evidence and Trends`,
      url: `https://news.google.com/search?q=${encodedSegment}`,
      excerpt:
        "Use this source to verify current developments, comparative context, and concrete examples tied to the topic.",
    },
    {
      title: `${segment.title}: Policy and Institutional View`,
      url: `https://www.google.com/search?q=${encodedTopic}+${encodedSegment}+site%3A.gov+OR+site%3A.edu`,
      excerpt:
        "Use this source to cross-check institutional claims, policy framing, and higher-confidence data points.",
    },
  ];
}

export async function getReviewPreviewByPlanId(
  sessionId: string,
  planId: string,
): Promise<ReviewPreviewParagraph[]> {
  const paragraphResult = await pool.query(
    `
      SELECT id, paragraph_order, segment_title, content
      FROM review_paragraphs
      WHERE session_id = $1 AND plan_id = $2
      ORDER BY paragraph_order ASC
    `,
    [sessionId, planId],
  );

  const paragraphRows = paragraphResult.rows as ReviewParagraphRow[];
  if (paragraphRows.length === 0) {
    return [];
  }

  const paragraphIds = paragraphRows.map((row) => row.id);

  const sourceResult = await pool.query(
    `
      SELECT id, paragraph_id, title, url, excerpt
      FROM review_sources
      WHERE paragraph_id = ANY($1::uuid[])
      ORDER BY paragraph_id ASC, source_order ASC
    `,
    [paragraphIds],
  );

  const sourceRows = sourceResult.rows as ReviewSourceRow[];
  const sourcesByParagraph = new Map<string, ReviewPreviewSource[]>();

  for (const row of sourceRows) {
    const current = sourcesByParagraph.get(row.paragraph_id) || [];
    current.push({
      id: row.id,
      title: row.title,
      url: row.url,
      excerpt: row.excerpt,
    });
    sourcesByParagraph.set(row.paragraph_id, current);
  }

  return paragraphRows.map((row) => ({
    id: row.id,
    order: row.paragraph_order,
    segmentTitle: row.segment_title,
    content: row.content,
    sources: sourcesByParagraph.get(row.id) || [],
  }));
}

async function seedReviewPreview(args: EnsureReviewPreviewArgs): Promise<void> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    await client.query(
      `
        DELETE FROM review_sources
        WHERE paragraph_id IN (
          SELECT id FROM review_paragraphs WHERE session_id = $1 AND plan_id = $2
        )
      `,
      [args.sessionId, args.planId],
    );

    await client.query(
      `
        DELETE FROM review_paragraphs
        WHERE session_id = $1 AND plan_id = $2
      `,
      [args.sessionId, args.planId],
    );

    for (const segment of args.segments) {
      const paragraphId = randomUUID();
      const content = buildReviewParagraphContent(args.topic, segment);

      await client.query(
        `
          INSERT INTO review_paragraphs (id, session_id, plan_id, paragraph_order, segment_title, content)
          VALUES ($1, $2, $3, $4, $5, $6)
        `,
        [
          paragraphId,
          args.sessionId,
          args.planId,
          segment.order,
          segment.title,
          content,
        ],
      );

      const sources = buildReviewSources(args.topic, segment);
      for (let index = 0; index < sources.length; index += 1) {
        const source = sources[index];
        await client.query(
          `
            INSERT INTO review_sources (id, paragraph_id, source_order, title, url, excerpt)
            VALUES ($1, $2, $3, $4, $5, $6)
          `,
          [
            randomUUID(),
            paragraphId,
            index + 1,
            source.title,
            source.url,
            source.excerpt,
          ],
        );
      }
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function ensureReviewPreview(
  args: EnsureReviewPreviewArgs,
): Promise<ReviewPreviewParagraph[]> {
  const existing = await getReviewPreviewByPlanId(args.sessionId, args.planId);
  if (existing.length > 0) {
    return existing;
  }

  await seedReviewPreview(args);
  return getReviewPreviewByPlanId(args.sessionId, args.planId);
}
