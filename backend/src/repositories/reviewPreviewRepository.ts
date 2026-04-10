import { randomUUID } from "crypto";
import type { PoolClient } from "pg";
import { pool } from "../db";
import {
  buildReviewParagraphContent,
  buildReviewSourcesForParagraph,
  getNextSegmentToGenerate,
  getParagraphOrder,
  hasStrictValidSources,
} from "./reviewPreview/contentBuilders";
import { discoverTrustedWebSources } from "./reviewPreview/sourceDiscovery";
import type {
  EnsureReviewPreviewArgs,
  PlanStructureSegment,
  ReviewPageProgress,
  ReviewParagraphRow,
  ReviewPreviewPage,
  ReviewPreviewParagraph,
  ReviewPreviewSource,
  ReviewSourceRow,
} from "./reviewPreview/types";

export type {
  PlanStructureSegment,
  ReviewPageProgress,
  ReviewPreviewPage,
  ReviewPreviewParagraph,
  ReviewPreviewSource,
} from "./reviewPreview/types";

async function getReviewPageProgressWithClient(
  client: PoolClient,
  sessionId: string,
  planId: string,
): Promise<ReviewPageProgress> {
  const approvedResult = await client.query(
    `
      SELECT segment_order
      FROM review_page_approvals
      WHERE session_id = $1 AND plan_id = $2
      ORDER BY segment_order ASC
    `,
    [sessionId, planId],
  );

  const generatedResult = await client.query(
    `
      SELECT DISTINCT segment_order
      FROM review_paragraphs
      WHERE session_id = $1 AND plan_id = $2
      ORDER BY segment_order ASC
    `,
    [sessionId, planId],
  );

  return {
    approvedSegmentOrders: approvedResult.rows.map((row) => Number(row.segment_order)),
    generatedSegmentOrders: generatedResult.rows.map((row) => Number(row.segment_order)),
  };
}

async function removeSourcesForParagraphIds(
  client: PoolClient,
  paragraphIds: string[],
): Promise<void> {
  if (paragraphIds.length === 0) {
    return;
  }

  await client.query(
    `
      DELETE FROM review_sources
      WHERE paragraph_id = ANY($1::uuid[])
    `,
    [paragraphIds],
  );
}

async function insertSegmentParagraphsAndSources(
  client: PoolClient,
  args: EnsureReviewPreviewArgs,
  segment: PlanStructureSegment,
): Promise<void> {
  const discoveredSources = await discoverTrustedWebSources(args.topic, segment.topic, 3);

  for (let paragraphIndex = 1; paragraphIndex <= 3; paragraphIndex += 1) {
    const paragraphId = randomUUID();
    const content = buildReviewParagraphContent(args.topic, segment, paragraphIndex);

    await client.query(
      `
        INSERT INTO review_paragraphs (id, session_id, plan_id, paragraph_order, segment_order, paragraph_index, segment_title, content)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `,
      [
        paragraphId,
        args.sessionId,
        args.planId,
        getParagraphOrder(segment.order, paragraphIndex),
        segment.order,
        paragraphIndex,
        segment.title,
        content,
      ],
    );

    const sources = buildReviewSourcesForParagraph(segment, paragraphIndex, discoveredSources);
    for (let sourceIndex = 0; sourceIndex < sources.length; sourceIndex += 1) {
      const source = sources[sourceIndex];
      await client.query(
        `
          INSERT INTO review_sources (id, paragraph_id, source_order, title, url, excerpt)
          VALUES ($1, $2, $3, $4, $5, $6)
        `,
        [
          randomUUID(),
          paragraphId,
          sourceIndex + 1,
          source.title,
          source.url,
          source.excerpt,
        ],
      );
    }
  }
}

async function seedInitialReviewPreview(args: EnsureReviewPreviewArgs): Promise<void> {
  const firstSegment = args.segments[0];
  if (!firstSegment) {
    return;
  }

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

    await insertSegmentParagraphsAndSources(client, args, firstSegment);

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function getReviewPreviewByPlanId(
  sessionId: string,
  planId: string,
): Promise<ReviewPreviewParagraph[]> {
  const paragraphResult = await pool.query(
    `
      SELECT id, paragraph_order, segment_order, paragraph_index, segment_title, content
      FROM review_paragraphs
      WHERE session_id = $1 AND plan_id = $2
      ORDER BY segment_order ASC, paragraph_index ASC
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
    segmentOrder: row.segment_order,
    paragraphIndex: row.paragraph_index,
    segmentTitle: row.segment_title,
    content: row.content,
    sources: sourcesByParagraph.get(row.id) || [],
  }));
}

export function groupParagraphsByPage(
  topic: string,
  paragraphs: ReviewPreviewParagraph[],
): ReviewPreviewPage[] {
  const grouped = new Map<number, ReviewPreviewPage>();

  for (const paragraph of paragraphs) {
    const current = grouped.get(paragraph.segmentOrder) || {
      segmentOrder: paragraph.segmentOrder,
      segmentTitle: paragraph.segmentTitle,
      topic,
      paragraphs: [],
    };

    current.paragraphs.push(paragraph);
    grouped.set(paragraph.segmentOrder, current);
  }

  return [...grouped.values()]
    .sort((a, b) => a.segmentOrder - b.segmentOrder)
    .map((page) => ({
      ...page,
      paragraphs: page.paragraphs.sort((a, b) => a.paragraphIndex - b.paragraphIndex),
    }));
}

export async function getReviewPageProgress(
  sessionId: string,
  planId: string,
): Promise<ReviewPageProgress> {
  const client = await pool.connect();
  try {
    return await getReviewPageProgressWithClient(client, sessionId, planId);
  } finally {
    client.release();
  }
}

export async function approveReviewPage(args: {
  sessionId: string;
  planId: string;
  topic: string;
  segments: PlanStructureSegment[];
  segmentOrder: number;
}): Promise<ReviewPreviewParagraph[]> {
  const ensureArgs: EnsureReviewPreviewArgs = {
    sessionId: args.sessionId,
    planId: args.planId,
    topic: args.topic,
    segments: args.segments,
  };

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const progress = await getReviewPageProgressWithClient(
      client,
      args.sessionId,
      args.planId,
    );
    const expectedNextOrder = progress.approvedSegmentOrders.length + 1;

    if (args.segmentOrder !== expectedNextOrder) {
      throw new Error("The current page must be approved in order before advancing.");
    }

    const currentSegment = args.segments.find((segment) => segment.order === args.segmentOrder);
    if (!currentSegment) {
      throw new Error("Requested page does not exist in the active research plan.");
    }

    const existingApproval = await client.query(
      `
        SELECT id
        FROM review_page_approvals
        WHERE session_id = $1 AND plan_id = $2 AND segment_order = $3
        LIMIT 1
      `,
      [args.sessionId, args.planId, args.segmentOrder],
    );

    if (existingApproval.rows.length === 0) {
      await client.query(
        `
          INSERT INTO review_page_approvals (id, session_id, plan_id, segment_order)
          VALUES ($1, $2, $3, $4)
        `,
        [randomUUID(), args.sessionId, args.planId, args.segmentOrder],
      );
    }

    const nextSegment = getNextSegmentToGenerate(
      args.segments,
      [...progress.approvedSegmentOrders, args.segmentOrder].sort((a, b) => a - b),
      progress.generatedSegmentOrders,
    );

    if (nextSegment) {
      const paragraphIdsToDelete = await client.query(
        `
          SELECT id
          FROM review_paragraphs
          WHERE session_id = $1 AND plan_id = $2 AND segment_order = $3
        `,
        [args.sessionId, args.planId, nextSegment.order],
      );

      if (paragraphIdsToDelete.rows.length > 0) {
        await removeSourcesForParagraphIds(
          client,
          paragraphIdsToDelete.rows.map((row) => row.id),
        );
        await client.query(
          `
            DELETE FROM review_paragraphs
            WHERE session_id = $1 AND plan_id = $2 AND segment_order = $3
          `,
          [args.sessionId, args.planId, nextSegment.order],
        );
      }

      await insertSegmentParagraphsAndSources(client, ensureArgs, nextSegment);
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  return getReviewPreviewByPlanId(args.sessionId, args.planId);
}

export async function ensureReviewPreview(
  args: EnsureReviewPreviewArgs,
): Promise<ReviewPreviewParagraph[]> {
  const existing = await getReviewPreviewByPlanId(args.sessionId, args.planId);
  if (hasStrictValidSources(existing)) {
    return existing;
  }

  await seedInitialReviewPreview(args);
  return getReviewPreviewByPlanId(args.sessionId, args.planId);
}
