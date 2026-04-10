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
  segmentOrder: number;
  paragraphIndex: number;
  segmentTitle: string;
  content: string;
  sources: ReviewPreviewSource[];
}

export interface ReviewPreviewPage {
  segmentOrder: number;
  segmentTitle: string;
  topic: string;
  paragraphs: ReviewPreviewParagraph[];
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
  segment_order: number;
  paragraph_index: number;
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

interface ReviewPageProgress {
  approvedSegmentOrders: number[];
  generatedSegmentOrders: number[];
}

interface SourceSeed {
  title: string;
  url: string;
  excerpt: string;
}

interface CandidateSource {
  title: string;
  url: string;
  excerpt: string;
}

const TRUSTED_EXACT_HOSTS = new Set([
  "en.wikipedia.org",
  "www.nature.com",
  "nature.com",
  "science.org",
  "www.science.org",
  "www.nejm.org",
  "nejm.org",
  "jamanetwork.com",
  "www.thelancet.com",
  "thelancet.com",
  "www.cell.com",
  "cell.com",
  "www.sciencedirect.com",
  "sciencedirect.com",
  "link.springer.com",
  "springer.com",
  "www.frontiersin.org",
  "frontiersin.org",
  "www.pnas.org",
  "pnas.org",
  "doi.org",
  "arxiv.org",
  "www.arxiv.org",
  "pubmed.ncbi.nlm.nih.gov",
  "www.ncbi.nlm.nih.gov",
  "ourworldindata.org",
  "www.pewresearch.org",
  "pewresearch.org",
  "www.un.org",
  "un.org",
  "www.who.int",
  "who.int",
  "www.worldbank.org",
  "worldbank.org",
  "www.oecd.org",
  "oecd.org",
  "www.imf.org",
  "imf.org",
]);

const TRUSTED_SUFFIXES = [".edu", ".gov", ".ac.uk", ".gov.uk", ".europa.eu"];

const BLOCKED_SEARCH_HOSTS = new Set([
  "google.com",
  "www.google.com",
  "scholar.google.com",
  "news.google.com",
  "bing.com",
  "www.bing.com",
  "search.yahoo.com",
  "yahoo.com",
  "duckduckgo.com",
  "www.duckduckgo.com",
  "search.brave.com",
  "www.ecosia.org",
]);

function withTimeout(url: string, timeoutMs = 8000): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { signal: controller.signal }).finally(() => {
    clearTimeout(timeout);
  });
}

function isTrustedHost(hostname: string): boolean {
  if (TRUSTED_EXACT_HOSTS.has(hostname)) {
    return true;
  }

  return TRUSTED_SUFFIXES.some((suffix) => hostname.endsWith(suffix));
}

function isSearchResultUrl(parsed: URL): boolean {
  if (BLOCKED_SEARCH_HOSTS.has(parsed.hostname)) {
    return true;
  }

  const pathname = parsed.pathname.toLowerCase();
  const searchParam = parsed.searchParams;

  if (pathname.includes("/search") || pathname === "/scholar") {
    return true;
  }

  return searchParam.has("q") || searchParam.has("query") || searchParam.has("search");
}

function normalizeTrustedUrl(rawUrl: string): string | null {
  let parsed: URL;

  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return null;
  }

  parsed.hostname = parsed.hostname.toLowerCase();

  if (isSearchResultUrl(parsed)) {
    return null;
  }

  if (!isTrustedHost(parsed.hostname)) {
    return null;
  }

  return parsed.toString();
}

function dedupeSources(candidates: CandidateSource[]): CandidateSource[] {
  const byUrl = new Map<string, CandidateSource>();

  for (const candidate of candidates) {
    const normalized = normalizeTrustedUrl(candidate.url);
    if (!normalized) {
      continue;
    }

    if (!byUrl.has(normalized)) {
      byUrl.set(normalized, {
        ...candidate,
        url: normalized,
      });
    }
  }

  return [...byUrl.values()];
}

function buildFallbackTrustedSources(segmentTopic: string): SourceSeed[] {
  return [
    {
      title: `${segmentTopic} background (Wikipedia)`,
      url: "https://en.wikipedia.org/wiki/Main_Page",
      excerpt:
        "Trusted encyclopedic starting point. Use to verify baseline definitions before relying on specialized claims.",
    },
    {
      title: `${segmentTopic} global context (UN)`,
      url: "https://www.un.org/en/",
      excerpt:
        "Institutional reference from the United Nations for policy and international context.",
    },
    {
      title: `${segmentTopic} data context (Our World in Data)`,
      url: "https://ourworldindata.org/",
      excerpt:
        "High-quality public data publication for comparative metrics and trend framing.",
    },
  ];
}

async function fetchWikipediaCandidates(query: string): Promise<CandidateSource[]> {
  const url = `https://en.wikipedia.org/w/api.php?action=opensearch&format=json&namespace=0&limit=5&search=${encodeURIComponent(
    query,
  )}`;

  try {
    const response = await withTimeout(url);
    if (!response.ok) {
      return [];
    }

    const payload = (await response.json()) as [string, string[], string[], string[]];
    const titles = Array.isArray(payload[1]) ? payload[1] : [];
    const descriptions = Array.isArray(payload[2]) ? payload[2] : [];
    const links = Array.isArray(payload[3]) ? payload[3] : [];

    const candidates: CandidateSource[] = [];
    for (let index = 0; index < links.length; index += 1) {
      const title = titles[index] || "Wikipedia entry";
      const excerpt = descriptions[index] || "Encyclopedic overview from Wikipedia.";
      const link = links[index];
      if (!link) {
        continue;
      }

      candidates.push({
        title,
        excerpt,
        url: link,
      });
    }

    return candidates;
  } catch {
    return [];
  }
}

async function fetchOpenAlexCandidates(query: string): Promise<CandidateSource[]> {
  const url = `https://api.openalex.org/works?search=${encodeURIComponent(query)}&per-page=8`;

  try {
    const response = await withTimeout(url);
    if (!response.ok) {
      return [];
    }

    const payload = (await response.json()) as {
      results?: Array<{
        display_name?: string;
        doi?: string;
        primary_location?: {
          landing_page_url?: string;
          source?: {
            display_name?: string;
          };
        };
      }>;
    };

    const results = Array.isArray(payload.results) ? payload.results : [];
    return results
      .map((item) => {
        const landing = item.primary_location?.landing_page_url;
        const doi = item.doi || "";
        const doiUrl = doi.startsWith("http") ? doi : doi ? `https://doi.org/${doi.replace(/^https?:\/\/doi.org\//, "")}` : "";
        const urlToUse = landing || doiUrl;

        if (!urlToUse) {
          return null;
        }

        return {
          title: item.display_name || "Research paper",
          url: urlToUse,
          excerpt: `Peer-reviewed or scholarly material indexed by OpenAlex${
            item.primary_location?.source?.display_name
              ? ` (${item.primary_location.source.display_name}).`
              : "."
          }`,
        } satisfies CandidateSource;
      })
      .filter((candidate): candidate is CandidateSource => candidate !== null);
  } catch {
    return [];
  }
}

async function fetchCrossrefCandidates(query: string): Promise<CandidateSource[]> {
  const url = `https://api.crossref.org/works?query.bibliographic=${encodeURIComponent(
    query,
  )}&rows=8`;

  try {
    const response = await withTimeout(url);
    if (!response.ok) {
      return [];
    }

    const payload = (await response.json()) as {
      message?: {
        items?: Array<{
          title?: string[];
          URL?: string;
          "container-title"?: string[];
        }>;
      };
    };

    const items = payload.message?.items ?? [];
    return items
      .map((item) => {
        if (!item.URL) {
          return null;
        }

        const journal = item["container-title"]?.[0];
        return {
          title: item.title?.[0] || "Scholarly publication",
          url: item.URL,
          excerpt: journal
            ? `Scholarly publication listed in Crossref (${journal}).`
            : "Scholarly publication listed in Crossref.",
        } satisfies CandidateSource;
      })
      .filter((candidate): candidate is CandidateSource => candidate !== null);
  } catch {
    return [];
  }
}

async function discoverTrustedWebSources(
  topic: string,
  segmentTopic: string,
  limit: number,
): Promise<SourceSeed[]> {
  const query = `${segmentTopic} ${topic}`.trim();

  const [wikiCandidates, openAlexCandidates, crossrefCandidates] = await Promise.all([
    fetchWikipediaCandidates(query),
    fetchOpenAlexCandidates(query),
    fetchCrossrefCandidates(query),
  ]);

  const unique = dedupeSources([
    ...openAlexCandidates,
    ...crossrefCandidates,
    ...wikiCandidates,
  ]);

  if (unique.length === 0) {
    return buildFallbackTrustedSources(segmentTopic).slice(0, limit);
  }

  return unique.slice(0, limit).map((entry) => ({
    title: entry.title,
    url: entry.url,
    excerpt: entry.excerpt,
  }));
}

function hasStrictValidSources(paragraphs: ReviewPreviewParagraph[]): boolean {
  if (paragraphs.length === 0) {
    return false;
  }

  for (const paragraph of paragraphs) {
    if (paragraph.sources.length === 0) {
      return false;
    }

    for (const source of paragraph.sources) {
      if (!normalizeTrustedUrl(source.url)) {
        return false;
      }
    }
  }

  return true;
}

function buildReviewParagraphContent(
  topic: string,
  segment: PlanStructureSegment,
  paragraphIndex: number,
): string {
  if (paragraphIndex === 1) {
    return `This opening paragraph introduces ${segment.topic} as a focused page in the larger research project on ${topic}. It defines scope, context, and why this page matters for the full document.`;
  }

  if (paragraphIndex === 2) {
    return `This paragraph develops the evidence layer for ${segment.topic}, highlighting data points, competing interpretations, and credible signals that should be validated against the linked sources.`;
  }

  return `This closing paragraph synthesizes implications from ${segment.topic}, connecting the findings back to the research goal on ${topic} and identifying what should inform the next page.`;
}

function buildReviewSourcesForParagraph(
  segment: PlanStructureSegment,
  paragraphIndex: number,
  sourcePool: SourceSeed[],
): Array<Omit<ReviewPreviewSource, "id">> {
  return sourcePool.map((source) => ({
    title: `${segment.title}: ${source.title}`,
    url: source.url,
    excerpt:
      paragraphIndex === 1
        ? `${source.excerpt} Prioritize this source for framing and terminology.`
        : paragraphIndex === 2
          ? `${source.excerpt} Prioritize this source for evidence and claims validation.`
          : `${source.excerpt} Prioritize this source for synthesis and implications.`,
  }));
}

function getParagraphOrder(segmentOrder: number, paragraphIndex: number): number {
  return (segmentOrder - 1) * 3 + paragraphIndex;
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
  const approvedResult = await pool.query(
    `
      SELECT segment_order
      FROM review_page_approvals
      WHERE session_id = $1 AND plan_id = $2
      ORDER BY segment_order ASC
    `,
    [sessionId, planId],
  );

  const generatedResult = await pool.query(
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

function getNextSegmentToGenerate(
  segments: PlanStructureSegment[],
  approvedSegmentOrders: number[],
  generatedSegmentOrders: number[],
): PlanStructureSegment | null {
  const expectedNextOrder = approvedSegmentOrders.length + 1;
  const nextSegment = segments.find((segment) => segment.order === expectedNextOrder) || null;

  if (!nextSegment) {
    return null;
  }

  if (generatedSegmentOrders.includes(nextSegment.order)) {
    return null;
  }

  return nextSegment;
}

async function seedReviewPage(
  args: EnsureReviewPreviewArgs,
  segment: PlanStructureSegment,
): Promise<void> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const discoveredSources = await discoverTrustedWebSources(args.topic, segment.topic, 3);

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

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function seedReviewPreview(args: EnsureReviewPreviewArgs): Promise<void> {
  const firstSegment = args.segments[0];
  if (!firstSegment) {
    return;
  }

  await seedReviewPage(args, firstSegment);
}

export async function approveReviewPage(args: {
  sessionId: string;
  planId: string;
  topic: string;
  segments: PlanStructureSegment[];
  segmentOrder: number;
}): Promise<ReviewPreviewParagraph[]> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const progress = await getReviewPageProgress(args.sessionId, args.planId);
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
      const discoveredSources = await discoverTrustedWebSources(args.topic, nextSegment.topic, 3);

      const paragraphIdsToDelete = await client.query(
        `
          SELECT id
          FROM review_paragraphs
          WHERE session_id = $1 AND plan_id = $2 AND segment_order = $3
        `,
        [args.sessionId, args.planId, nextSegment.order],
      );

      if (paragraphIdsToDelete.rows.length > 0) {
        await client.query(
          `
            DELETE FROM review_sources
            WHERE paragraph_id = ANY($1::uuid[])
          `,
          [paragraphIdsToDelete.rows.map((row) => row.id)],
        );
        await client.query(
          `
            DELETE FROM review_paragraphs
            WHERE session_id = $1 AND plan_id = $2 AND segment_order = $3
          `,
          [args.sessionId, args.planId, nextSegment.order],
        );
      }

      for (let paragraphIndex = 1; paragraphIndex <= 3; paragraphIndex += 1) {
        const paragraphId = randomUUID();
        const content = buildReviewParagraphContent(args.topic, nextSegment, paragraphIndex);

        await client.query(
          `
            INSERT INTO review_paragraphs (id, session_id, plan_id, paragraph_order, segment_order, paragraph_index, segment_title, content)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          `,
          [
            paragraphId,
            args.sessionId,
            args.planId,
            getParagraphOrder(nextSegment.order, paragraphIndex),
            nextSegment.order,
            paragraphIndex,
            nextSegment.title,
            content,
          ],
        );

        const sources = buildReviewSourcesForParagraph(nextSegment, paragraphIndex, discoveredSources);
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

  await seedReviewPreview(args);
  return getReviewPreviewByPlanId(args.sessionId, args.planId);
}
