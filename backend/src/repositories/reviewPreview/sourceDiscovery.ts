import type { CandidateSource, SourceSeed } from "./types";
import { searchWeb } from "../../services/tavilyClient";

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

const BLOCKED_RESOURCE_EXTENSIONS = new Set([
  ".xlsx",
  ".xls",
  ".csv",
  ".pdf",
  ".doc",
  ".docx",
  ".ppt",
  ".pptx",
  ".zip",
  ".rar",
  ".7z",
  ".gz",
  ".tar",
  ".json",
  ".xml",
]);

const BLOCKED_BOOK_HOSTS = new Set([
  "books.google.com",
  "books.google.co.uk",
  "books.google.co.in",
  "www.goodreads.com",
  "goodreads.com",
  "openlibrary.org",
  "www.openlibrary.org",
  "bookshop.org",
  "www.bookshop.org",
  "books.apple.com",
  "www.amazon.com",
  "amazon.com",
  "www.barnesandnoble.com",
  "barnesandnoble.com",
  "www.audible.com",
  "audible.com",
]);

const BLOCKED_REVIEW_HOSTS = new Set([
  "www.kirkusreviews.com",
  "kirkusreviews.com",
  "www.bookbrowse.com",
  "bookbrowse.com",
  "www.nybooks.com",
  "nybooks.com",
  "www.literaryhub.com",
  "lithub.com",
]);

const BLOCKED_BOOK_PATH_HINTS = [
  "/book/",
  "/books/",
  "/ebook/",
  "/isbn/",
  "/textbook/",
  "/hardcover/",
  "/paperback/",
];

const BLOCKED_BOOK_QUERY_KEYS = [
  "isbn",
  "book",
  "books",
  "edition",
  "volume",
];

const BLOCKED_REVIEW_PATH_HINTS = [
  "/book-review",
  "/book-reviews",
  "/reviews/books",
  "/books/reviews",
  "/reviews/book",
  "/review/book",
];

const BLOCKED_REVIEW_QUERY_KEYS = ["review", "rating", "ratings"];

const BOOK_HINT_PATTERN =
  /\b(book|books|textbook|handbook|monograph|isbn|hardcover|paperback|ebook|kindle|chapter in|book chapter|2nd edition|3rd edition|fourth edition|fifth edition)\b/i;

const REVIEW_HINT_PATTERN =
  /\b(book review|book reviews|editorial review|customer review|critic review|reviews and ratings|rated [1-5](?:\/5)? stars?)\b/i;

const BLOCKED_OPENALEX_TYPES = new Set([
  "book",
  "book-series",
  "book-part",
  "book-section",
  "book-chapter",
  "book-set",
  "monograph",
  "reference-book",
  "edited-book",
]);

const BLOCKED_CROSSREF_TYPES = new Set([
  "book",
  "book-set",
  "book-series",
  "book-track",
  "book-part",
  "book-section",
  "book-chapter",
  "edited-book",
  "reference-book",
  "monograph",
  "peer-review",
]);

function hasBlockedResourceExtension(pathname: string): boolean {
  const normalizedPath = pathname.toLowerCase();
  for (const extension of BLOCKED_RESOURCE_EXTENSIONS) {
    if (normalizedPath.endsWith(extension)) {
      return true;
    }
  }

  return false;
}

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

function hasBookLikeUrl(parsed: URL): boolean {
  const hostname = parsed.hostname.toLowerCase();
  if (BLOCKED_BOOK_HOSTS.has(hostname)) {
    return true;
  }

  const pathname = parsed.pathname.toLowerCase();
  if (BLOCKED_BOOK_PATH_HINTS.some((hint) => pathname.includes(hint))) {
    return true;
  }

  for (const key of BLOCKED_BOOK_QUERY_KEYS) {
    if (parsed.searchParams.has(key)) {
      return true;
    }

    const value = (parsed.searchParams.get(key) || "").toLowerCase();
    if (value && BOOK_HINT_PATTERN.test(value)) {
      return true;
    }
  }

  return false;
}

function hasReviewLikeUrl(parsed: URL): boolean {
  const hostname = parsed.hostname.toLowerCase();
  if (BLOCKED_REVIEW_HOSTS.has(hostname)) {
    return true;
  }

  const pathname = parsed.pathname.toLowerCase();
  if (BLOCKED_REVIEW_PATH_HINTS.some((hint) => pathname.includes(hint))) {
    return true;
  }

  for (const key of BLOCKED_REVIEW_QUERY_KEYS) {
    if (parsed.searchParams.has(key)) {
      const value = (parsed.searchParams.get(key) || "").toLowerCase();
      if (!value || REVIEW_HINT_PATTERN.test(value)) {
        return true;
      }
    }
  }

  return false;
}

function isBookLikeText(text: string): boolean {
  return BOOK_HINT_PATTERN.test(text);
}

function isReviewLikeText(text: string): boolean {
  return REVIEW_HINT_PATTERN.test(text);
}

function isBookLikeCandidate(candidate: CandidateSource): boolean {
  if (isBookLikeText(candidate.title) || isBookLikeText(candidate.excerpt)) {
    return true;
  }

  try {
    const parsed = new URL(candidate.url);
    return hasBookLikeUrl(parsed);
  } catch {
    return false;
  }
}

function isReviewLikeCandidate(candidate: CandidateSource): boolean {
  if (isReviewLikeText(candidate.title) || isReviewLikeText(candidate.excerpt)) {
    return true;
  }

  try {
    const parsed = new URL(candidate.url);
    return hasReviewLikeUrl(parsed);
  } catch {
    return false;
  }
}

export function normalizeTrustedUrl(rawUrl: string): string | null {
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

  if (hasBlockedResourceExtension(parsed.pathname)) {
    return null;
  }

  const formatHint = (
    parsed.searchParams.get("format") ||
    parsed.searchParams.get("file") ||
    parsed.searchParams.get("download") ||
    ""
  ).toLowerCase();

  if (
    formatHint.includes("xlsx") ||
    formatHint.includes("xls") ||
    formatHint.includes("csv") ||
    formatHint.includes("pdf") ||
    formatHint.includes("doc") ||
    formatHint.includes("zip")
  ) {
    return null;
  }

  if (isSearchResultUrl(parsed)) {
    return null;
  }

  if (hasBookLikeUrl(parsed)) {
    return null;
  }

  if (hasReviewLikeUrl(parsed)) {
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

    const normalizedCandidate: CandidateSource = {
      ...candidate,
      url: normalized,
    };

    if (isBookLikeCandidate(normalizedCandidate)) {
      continue;
    }

    if (isReviewLikeCandidate(normalizedCandidate)) {
      continue;
    }

    if (!byUrl.has(normalized)) {
      byUrl.set(normalized, normalizedCandidate);
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
        type?: string;
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
        if (item.type && BLOCKED_OPENALEX_TYPES.has(item.type.toLowerCase())) {
          return null;
        }

        const landing = item.primary_location?.landing_page_url;
        const doi = item.doi || "";
        const doiUrl = doi.startsWith("http")
          ? doi
          : doi
            ? `https://doi.org/${doi.replace(/^https?:\/\/doi.org\//, "")}`
            : "";
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
          type?: string;
        }>;
      };
    };

    const items = payload.message?.items ?? [];
    return items
      .map((item) => {
        if (item.type && BLOCKED_CROSSREF_TYPES.has(item.type.toLowerCase())) {
          return null;
        }

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

export async function discoverTrustedWebSources(
  topic: string,
  segmentTopic: string,
  limit: number,
  researchFocusContext = "",
): Promise<SourceSeed[]> {
  const scopedFocus = researchFocusContext.trim().slice(0, 180);
  const query = `${segmentTopic} ${topic} ${scopedFocus}`.trim();

  // Try Tavily first for richer, more relevant web results
  const tavilyResults = await searchWeb(query, limit + 2);
  if (tavilyResults.length > 0) {
    const tavilyCandidates: CandidateSource[] = tavilyResults.map((result) => ({
      title: result.title,
      url: result.url,
      excerpt: result.content.slice(0, 300),
    }));

    const unique = dedupeSources(tavilyCandidates);
    if (unique.length > 0) {
      return unique.slice(0, limit).map((entry) => ({
        title: entry.title,
        url: entry.url,
        excerpt: entry.excerpt,
      }));
    }
  }

  // Fall back to Wikipedia, OpenAlex, and Crossref if Tavily is unavailable or returns no usable results
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
