import type { PolicyRule, RouteTarget, RoutingContext, RoutingDecision } from "./types.ts";

export type PolicyEngineOptions = {
  rules?: PolicyRule[];
  shadowMode?: boolean;
};

export class PolicyEngine {
  private rules: PolicyRule[];
  readonly shadowMode: boolean;
  private lastDecision: RoutingDecision | null = null;

  constructor(options: PolicyEngineOptions = {}) {
    this.rules = [...(options.rules ?? [])].sort((a, b) => a.priority - b.priority);
    this.shadowMode = options.shadowMode ?? false;
  }

  addRule(rule: PolicyRule): void {
    this.rules.push(rule);
    this.rules.sort((a, b) => a.priority - b.priority);
  }

  getRules(): readonly PolicyRule[] {
    return this.rules;
  }

  getLastDecision(): RoutingDecision | null {
    return this.lastDecision;
  }

  decide(ctx: RoutingContext): RoutingDecision | null {
    for (const rule of this.rules) {
      if (!rule.condition(ctx)) continue;
      const decision = rule.action(ctx);
      if (decision) {
        this.lastDecision = { ...decision, phase: decision.phase || rule.name };
        return this.lastDecision;
      }
    }
    return null;
  }
}

export function makePassthroughDecision(
  target: RouteTarget,
  ctx: RoutingContext,
  phase = "passthrough",
): RoutingDecision {
  return {
    tier: ctx.userHint ?? "swe",
    phase,
    target,
    reasoning: "Passthrough: selected target without policy override",
    metadata: {
      estimatedTokens: ctx.estimatedTokens,
      budgetRemaining: 0,
      confidence: 0.1,
    },
  };
}
