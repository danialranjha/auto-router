import type { BudgetState } from "./types.ts";

export type BudgetAuditResult = {
  status: "ok" | "warning" | "blocked";
  provider: string;
  spend: number;
  limit: number | null;
  remaining: number | null;
  usageRatio: number | null;
  message?: string;
};

export function auditBudget(provider: string, budgetState: BudgetState | undefined, estimatedAdditionalUsd = 0): BudgetAuditResult {
  const spend = budgetState?.dailySpend?.[provider] ?? 0;
  const limit = budgetState?.dailyLimit?.[provider];
  if (!(typeof limit === "number") || !Number.isFinite(limit) || limit <= 0) {
    return { status: "ok", provider, spend, limit: null, remaining: null, usageRatio: null };
  }

  const projected = spend + Math.max(0, estimatedAdditionalUsd);
  const remaining = Math.max(0, limit - projected);
  const usageRatio = limit > 0 ? projected / limit : null;

  if (projected >= limit) {
    return {
      status: "blocked",
      provider,
      spend,
      limit,
      remaining,
      usageRatio,
      message: `${provider} is at or above its daily budget ($${projected.toFixed(2)} / $${limit.toFixed(2)})`,
    };
  }

  if (projected >= limit * 0.8) {
    return {
      status: "warning",
      provider,
      spend,
      limit,
      remaining,
      usageRatio,
      message: `${provider} is near its daily budget ($${projected.toFixed(2)} / $${limit.toFixed(2)})`,
    };
  }

  return { status: "ok", provider, spend, limit, remaining, usageRatio };
}
