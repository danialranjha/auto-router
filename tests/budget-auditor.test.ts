import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { auditBudget } from "../src/budget-auditor.ts";

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
});
