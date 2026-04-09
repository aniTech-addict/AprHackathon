type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

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
  try {
    const openrouter = await getOpenRouterClient();
    if (!openrouter) return null;

    const model = request.model || process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini";
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

    return { content, reasoningTokens, totalTokens };
  } catch (error) {
    console.error(`[openrouter:${request.operation}] API call failed:`, error);
    return null;
  }
}
