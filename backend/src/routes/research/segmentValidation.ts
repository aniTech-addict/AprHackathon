import type { ResearchSegment } from "../../services/planningService";
import type { SegmentValidationResult } from "./types";

export function normalizeAndValidateSegments(
  segments: ResearchSegment[]
): SegmentValidationResult {
  if (!Array.isArray(segments) || segments.length === 0) {
    return { ok: false, message: "Plan must contain at least one segment." };
  }

  const cleaned = segments.map((segment, index) => {
    const title = String(segment.title || "").trim();
    const topic = String(segment.topic || "").trim();
    const queries = Array.isArray(segment.searchQueries)
      ? segment.searchQueries.map((query) => String(query).trim()).filter(Boolean)
      : [];

    return {
      order: index + 1,
      title,
      topic,
      searchQueries: queries,
    };
  });

  for (const segment of cleaned) {
    if (!segment.title) {
      return { ok: false, message: "Every segment needs a title." };
    }
    if (!segment.topic) {
      return { ok: false, message: "Every segment needs a topic description." };
    }
    if (segment.searchQueries.length === 0) {
      return {
        ok: false,
        message: "Every segment needs at least one search query.",
      };
    }
  }

  return { ok: true, value: cleaned };
}
