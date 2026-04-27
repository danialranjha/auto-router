import type { BudgetState, UVIStatus, UtilizationSnapshot } from "./types.ts";

export type BudgetAuditHint = "promote" | "demote";

export type BudgetAuditResult = {
  status: "ok" | "warning" | "blocked";
  provider: string;
  spend: number;
  limit: number | null;
  remaining: number | null;
  usageRatio: number | null;
  message?: string;
  uvi?: number;
  utilizationStatus?: UVIStatus;
  hint?: BudgetAuditHint;
  utilizationReason?: string;
};

function auditUsd(provider: string, budgetState: BudgetState | undefined, estimatedAdditionalUsd: number): BudgetAuditResult {
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

function applyUtilization(base: BudgetAuditResult, util: UtilizationSnapshot | undefined, provider: string): BudgetAuditResult {
  if (!util) return base;
  const result: BudgetAuditResult = { ...base, uvi: util.uvi, utilizationStatus: util.status, utilizationReason: util.reason };

  if (util.status === "critical") {
    return {
      ...result,
      status: "blocked",
      message: result.message ?? `${provider} UVI critical (${util.uvi.toFixed(2)}); ${util.reason}`,
    };
  }

  if (util.status === "stressed") {
    const message = `${provider} UVI stressed (${util.uvi.toFixed(2)}); ${util.reason}`;
    if (result.status === "ok") {
      return { ...result, status: "warning", hint: "demote", message };
    }
    return { ...result, hint: "demote", message: result.message ?? message };
  }

  if (util.status === "surplus") {
    return { ...result, hint: "promote" };
  }

  return result;
}

export function auditBudget(
  provider: string,
  budgetState: BudgetState | undefined,
  estimatedAdditionalUsd = 0,
): BudgetAuditResult {
  const base = auditUsd(provider, budgetState, estimatedAdditionalUsd);
  const util = budgetState?.utilization?.[provider];
  return applyUtilization(base, util, provider);
}
