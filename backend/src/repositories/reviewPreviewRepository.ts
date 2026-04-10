import { randomUUID } from "crypto";
import type { PoolClient } from "pg";
import { pool } from "../db";
import {
  buildReviewParagraphContent,
  buildReviewSourcesForParagraph,
  getNextSegmentToGenerate,
  getParagraphOrder,
  harmonizeSegmentParagraphs,
  hasStrictValidSources,
} from "./reviewPreview/contentBuilders";
import { discoverTrustedWebSources } from "./reviewPreview/sourceDiscovery";
import type {
  EnsureReviewPreviewArgs,
  PlanStructureSegment,
  ReviewParagraphStatus,
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

const activePreviewGenerations = new Set<string>();

function getPreviewGenerationKey(sessionId: string, planId: string): string {
  return `${sessionId}:${planId}`;
}

export function isReviewPreviewGenerationInProgress(sessionId: string, planId: string): boolean {
  return activePreviewGenerations.has(getPreviewGenerationKey(sessionId, planId));
}

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
  const discoveredSources = await discoverTrustedWebSources(
    args.topic,
    segment.topic,
    3,
    args.researchFocusContext,
  );
  const previousParagraphs: string[] = [];
  const generatedParagraphs: string[] = [];
  const paragraphIds: string[] = [];

  for (let paragraphIndex = 1; paragraphIndex <= 3; paragraphIndex += 1) {
    const content = await buildReviewParagraphContent(
      args.topic,
      segment,
      paragraphIndex,
      previousParagraphs,
      discoveredSources,
      args.researchFocusContext,
      args.relevanceThreshold,
    );
    const paragraphId = randomUUID();
    const sources = buildReviewSourcesForParagraph(segment, paragraphIndex, discoveredSources);

    generatedParagraphs.push(content);
    previousParagraphs.push(content);
    paragraphIds.push(paragraphId);

    await client.query(
      `
        INSERT INTO review_paragraphs (
          id,
          session_id,
          plan_id,
          paragraph_order,
          segment_order,
          paragraph_index,
          segment_title,
          content,
          previous_content,
          status,
          last_edited_by,
          approved_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULL, 'pending_review', NULL, NULL)
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

  const harmonizedParagraphs = await harmonizeSegmentParagraphs({
    topic: args.topic,
    segment,
    paragraphs: generatedParagraphs,
    sources: discoveredSources,
    researchFocusContext: args.researchFocusContext,
    relevanceThreshold: args.relevanceThreshold,
  });

  for (let paragraphIndex = 1; paragraphIndex <= harmonizedParagraphs.length; paragraphIndex += 1) {
    const paragraphId = paragraphIds[paragraphIndex - 1];
    const content = harmonizedParagraphs[paragraphIndex - 1];
    await client.query(
      `
        UPDATE review_paragraphs
        SET previous_content = content, content = $2, updated_at = NOW()
        WHERE id = $1 AND session_id = $3 AND plan_id = $4
      `,
      [
        paragraphId,
        content,
        args.sessionId,
        args.planId,
      ],
    );
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

    await client.query("COMMIT");

    await insertSegmentParagraphsAndSources(client, args, firstSegment);
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
      SELECT id, paragraph_order, segment_order, paragraph_index, segment_title, content, previous_content, status, last_edited_by
      FROM review_paragraphs
      WHERE session_id = $1 AND plan_id = $2 AND status <> 'deleted'
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
    previousContent: row.previous_content,
    status: row.status,
    lastEditedBy: row.last_edited_by,
    sources: sourcesByParagraph.get(row.id) || [],
  }));
}

async function getParagraphForMutation(
  client: PoolClient,
  args: {
    sessionId: string;
    planId: string;
    paragraphId: string;
  },
): Promise<ReviewParagraphRow | null> {
  const result = await client.query(
    `
      SELECT id, paragraph_order, segment_order, paragraph_index, segment_title, content, previous_content, status, last_edited_by
      FROM review_paragraphs
      WHERE id = $1 AND session_id = $2 AND plan_id = $3
      LIMIT 1
    `,
    [args.paragraphId, args.sessionId, args.planId],
  );

  if (result.rows.length === 0) {
    return null;
  }

  return result.rows[0] as ReviewParagraphRow;
}

export async function approveReviewParagraph(args: {
  sessionId: string;
  planId: string;
  paragraphId: string;
}): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const paragraph = await getParagraphForMutation(client, args);
    if (!paragraph) {
      throw new Error("Paragraph not found for this session and plan.");
    }

    if (paragraph.status === "deleted") {
      throw new Error("Deleted paragraphs cannot be approved.");
    }

    await client.query(
      `
        UPDATE review_paragraphs
        SET status = 'approved', approved_at = NOW(), updated_at = NOW()
        WHERE id = $1
      `,
      [args.paragraphId],
    );

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function deleteReviewParagraph(args: {
  sessionId: string;
  planId: string;
  paragraphId: string;
}): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const paragraph = await getParagraphForMutation(client, args);
    if (!paragraph) {
      throw new Error("Paragraph not found for this session and plan.");
    }

    await client.query(
      `
        UPDATE review_paragraphs
        SET status = 'deleted', approved_at = NULL, updated_at = NOW()
        WHERE id = $1
      `,
      [args.paragraphId],
    );

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function updateReviewParagraphContent(args: {
  sessionId: string;
  planId: string;
  paragraphId: string;
  nextContent: string;
  editedBy: "manual" | "ai";
}): Promise<void> {
  const content = args.nextContent.trim();
  if (!content) {
    throw new Error("Paragraph content cannot be empty.");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const paragraph = await getParagraphForMutation(client, args);
    if (!paragraph) {
      throw new Error("Paragraph not found for this session and plan.");
    }

    if (paragraph.status === "deleted") {
      throw new Error("Cannot refine a deleted paragraph.");
    }

    await client.query(
      `
        UPDATE review_paragraphs
        SET
          previous_content = content,
          content = $2,
          status = 'pending_review',
          last_edited_by = $3,
          approved_at = NULL,
          updated_at = NOW()
        WHERE id = $1
      `,
      [args.paragraphId, content, args.editedBy],
    );

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function replaceParagraphContent(args: {
  sessionId: string;
  planId: string;
  paragraphId: string;
  nextContent: string;
}): Promise<void> {
  const content = args.nextContent.trim();
  if (!content) {
    return;
  }

  await pool.query(
    `
      UPDATE review_paragraphs
      SET previous_content = content, content = $4, updated_at = NOW()
      WHERE id = $1 AND session_id = $2 AND plan_id = $3 AND status <> 'deleted'
    `,
    [args.paragraphId, args.sessionId, args.planId, content],
  );
}

export async function getSegmentParagraphStatuses(args: {
  sessionId: string;
  planId: string;
  segmentOrder: number;
}): Promise<ReviewParagraphStatus[]> {
  const result = await pool.query(
    `
      SELECT status
      FROM review_paragraphs
      WHERE session_id = $1 AND plan_id = $2 AND segment_order = $3
      ORDER BY paragraph_index ASC
    `,
    [args.sessionId, args.planId, args.segmentOrder],
  );

  return result.rows.map((row) => row.status as ReviewParagraphStatus);
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
  researchFocusContext?: string;
  relevanceThreshold?: number;
  segments: PlanStructureSegment[];
  segmentOrder: number;
}): Promise<ReviewPreviewParagraph[]> {
  const ensureArgs: EnsureReviewPreviewArgs = {
    sessionId: args.sessionId,
    planId: args.planId,
    topic: args.topic,
    researchFocusContext: args.researchFocusContext,
    relevanceThreshold: args.relevanceThreshold,
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

    const segmentStatuses = await getSegmentParagraphStatuses({
      sessionId: args.sessionId,
      planId: args.planId,
      segmentOrder: args.segmentOrder,
    });

    if (segmentStatuses.length === 0) {
      throw new Error("No paragraph content exists for this page yet.");
    }

    const hasPendingReview = segmentStatuses.some(
      (status) => status === "pending_review",
    );
    if (hasPendingReview) {
      throw new Error(
        "Approve or delete each paragraph on this page before approving the page.",
      );
    }

    const hasApprovedParagraph = segmentStatuses.some(
      (status) => status === "approved",
    );
    if (!hasApprovedParagraph) {
      throw new Error("At least one paragraph must remain approved on this page.");
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

  const key = getPreviewGenerationKey(args.sessionId, args.planId);
  if (!activePreviewGenerations.has(key)) {
    activePreviewGenerations.add(key);

    void (async () => {
      try {
        await seedInitialReviewPreview(args);
      } catch (error) {
        console.error("Error seeding review preview:", error);
      } finally {
        activePreviewGenerations.delete(key);
      }
    })();
  }

  return existing;
}
