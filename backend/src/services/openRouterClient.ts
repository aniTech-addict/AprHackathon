import { config } from "../config";

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

interface GrokChatCompletionChoice {
  message?: {
    content?: string | Array<{ type?: string; text?: string }>;
  };
}

interface GrokChatCompletionResponse {
  choices?: GrokChatCompletionChoice[];
  usage?: {
    total_tokens?: number;
    completion_tokens?: number;
    prompt_tokens?: number;
  };
}

type GroqChatCompletionResponse = GrokChatCompletionResponse;

export interface StreamJsonChatRequest {
  operation: string;
  model?: string;
  messages: ChatMessage[];
  responseFormat?: {
    type: "json_schema" | "json_object";
    jsonSchema?: {
      name: string;
      description?: string;
      schema?: Record<string, unknown>;
      strict?: boolean;
    };
  };
  temperature?: number;
}

export interface StreamJsonChatResult {
  content: string;
  reasoningTokens: number;
  totalTokens: number;
}

let openRouterClientPromise: Promise<any> | null = null;

function getLlmProvider(): "openrouter" | "grok" | "groq" {
  const provider = config.llmProvider;
  if (provider === "grok") {
    return "grok";
  }

  if (provider === "groq") {
    return "groq";
  }

  return "openrouter";
}

function buildProviderModel(requestModel?: string): string {
  const provider = getLlmProvider();

  if (provider === "grok") {
    return config.grokModel;
  }

  if (provider === "groq") {
    return config.groqModel;
  }

  return requestModel || config.openRouterModel;
}

/**
 * @returns {Promise} OpenRouter client instance or null if initialization fails (e.g. missing API key)
 * The function initializes and returns an OpenRouter client instance. It checks for the presence of the OPENROUTER_API_KEY environment variable and attempts to import and create the client. 
 * If the API key is missing or if initialization fails, it logs an error and returns null,calling functions handle the null case... dsfas
 */
async function getOpenRouterClient(): Promise<any | null> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.error("[openrouter] OPENROUTER_API_KEY is missing. Skipping API call and falling back.");
    return null;
  }

  if (!openRouterClientPromise) {
    openRouterClientPromise = import("@openrouter/sdk")
      .then(({ OpenRouter }) => {
        return new OpenRouter({
          apiKey,
          httpReferer:
            process.env.OPENROUTER_HTTP_REFERER || "https://web-researcher-agent.local",
          appTitle: process.env.OPENROUTER_APP_TITLE || "Web Researcher Agent",
        });
      })
      .catch((error) => {
        console.error("[openrouter] Failed to initialize OpenRouter client:", error);
        return null;
      });
  }

  return openRouterClientPromise;
}

/**
 * yet to be documented
 * @param request 
 * @returns 
 */
export async function streamJsonChatCompletion(
  request: StreamJsonChatRequest
): Promise<StreamJsonChatResult | null> {
  const startedAt = Date.now();
  const provider = getLlmProvider();
  if (provider === "grok") {
    const result = await streamGrokJsonChatCompletion(request);
    console.info(
      `[llm:${request.operation}] provider=grok elapsedMs=${Date.now() - startedAt} success=${Boolean(result)}`,
    );
    return result;
  }

  if (provider === "groq") {
    const result = await streamGroqJsonChatCompletion(request);
    console.info(
      `[llm:${request.operation}] provider=groq elapsedMs=${Date.now() - startedAt} success=${Boolean(result)}`,
    );
    return result;
  }

  try {
    const openrouter = await getOpenRouterClient();
    if (!openrouter) return null;

    const model = buildProviderModel(request.model);
    console.info(`[openrouter:${request.operation}] starting request model=${model}`);

    const stream = await openrouter.chat.send({
      chatRequest: {
        model,
        messages: request.messages,
        stream: true,
        temperature: request.temperature,
        ...(request.responseFormat ? { responseFormat: request.responseFormat } : {}),
      },
    });

    let content = "";
    let reasoningTokens = 0;
    let totalTokens = 0;

    for await (const chunk of stream as AsyncIterable<any>) {
      const deltaContent = chunk.choices?.[0]?.delta?.content;
      if (deltaContent) {
        content += deltaContent;
      }

      if (chunk.usage?.reasoningTokens != null) {
        reasoningTokens = chunk.usage.reasoningTokens;
      }

      if (chunk.usage?.totalTokens != null) {
        totalTokens = chunk.usage.totalTokens;
      }

      if (deltaContent || chunk.usage) {
        console.info(
          `[openrouter:${request.operation}] chunk content=${deltaContent ? JSON.stringify(deltaContent) : "<empty>"} reasoningTokens=${chunk.usage?.reasoningTokens ?? "n/a"} totalTokens=${chunk.usage?.totalTokens ?? "n/a"}`
        );
      }
    }

    console.info(
      `[openrouter:${request.operation}] completed model=${model} reasoningTokens=${reasoningTokens} totalTokens=${totalTokens}`
    );

    const result = { content, reasoningTokens, totalTokens };
    console.info(
      `[llm:${request.operation}] provider=openrouter elapsedMs=${Date.now() - startedAt} success=true`,
    );
    return result;
  } catch (error) {
    console.error(`[openrouter:${request.operation}] API call failed:`, error);
    console.info(
      `[llm:${request.operation}] provider=openrouter elapsedMs=${Date.now() - startedAt} success=false`,
    );
    return null;
  }
}

async function streamGrokJsonChatCompletion(
  request: StreamJsonChatRequest,
): Promise<StreamJsonChatResult | null> {
  try {
    const apiKey = config.grokApiKey;
    if (!apiKey) {
      console.error("[grok] GROK_API_KEY is missing. Skipping API call and falling back.");
      return null;
    }

    const model = buildProviderModel(request.model);
    const endpoint = process.env.GROK_API_BASE_URL || "https://api.x.ai/v1/chat/completions";

    const body: Record<string, unknown> = {
      model,
      messages: request.messages,
      stream: false,
      temperature: request.temperature,
    };

    if (request.responseFormat) {
      if (request.responseFormat.type === "json_object") {
        body.response_format = { type: "json_object" };
      } else if (request.responseFormat.type === "json_schema" && request.responseFormat.jsonSchema) {
        body.response_format = {
          type: "json_schema",
          json_schema: {
            name: request.responseFormat.jsonSchema.name,
            strict: request.responseFormat.jsonSchema.strict ?? true,
            schema: request.responseFormat.jsonSchema.schema || {},
          },
        };
      }
    }

    console.info(`[grok:${request.operation}] starting request model=${model}`);

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[grok:${request.operation}] request failed status=${response.status} body=${errorText}`);
      return null;
    }

    const payload = (await response.json()) as GrokChatCompletionResponse;
    const rawContent = payload.choices?.[0]?.message?.content;
    const content = Array.isArray(rawContent)
      ? rawContent.map((part) => (part?.type === "text" ? part.text || "" : "")).join("")
      : String(rawContent || "");

    const totalTokens = Number(payload.usage?.total_tokens || 0);
    const reasoningTokens = Number(payload.usage?.completion_tokens || 0);

    console.info(
      `[grok:${request.operation}] completed model=${model} reasoningTokens=${reasoningTokens} totalTokens=${totalTokens}`,
    );

    return {
      content,
      reasoningTokens,
      totalTokens,
    };
  } catch (error) {
    console.error(`[grok:${request.operation}] API call failed:`, error);
    return null;
  }
}

async function streamGroqJsonChatCompletion(
  request: StreamJsonChatRequest,
): Promise<StreamJsonChatResult | null> {
  try {
    const apiKey = config.groqApiKey;
    if (!apiKey) {
      console.error("[groq] GROQ_API_KEY is missing. Skipping API call and falling back.");
      return null;
    }

    const model = buildProviderModel(request.model);
    const endpoint = config.groqApiBaseUrl;

    const body: Record<string, unknown> = {
      model,
      messages: request.messages,
      stream: false,
      temperature: request.temperature,
    };

    if (request.responseFormat) {
      if (request.responseFormat.type === "json_object") {
        body.response_format = { type: "json_object" };
      } else if (request.responseFormat.type === "json_schema" && request.responseFormat.jsonSchema) {
        body.response_format = {
          type: "json_schema",
          json_schema: {
            name: request.responseFormat.jsonSchema.name,
            strict: request.responseFormat.jsonSchema.strict ?? true,
            schema: request.responseFormat.jsonSchema.schema || {},
          },
        };
      }
    }

    console.info(`[groq:${request.operation}] starting request model=${model}`);

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[groq:${request.operation}] request failed status=${response.status} body=${errorText}`);
      return null;
    }

    const payload = (await response.json()) as GroqChatCompletionResponse;
    const rawContent = payload.choices?.[0]?.message?.content;
    const content = Array.isArray(rawContent)
      ? rawContent.map((part) => (part?.type === "text" ? part.text || "" : "")).join("")
      : String(rawContent || "");

    const totalTokens = Number(payload.usage?.total_tokens || 0);
    const reasoningTokens = Number(payload.usage?.completion_tokens || 0);

    console.info(
      `[groq:${request.operation}] completed model=${model} reasoningTokens=${reasoningTokens} totalTokens=${totalTokens}`,
    );

    return {
      content,
      reasoningTokens,
      totalTokens,
    };
  } catch (error) {
    console.error(`[groq:${request.operation}] API call failed:`, error);
    return null;
  }
}
