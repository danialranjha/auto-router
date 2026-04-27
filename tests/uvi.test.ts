import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  aggregateProviderUVI,
  classifyUVI,
  computeElapsedFraction,
  computeUVI,
} from "../src/uvi.ts";
import { DEFAULT_UVI_THRESHOLDS, type QuotaWindow } from "../src/types.ts";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function makeWindow(overrides: Partial<QuotaWindow> = {}): QuotaWindow {
  const now = 1_700_000_000_000;
  return {
    provider: "anthropic",
    scope: "session",
    usedPercent: 50,
    windowDurationMs: 5 * HOUR,
    resetsAt: new Date(now + 2.5 * HOUR).toISOString(),
    source: "oauth-usage",
    fetchedAt: now,
    ...overrides,
  };
}

describe("computeElapsedFraction", () => {
  it("returns 0.5 when half the window remains", () => {
    const now = 1_700_000_000_000;
    const w = makeWindow({ resetsAt: new Date(now + 2.5 * HOUR).toISOString() });
    assert.equal(computeElapsedFraction(w, now), 0.5);
  });

  it("returns 1 when reset time has passed", () => {
    const now = 1_700_000_000_000;
    const w = makeWindow({ resetsAt: new Date(now - HOUR).toISOString() });
    assert.equal(computeElapsedFraction(w, now), 1);
  });

  it("returns 0 when full window remaining", () => {
    const now = 1_700_000_000_000;
    const w = makeWindow({ resetsAt: new Date(now + 5 * HOUR).toISOString() });
    assert.equal(computeElapsedFraction(w, now), 0);
  });

  it("uses resetsInSec when resetsAt missing", () => {
    const now = 1_700_000_000_000;
    const w = makeWindow({
      resetsAt: undefined,
      resetsInSec: 2.5 * 60 * 60,
      fetchedAt: now,
    });
    assert.equal(computeElapsedFraction(w, now), 0.5);
  });

  it("returns 0 when no reset info", () => {
    const w = makeWindow({ resetsAt: undefined, resetsInSec: undefined });
    assert.equal(computeElapsedFraction(w, 1_700_000_000_000), 0);
  });
});

describe("computeUVI", () => {
  it("returns ~1.0 when on-pace (50% used at 50% elapsed)", () => {
    const now = 1_700_000_000_000;
    const w = makeWindow({ usedPercent: 50, resetsAt: new Date(now + 2.5 * HOUR).toISOString() });
    assert.equal(computeUVI(w, now), 1);
  });

  it("returns >1.5 when burning fast (75% used at 25% elapsed)", () => {
    const now = 1_700_000_000_000;
    const w = makeWindow({
      usedPercent: 75,
      resetsAt: new Date(now + 3.75 * HOUR).toISOString(),
    });
    const uvi = computeUVI(w, now);
    assert.ok(uvi >= 3, `expected high UVI, got ${uvi}`);
  });

  it("returns <1 when underutilized", () => {
    const now = 1_700_000_000_000;
    const w = makeWindow({ usedPercent: 10, resetsAt: new Date(now + 0.5 * HOUR).toISOString() });
    assert.ok(computeUVI(w, now) < 1);
  });

  it("clamps elapsed via epsilon to avoid div-by-zero at window start", () => {
    const now = 1_700_000_000_000;
    const w = makeWindow({ usedPercent: 1, resetsAt: new Date(now + 5 * HOUR).toISOString() });
    const uvi = computeUVI(w, now);
    assert.ok(Number.isFinite(uvi));
    assert.ok(uvi > 0 && uvi < 1);
  });
});

describe("classifyUVI", () => {
  it("flags critical above the critical threshold", () => {
    assert.equal(classifyUVI(2.5, 0.3), "critical");
  });

  it("flags stressed between stressed and critical", () => {
    assert.equal(classifyUVI(1.7, 0.3), "stressed");
  });

  it("flags surplus only when elapsed past surplusMinElapsed", () => {
    assert.equal(classifyUVI(0.3, 0.8), "surplus");
    assert.equal(classifyUVI(0.3, 0.4), "ok");
  });

  it("returns ok in the normal band", () => {
    assert.equal(classifyUVI(0.9, 0.5), "ok");
  });

  it("respects custom thresholds", () => {
    const t = { stressed: 1.2, critical: 1.5, surplus: 0.8, surplusMinElapsed: 0.5 };
    assert.equal(classifyUVI(1.3, 0.4, t), "stressed");
    assert.equal(classifyUVI(1.6, 0.4, t), "critical");
    assert.equal(classifyUVI(0.5, 0.6, t), "surplus");
  });
});

describe("aggregateProviderUVI", () => {
  it("returns ok with empty windows", () => {
    const snap = aggregateProviderUVI("anthropic", [], 1_700_000_000_000);
    assert.equal(snap.status, "ok");
    assert.equal(snap.uvi, 0);
    assert.match(snap.reason, /no quota data/);
  });

  it("uses the worst window", () => {
    const now = 1_700_000_000_000;
    const sessionWindow = makeWindow({
      scope: "session",
      usedPercent: 80,
      windowDurationMs: 5 * HOUR,
      resetsAt: new Date(now + 4 * HOUR).toISOString(),
    });
    const weeklyWindow = makeWindow({
      scope: "weekly",
      usedPercent: 30,
      windowDurationMs: 7 * DAY,
      resetsAt: new Date(now + 3 * DAY).toISOString(),
    });
    const snap = aggregateProviderUVI("anthropic", [sessionWindow, weeklyWindow], now);
    assert.equal(snap.status, "critical");
    assert.ok(snap.uvi >= DEFAULT_UVI_THRESHOLDS.critical);
    assert.match(snap.reason, /session@80%/);
  });

  it("marks snapshot stale when any window is stale-cache", () => {
    const now = 1_700_000_000_000;
    const w = makeWindow({ source: "stale-cache" });
    const snap = aggregateProviderUVI("anthropic", [w], now);
    assert.equal(snap.stale, true);
  });
});
