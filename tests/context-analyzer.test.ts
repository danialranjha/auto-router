import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildRoutingContext,
  classifyContext,
  estimateTokensFromMessage,
  estimateTokensFromText,
  estimateTotalTokens,
} from "../src/context-analyzer.ts";

describe("estimateTokensFromText", () => {
  it("returns 0 for empty/falsy text", () => {
    assert.equal(estimateTokensFromText(""), 0);
    assert.equal(estimateTokensFromText(undefined as unknown as string), 0);
  });
  it("rounds up at 4 chars per token", () => {
    assert.equal(estimateTokensFromText("abcd"), 1);
    assert.equal(estimateTokensFromText("abcde"), 2);
    assert.equal(estimateTokensFromText("a".repeat(401)), 101);
  });
});

describe("estimateTokensFromMessage", () => {
  it("handles string content", () => {
    assert.equal(estimateTokensFromMessage({ role: "user", content: "abcdefgh" }), 2);
  });
  it("handles array of typed text parts", () => {
    const tokens = estimateTokensFromMessage({
      role: "user",
      content: [
        { type: "text", text: "abcd" },
        { type: "text", text: "efgh" },
      ],
    });
    assert.equal(tokens, 2);
  });
  it("handles array of plain strings", () => {
    assert.equal(estimateTokensFromMessage({ role: "user", content: ["abcd", "efgh"] }), 2);
  });
  it("handles unknown content shape gracefully", () => {
    assert.equal(estimateTokensFromMessage({ role: "user", content: 42 as unknown }), 0);
    assert.equal(estimateTokensFromMessage(null as unknown as never), 0);
  });
  it("falls back to JSON for object content", () => {
    const tokens = estimateTokensFromMessage({ role: "tool", content: { foo: "bar" } });
    assert.ok(tokens > 0);
  });
});

describe("estimateTotalTokens", () => {
  it("sums prompt and history", () => {
    const total = estimateTotalTokens("abcd", [
      { role: "user", content: "efgh" },
      { role: "assistant", content: "ijkl" },
    ]);
    assert.equal(total, 3);
  });
});

describe("classifyContext", () => {
  it("buckets by token count at the documented thresholds", () => {
    assert.equal(classifyContext(0), "short");
    assert.equal(classifyContext(1_000), "short");
    assert.equal(classifyContext(1_001), "medium");
    assert.equal(classifyContext(16_000), "medium");
    assert.equal(classifyContext(16_001), "long");
    assert.equal(classifyContext(128_000), "long");
    assert.equal(classifyContext(128_001), "epic");
  });
});

describe("buildRoutingContext", () => {
  it("produces a context with totals and classification", () => {
    const ctx = buildRoutingContext({
      prompt: "hello",
      history: [{ role: "user", content: "abcdefgh" }],
      routeId: "subscription-premium",
      availableTargets: [],
    });
    assert.equal(ctx.estimatedTokens, estimateTotalTokens("hello", [{ role: "user", content: "abcdefgh" }]));
    assert.equal(ctx.classification, "short");
    assert.equal(ctx.routeId, "subscription-premium");
    assert.deepEqual(ctx.availableTargets, []);
  });
  it("defaults history to empty", () => {
    const ctx = buildRoutingContext({ prompt: "hi", routeId: "r", availableTargets: [] });
    assert.deepEqual(ctx.history, []);
  });
});
