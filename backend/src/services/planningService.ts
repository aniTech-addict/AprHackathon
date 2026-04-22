/**
 * The user input is taken as context for plan generation.
 * a structured research plan using an LLM. If the LLM fails, it falls back to a heuristic-based plan.
 * The generated plan is stored in the database and linked to the user's session for later retrieval and execution.
 */



import { pool } from "../db";
import { randomUUID } from "crypto";
import { streamJsonChatCompletion } from "./openRouterClient";

export interface PlanningInput {
  topic: string;
  userBackground: "researcher" | "student" | "teacher";
  endGoal:
    | "propose_solutions"
    | "evaluate_and_explain"
    | "explore_current_approaches";
  sourcePreferences: (
    | "research_papers"
    | "articles_news"
    | "academic_papers"
    | "reputable_only"
  )[];
}

export interface ResearchSegment {
  order: number;
  title: string;
  topic: string;
  searchQueries: string[];
}

export interface ResearchPlan {
  totalPages: number;
  segments: ResearchSegment[];
  planMarkdown: string;
}

export interface EditablePlanPayload {
  totalPages: number;
  segments: ResearchSegment[];
}

/**
 * 
 * @param input 
 * @returns 
 */
async function generatePlanWithLLM(
  input: PlanningInput
): Promise<ResearchPlan | null> {
  const contextClues = {
    researcher: "deep, original insights for publication",
    student: "comprehensive, well-sourced for academic work",
    teacher: "clear explanations suitable for instruction",
  };

  const goalClues = {
    propose_solutions:
      "Focus on actionable solutions, interventions, and forward-looking approaches.",
    evaluate_and_explain:
      "Provide historical context, explain trends, and forecast future developments.",
    explore_current_approaches:
      "Survey current methods, best practices, and ongoing efforts.",
  };

  const sourceClues = {
    research_papers: "Prefer peer-reviewed research, journals, and studies.",
    articles_news: "Include news articles and journalistic reporting.",
    academic_papers: "Focus on academic and scholarly sources.",
    reputable_only: "Only use established, reputable sources (.edu, .gov, etc).",
  };

  const prompt = `You are designing the execution blueprint for a multi-step research workflow.
The quality of this plan directly determines downstream research outcomes.

Research topic:
${input.topic}

User profile and intent:
- Background: ${input.userBackground} (needs ${contextClues[input.userBackground]})
- End goal: ${goalClues[input.endGoal]}
- Source preferences: ${input.sourcePreferences.map((p) => sourceClues[p as keyof typeof sourceClues]).join("; ")}

What the plan should optimize for:
- Clarity: each segment should answer a specific research question.
- Coverage: the full set of segments should cover foundations, evidence, analysis, and implications.
- Efficiency: avoid redundant segments and overlapping queries.
- Evidence quality: favor credible, verifiable, and goal-aligned sources.

Planning constraints:
- totalPages must be an integer from 5 to 15.
- Provide 5 to 10 segments.
- Segment order must be contiguous, starting at 1.
- Segment titles must be distinct, descriptive, and progression-oriented.
- Segment topics must be specific, scoped, and non-overlapping.
- Each segment must include 2 to 3 targeted search queries.
- Search queries should be investigation-ready and include useful qualifiers where relevant:
  region, timeframe, actor/stakeholder, method, policy, dataset, metric, or comparison.
- Avoid vague query phrasing such as "overview", "everything about", or "general info".
- Respect source preferences in query wording.

Expected segment progression (adapt as needed to the topic):
1) Core context and terminology
2) Historical or structural background
3) Current landscape and key actors
4) Evidence and data deep-dive
5) Competing perspectives / trade-offs
6) Case studies or comparative examples
7) Synthesis and implications aligned to the user's end goal

Output rules:
- Return only valid JSON.
- Do not include markdown, comments, or explanatory prose.
- Must match this schema exactly:
{
  "totalPages": number,
  "segments": [
    {
      "order": number,
      "title": "string",
      "topic": "string",
      "searchQueries": ["query1", "query2", "query3"]
    }
  ]
}`;

  try {
    const result = await streamJsonChatCompletion({
      operation: "research-planning",
      model: process.env.GROK_MODEL || "grok-3-mini",
      temperature: 0.3,
      messages: [
        {
          role: "system",
          content:
            "You are a senior research architect. Produce practical, coherent, and non-overlapping research plans. Return strict JSON only.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      responseFormat: {
        type: "json_schema",
        jsonSchema: {
          name: "research_plan",
          strict: true,
          schema: {
            type: "object",
            properties: {
              totalPages: { type: "number" },
              segments: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    order: { type: "number" },
                    title: { type: "string" },
                    topic: { type: "string" },
                    searchQueries: {
                      type: "array",
                      items: { type: "string" },
                    },
                  },
                  required: ["order", "title", "topic", "searchQueries"],
                  additionalProperties: false,
                },
              },
            },
            required: ["totalPages", "segments"],
            additionalProperties: false,
          },
        },
      },
    });

    if (!result) {
      return null;
    }

    const parsed = JSON.parse(result.content) as {
      totalPages?: number;
      segments?: ResearchSegment[];
    };

    if (
      typeof parsed.totalPages === "number" &&
      Array.isArray(parsed.segments) &&
      parsed.segments.length > 0
    ) {
      const planMarkdown = buildPlanMarkdown(input.topic, {
        totalPages: parsed.totalPages,
        segments: parsed.segments,
      });
      return {
        totalPages: parsed.totalPages,
        segments: parsed.segments,
        planMarkdown,
      };
    }
  } catch (error) {
    console.error("[research-planning] Grok API planning failed; falling back to heuristic plan.", error);
    return null;
  }

  return null;
}

/**
 * Fallback plan generation using a heuristic approach with predefined segments and queries based on the topic. 
  used when llm support isnt available
*/
function generateHeuristicPlan(input: PlanningInput): ResearchPlan {
  const defaultSegments: ResearchSegment[] = [
    {
      order: 1,
      title: "Introduction & Context",
      topic: `Overview of ${input.topic}`,
      searchQueries: [
        `what is ${input.topic}`,
        `${input.topic} background`,
      ],
    },
    {
      order: 2,
      title: "Historical Timeline",
      topic: `History and evolution of ${input.topic}`,
      searchQueries: [
        `${input.topic} history`,
        `${input.topic} evolution over time`,
      ],
    },
    {
      order: 3,
      title: "Current Status",
      topic: `Present-day landscape of ${input.topic}`,
      searchQueries: [`${input.topic} 2024 2025`, `current state ${input.topic}`],
    },
    {
      order: 4,
      title: "Key Challenges",
      topic: `Major issues and challenges in ${input.topic}`,
      searchQueries: [
        `challenges in ${input.topic}`,
        `problems with ${input.topic}`,
      ],
    },
    {
      order: 5,
      title: "Solutions & Approaches",
      topic: `Proposed or existing solutions for ${input.topic}`,
      searchQueries: [
        `solutions to ${input.topic}`,
        `approaches to ${input.topic}`,
      ],
    },
    {
      order: 6,
      title: "Case Studies",
      topic: `Real-world examples and case studies`,
      searchQueries: [
        `${input.topic} case study`,
        `${input.topic} example success`,
      ],
    },
    {
      order: 7,
      title: "Future Outlook",
      topic: `Trends and predictions for ${input.topic}`,
      searchQueries: [
        `${input.topic} future trends`,
        `${input.topic} forecast 2025+`,
      ],
    },
  ];

  const planMarkdown = buildPlanMarkdown(input.topic, {
    totalPages: 10,
    segments: defaultSegments,
  });

  return {
    totalPages: 10,
    segments: defaultSegments,
    planMarkdown,
  };
}

export function buildPlanMarkdown(
  topic: string,
  plan: { totalPages: number; segments: ResearchSegment[] }
): string {
  const lines: string[] = [
    `# Research Plan: ${topic}`,
    "",
    `**Estimated Pages:** ${plan.totalPages}`,
    `**Total Segments:** ${plan.segments.length}`,
    "",
    "## Segmented Research Outline",
    "",
  ];

  for (const segment of plan.segments) {
    lines.push(`### ${segment.order}. ${segment.title}`);
    lines.push(`**Topic:** ${segment.topic}`);
    lines.push("");
    lines.push("**Search Queries:**");
    for (const query of segment.searchQueries) {
      lines.push(`- ${query}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

export async function generateResearchPlan(
  input: PlanningInput
): Promise<ResearchPlan> {
  try {
    const llmPlan = await generatePlanWithLLM(input);
    if (llmPlan) return llmPlan;
  } catch (error) {
    console.error("[research-planning] LLM planning threw; falling back to heuristic plan.", error);
  }

  console.error("[research-planning] Using heuristic plan fallback.");
  return generateHeuristicPlan(input);
}

export async function storePlanInDatabase(
  sessionId: string,
  plan: ResearchPlan
): Promise<{ planId: string }> {
  const planId = randomUUID();

  const segmentStructure = plan.segments.map((s) => ({
    order: s.order,
    title: s.title,
    topic: s.topic,
  }));

  await pool.query(
    `
      INSERT INTO research_plans (id, session_id, total_pages, structure, plan_markdown, search_queries)
      VALUES ($1, $2, $3, $4::jsonb, $5, $6::jsonb)
    `,
    [
      planId,
      sessionId,
      plan.totalPages,
      JSON.stringify(segmentStructure),
      plan.planMarkdown,
      JSON.stringify(plan.segments.map((s) => s.searchQueries).flat()),
    ]
  );

  // Store segments
  for (const segment of plan.segments) {
    await pool.query(
      `
        INSERT INTO segments (id, session_id, research_plan_id, title, topic, segment_order)
        VALUES ($1, $2, $3, $4, $5, $6)
      `,
      [randomUUID(), sessionId, planId, segment.title, segment.topic, segment.order]
    );
  }

  return { planId };
}

export async function updatePlanDraftInDatabase(
  sessionId: string,
  planId: string,
  topic: string,
  draft: EditablePlanPayload
): Promise<{ planMarkdown: string }> {
  const planMarkdown = buildPlanMarkdown(topic, {
    totalPages: draft.totalPages,
    segments: draft.segments,
  });

  const segmentStructure = draft.segments.map((segment) => ({
    order: segment.order,
    title: segment.title,
    topic: segment.topic,
  }));

  const flattenedQueries = draft.segments.flatMap(
    (segment) => segment.searchQueries
  );

  await pool.query(
    `
      UPDATE research_plans
      SET total_pages = $1,
          structure = $2::jsonb,
          plan_markdown = $3,
          search_queries = $4::jsonb,
          status = 'pending_approval',
          updated_at = NOW()
      WHERE id = $5 AND session_id = $6
    `,
    [
      draft.totalPages,
      JSON.stringify(segmentStructure),
      planMarkdown,
      JSON.stringify(flattenedQueries),
      planId,
      sessionId,
    ]
  );

  await pool.query(`DELETE FROM segments WHERE research_plan_id = $1`, [planId]);

  for (const segment of draft.segments) {
    await pool.query(
      `
        INSERT INTO segments (id, session_id, research_plan_id, title, topic, segment_order)
        VALUES ($1, $2, $3, $4, $5, $6)
      `,
      [
        randomUUID(),
        sessionId,
        planId,
        segment.title,
        segment.topic,
        segment.order,
      ]
    );
  }

  return { planMarkdown };
}

export async function approvePlanInDatabase(
  sessionId: string,
  planId: string
): Promise<void> {
  await pool.query(
    `
      UPDATE research_plans
      SET status = 'approved', updated_at = NOW()
      WHERE id = $1 AND session_id = $2
    `,
    [planId, sessionId]
  );

  await pool.query(
    `
      UPDATE sessions
      SET status = 'plan_approved', updated_at = NOW()
      WHERE id = $1
    `,
    [sessionId]
  );
}
