/**
 * The user input is taken as context for plan generation.
 * a structured research plan using an LLM. If the LLM fails, it falls back to a heuristic-based plan.
 * The generated plan is stored in the database and linked to the user's session for later retrieval and execution.
 */



import { pool } from "../db";
import { randomUUID } from "crypto";

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

/**
 * 
 * @param input 
 * @returns 
 */
async function generatePlanWithLLM(
  input: PlanningInput
): Promise<ResearchPlan | null> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return null;

  const model = process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini";

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

  const prompt = `You are a research planning expert. Generate a detailed research plan for the following topic:

Topic: ${input.topic}

User Profile:
- Background: ${input.userBackground} (needs ${contextClues[input.userBackground]})
- End Goal: ${goalClues[input.endGoal]}
- Source Preferences: ${input.sourcePreferences.map((p) => sourceClues[p as keyof typeof sourceClues]).join("; ")}

Generate a research plan with:
1. An estimated page count (5-15 pages)
2. 5-10 segment titles and topics
3. For each segment, 2-3 targeted search queries

Return ONLY valid JSON with this exact schema:
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
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": "https://web-researcher-agent.local",
        "X-Title": "Web Researcher Agent",
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content:
              "You are a research planning assistant. Return only valid JSON, no markdown or extra text.",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    const content = payload.choices?.[0]?.message?.content;
    if (!content) return null;

    const parsed = JSON.parse(content) as {
      totalPages?: number;
      segments?: ResearchSegment[];
    };

    if (
      typeof parsed.totalPages === "number" &&
      Array.isArray(parsed.segments) &&
      parsed.segments.length > 0
    ) {
      const planMarkdown = generateMarkdownPlan(input.topic, parsed);
      return {
        totalPages: parsed.totalPages,
        segments: parsed.segments,
        planMarkdown,
      };
    }
  } catch (_error) {
    return null;
  }

  return null;
}

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

  const planMarkdown = generateMarkdownPlan(input.topic, {
    totalPages: 10,
    segments: defaultSegments,
  });

  return {
    totalPages: 10,
    segments: defaultSegments,
    planMarkdown,
  };
}

function generateMarkdownPlan(
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
  } catch (_error) {
    // Fallback to heuristic
  }

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
