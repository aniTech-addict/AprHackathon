import type { CandidateSource, SourceSeed } from "./types";

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

export async function discoverTrustedWebSources(
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
