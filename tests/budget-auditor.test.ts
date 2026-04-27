import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { auditBudget } from "../src/budget-auditor.ts";
import type { UVIStatus, UtilizationSnapshot } from "../src/types.ts";

function snap(provider: string, status: UVIStatus, uvi: number): UtilizationSnapshot {
  return { provider, status, uvi, windows: [], reason: `${status} (test)`, fetchedAt: 1 };
}

describe("auditBudget", () => {
  it("allows providers with no configured limit", () => {
    const result = auditBudget("openai-codex", { dailySpend: {}, dailyLimit: {} });
    assert.equal(result.status, "ok");
    assert.equal(result.limit, null);
  });

  it("allows spend below 80%", () => {
    const result = auditBudget("openai-codex", { dailySpend: { "openai-codex": 1 }, dailyLimit: { "openai-codex": 10 } });
    assert.equal(result.status, "ok");
    assert.equal(result.remaining, 9);
  });

  it("warns at 80%+", () => {
    const result = auditBudget("openai-codex", { dailySpend: { "openai-codex": 8 }, dailyLimit: { "openai-codex": 10 } });
    assert.equal(result.status, "warning");
    assert.match(result.message ?? "", /near its daily budget/);
  });

  it("blocks at or above 100%", () => {
    const result = auditBudget("openai-codex", { dailySpend: { "openai-codex": 10 }, dailyLimit: { "openai-codex": 10 } });
    assert.equal(result.status, "blocked");
    assert.match(result.message ?? "", /at or above its daily budget/);
  });

  it("uses projected spend when additional cost is provided", () => {
    const result = auditBudget("openai-codex", { dailySpend: { "openai-codex": 7.9 }, dailyLimit: { "openai-codex": 10 } }, 0.2);
    assert.equal(result.status, "warning");
  });

  it("blocks when UVI is critical even without USD limit", () => {
    const result = auditBudget("anthropic", {
      dailySpend: {},
      dailyLimit: {},
      utilization: { anthropic: snap("anthropic", "critical", 2.4) },
    });
    assert.equal(result.status, "blocked");
    assert.equal(result.uvi, 2.4);
    assert.equal(result.utilizationStatus, "critical");
  });

  it("warns and emits demote hint when UVI is stressed", () => {
    const result = auditBudget("anthropic", {
      dailySpend: {},
      dailyLimit: {},
      utilization: { anthropic: snap("anthropic", "stressed", 1.7) },
    });
    assert.equal(result.status, "warning");
    assert.equal(result.hint, "demote");
    assert.equal(result.utilizationStatus, "stressed");
  });

  it("emits promote hint when UVI is surplus", () => {
    const result = auditBudget("openai-codex", {
      dailySpend: {},
      dailyLimit: {},
      utilization: { "openai-codex": snap("openai-codex", "surplus", 0.3) },
    });
    assert.equal(result.status, "ok");
    assert.equal(result.hint, "promote");
    assert.equal(result.utilizationStatus, "surplus");
  });

  it("UVI critical overrides USD-ok status", () => {
    const result = auditBudget("anthropic", {
      dailySpend: { anthropic: 1 },
      dailyLimit: { anthropic: 10 },
      utilization: { anthropic: snap("anthropic", "critical", 2.5) },
    });
    assert.equal(result.status, "blocked");
  });

  it("USD blocked stays blocked with no UVI", () => {
    const result = auditBudget("openai-codex", {
      dailySpend: { "openai-codex": 10 },
      dailyLimit: { "openai-codex": 10 },
    });
    assert.equal(result.status, "blocked");
    assert.equal(result.hint, undefined);
  });
});
