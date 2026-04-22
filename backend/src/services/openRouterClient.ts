import OpenAI from "openai";

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

let grokClient: OpenAI | null = null;

/**
 * @returns {OpenAI | null} Grok (xAI) client instance or null if initialization fails (e.g. missing API key).
 * Uses the OpenAI-compatible xAI API with base URL https://api.x.ai/v1.
 * Requires XAI_API_KEY environment variable to be set.
 */
function getGrokClient(): OpenAI | null {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) {
    console.error("[grok] XAI_API_KEY is missing. Skipping API call and falling back.");
    return null;
  }

  if (!grokClient) {
    grokClient = new OpenAI({
      apiKey,
      baseURL: "https://api.x.ai/v1",
    });
  }

  return grokClient;
}

/**
 * Sends a chat completion request to the Grok API (xAI) and returns the full response content.
 * Streams the response internally and accumulates the full content before returning.
 * Falls back to null if the API key is missing or the request fails.
 */
export async function streamJsonChatCompletion(
  request: StreamJsonChatRequest
): Promise<StreamJsonChatResult | null> {
  try {
    const client = getGrokClient();
    if (!client) return null;

    const model = request.model || process.env.GROK_MODEL || "grok-3-mini";
    console.info(`[grok:${request.operation}] starting request model=${model}`);

    // Build response_format for OpenAI-compatible API.
    // Grok supports json_object; map json_schema requests to json_object for compatibility.
    let responseFormat: OpenAI.Chat.Completions.ChatCompletionCreateParams["response_format"] | undefined;
    if (request.responseFormat) {
      if (request.responseFormat.type === "json_schema" && request.responseFormat.jsonSchema) {
        responseFormat = {
          type: "json_schema",
          json_schema: {
            name: request.responseFormat.jsonSchema.name,
            description: request.responseFormat.jsonSchema.description,
            schema: request.responseFormat.jsonSchema.schema,
            strict: request.responseFormat.jsonSchema.strict ?? true,
          },
        } as OpenAI.Chat.Completions.ChatCompletionCreateParams["response_format"];
      } else {
        responseFormat = { type: "json_object" };
      }
    }

    const stream = await client.chat.completions.create({
      model,
      messages: request.messages,
      stream: true,
      temperature: request.temperature,
      ...(responseFormat ? { response_format: responseFormat } : {}),
    });

    let content = "";
    let reasoningTokens = 0;
    let totalTokens = 0;

    for await (const chunk of stream) {
      const deltaContent = chunk.choices?.[0]?.delta?.content;
      if (deltaContent) {
        content += deltaContent;
      }

      if (chunk.usage?.completion_tokens_details != null) {
        reasoningTokens = (chunk.usage.completion_tokens_details as any).reasoning_tokens ?? 0;
      }

      if (chunk.usage?.total_tokens != null) {
        totalTokens = chunk.usage.total_tokens;
      }

      if (deltaContent || chunk.usage) {
        console.info(
          `[grok:${request.operation}] chunk content=${deltaContent ? JSON.stringify(deltaContent) : "<empty>"} totalTokens=${chunk.usage?.total_tokens ?? "n/a"}`
        );
      }
    }

    console.info(
      `[grok:${request.operation}] completed model=${model} reasoningTokens=${reasoningTokens} totalTokens=${totalTokens}`
    );

    return { content, reasoningTokens, totalTokens };
  } catch (error) {
    console.error(`[grok:${request.operation}] API call failed:`, error);
    return null;
  }
}
