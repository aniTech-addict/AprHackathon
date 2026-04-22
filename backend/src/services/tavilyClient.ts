import { tavily, type TavilyClient } from "@tavily/core";

export interface TavilySearchResult {
  title: string;
  url: string;
  content: string;
  score: number;
}

export interface TavilySearchResponse {
  results: TavilySearchResult[];
}

let tavilyClientInstance: TavilyClient | null = null;

/**
 * Returns a Tavily client instance or null if the API key is missing.
 * The XAI_API_KEY is used for Grok (content generation) and TAVILY_API_KEY for web search.
 */
function getTavilyClient(): TavilyClient | null {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    console.error("[tavily] TAVILY_API_KEY is missing. Skipping Tavily search and falling back.");
    return null;
  }

  if (!tavilyClientInstance) {
    tavilyClientInstance = tavily({ apiKey });
  }

  return tavilyClientInstance;
}

/**
 * Searches the web using the Tavily API and returns relevant results.
 * Falls back to an empty array if the API key is missing or the request fails.
 *
 * @param query - The search query string
 * @param maxResults - Maximum number of results to return (default: 5)
 * @returns Array of search results with title, url, content, and relevance score
 */
export async function searchWeb(
  query: string,
  maxResults = 5
): Promise<TavilySearchResult[]> {
  try {
    const client = getTavilyClient();
    if (!client) return [];

    console.info(`[tavily] searching: ${JSON.stringify(query)} maxResults=${maxResults}`);

    const response = await client.search(query, {
      searchDepth: "advanced",
      maxResults,
    });

    const results: TavilySearchResult[] = (response.results ?? []).map((result) => ({
      title: result.title,
      url: result.url,
      content: result.content,
      score: result.score,
    }));

    console.info(`[tavily] returned ${results.length} result(s) for query: ${JSON.stringify(query)}`);
    return results;
  } catch (error) {
    console.error("[tavily] search failed:", error);
    return [];
  }
}
