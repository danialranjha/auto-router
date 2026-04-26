import type { ContextClassification, Message, RouteTarget, RoutingContext } from "./types.ts";

const CHARS_PER_TOKEN = 4;

export const SHORT_MAX_TOKENS = 1_000;
export const MEDIUM_MAX_TOKENS = 16_000;
export const LONG_MAX_TOKENS = 128_000;

export function estimateTokensFromText(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export function estimateTokensFromMessage(message: Message | null | undefined): number {
  if (!message) return 0;
  const content = message.content;
  if (typeof content === "string") return estimateTokensFromText(content);
  if (Array.isArray(content)) {
    let total = 0;
    for (const part of content) {
      if (!part) continue;
      if (typeof part === "string") {
        total += estimateTokensFromText(part);
        continue;
      }
      if (typeof part === "object") {
        const text = (part as Record<string, unknown>).text;
        if (typeof text === "string") total += estimateTokensFromText(text);
      }
    }
    return total;
  }
  if (content && typeof content === "object") {
    try {
      return estimateTokensFromText(JSON.stringify(content));
    } catch {
      return 0;
    }
  }
  return 0;
}

export function estimateTotalTokens(prompt: string, history: Message[] = []): number {
  let total = estimateTokensFromText(prompt);
  for (const message of history) total += estimateTokensFromMessage(message);
  return total;
}

export function classifyContext(estimatedTokens: number): ContextClassification {
  if (estimatedTokens <= SHORT_MAX_TOKENS) return "short";
  if (estimatedTokens <= MEDIUM_MAX_TOKENS) return "medium";
  if (estimatedTokens <= LONG_MAX_TOKENS) return "long";
  return "epic";
}

export type ContextAnalysisInput = {
  prompt: string;
  history?: Message[];
  routeId: string;
  availableTargets: RouteTarget[];
  userHint?: RoutingContext["userHint"];
  budgetState?: RoutingContext["budgetState"];
};

export function buildRoutingContext(input: ContextAnalysisInput): RoutingContext {
  const history = input.history ?? [];
  const estimatedTokens = estimateTotalTokens(input.prompt, history);
  return {
    prompt: input.prompt,
    history,
    routeId: input.routeId,
    estimatedTokens,
    classification: classifyContext(estimatedTokens),
    availableTargets: input.availableTargets,
    userHint: input.userHint,
    budgetState: input.budgetState,
  };
}
