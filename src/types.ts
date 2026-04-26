export type Tier = "reasoning" | "swe" | "long" | "economy" | "vision";

export type ContextClassification = "short" | "medium" | "long" | "epic";

export type RouteTarget = {
  provider: string;
  modelId: string;
  authProvider?: string;
  label: string;
};

export type Message = {
  role: string;
  content: unknown;
};

export type BudgetState = {
  dailySpend: Record<string, number>;
  dailyLimit: Record<string, number>;
};

export type RoutingDecision = {
  tier: Tier;
  phase: string;
  target: RouteTarget;
  reasoning: string;
  metadata: {
    estimatedTokens: number;
    budgetRemaining: number;
    confidence: number;
  };
};

export type RoutingContext = {
  prompt: string;
  history: Message[];
  routeId: string;
  estimatedTokens: number;
  classification: ContextClassification;
  availableTargets: RouteTarget[];
  userHint?: Tier;
  budgetState?: BudgetState;
};

export type PolicyRule = {
  name: string;
  priority: number;
  condition: (ctx: RoutingContext) => boolean;
  action: (ctx: RoutingContext) => RoutingDecision | null;
};

export type ShortcutEntry = {
  tier: Tier;
  description: string;
  pattern: RegExp;
};

export type ShortcutRegistry = Record<string, ShortcutEntry>;
