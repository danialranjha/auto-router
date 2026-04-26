import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PolicyEngine, makePassthroughDecision } from "../src/policy-engine.ts";
import type { RouteTarget, RoutingContext } from "../src/types.ts";

const target: RouteTarget = { provider: "p", modelId: "m", label: "Lbl" };

const baseCtx: RoutingContext = {
  prompt: "hi",
  history: [],
  routeId: "r",
  estimatedTokens: 10,
  classification: "short",
  availableTargets: [target],
};

describe("PolicyEngine skeleton", () => {
  it("returns null with no rules registered", () => {
    const engine = new PolicyEngine();
    assert.equal(engine.decide(baseCtx), null);
    assert.equal(engine.getLastDecision(), null);
  });

  it("runs rules in priority order (lower runs first)", () => {
    const engine = new PolicyEngine({
      rules: [
        { name: "low", priority: 10, condition: () => true, action: (c) => makePassthroughDecision(target, c, "low") },
        { name: "high", priority: 1, condition: () => true, action: (c) => makePassthroughDecision(target, c, "high") },
      ],
    });
    assert.equal(engine.decide(baseCtx)?.phase, "high");
  });

  it("skips rules whose condition returns false", () => {
    const engine = new PolicyEngine({
      rules: [
        { name: "skip", priority: 1, condition: () => false, action: (c) => makePassthroughDecision(target, c, "skip") },
        { name: "match", priority: 2, condition: () => true, action: (c) => makePassthroughDecision(target, c, "match") },
      ],
    });
    assert.equal(engine.decide(baseCtx)?.phase, "match");
  });

  it("skips rules whose action returns null and falls through", () => {
    const engine = new PolicyEngine({
      rules: [
        { name: "null-action", priority: 1, condition: () => true, action: () => null },
        { name: "match", priority: 2, condition: () => true, action: (c) => makePassthroughDecision(target, c, "match") },
      ],
    });
    assert.equal(engine.decide(baseCtx)?.phase, "match");
  });

  it("records the most recent decision", () => {
    const engine = new PolicyEngine({
      rules: [
        { name: "match", priority: 1, condition: () => true, action: (c) => makePassthroughDecision(target, c, "match") },
      ],
    });
    engine.decide(baseCtx);
    assert.equal(engine.getLastDecision()?.phase, "match");
  });

  it("addRule re-sorts the rule list", () => {
    const engine = new PolicyEngine({
      rules: [
        { name: "late", priority: 100, condition: () => true, action: (c) => makePassthroughDecision(target, c, "late") },
      ],
    });
    engine.addRule({ name: "early", priority: 1, condition: () => true, action: (c) => makePassthroughDecision(target, c, "early") });
    assert.equal(engine.decide(baseCtx)?.phase, "early");
  });

  it("preserves explicit phase from action when provided", () => {
    const engine = new PolicyEngine({
      rules: [
        { name: "rule-name", priority: 1, condition: () => true, action: (c) => makePassthroughDecision(target, c, "explicit-phase") },
      ],
    });
    assert.equal(engine.decide(baseCtx)?.phase, "explicit-phase");
  });

  it("falls back to rule name when action omits phase", () => {
    const engine = new PolicyEngine({
      rules: [
        {
          name: "rule-name",
          priority: 1,
          condition: () => true,
          action: (c) => ({ ...makePassthroughDecision(target, c), phase: "" }),
        },
      ],
    });
    assert.equal(engine.decide(baseCtx)?.phase, "rule-name");
  });

  it("respects shadow mode flag", () => {
    const shadow = new PolicyEngine({ shadowMode: true });
    const live = new PolicyEngine({ shadowMode: false });
    assert.equal(shadow.shadowMode, true);
    assert.equal(live.shadowMode, false);
  });
});
