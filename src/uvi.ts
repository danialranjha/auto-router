import {
  DEFAULT_UVI_THRESHOLDS,
  type QuotaWindow,
  type UVIStatus,
  type UVIThresholds,
  type UtilizationSnapshot,
} from "./types.ts";

const EPSILON = 0.05;

export function computeElapsedFraction(window: QuotaWindow, now: number): number {
  const duration = window.windowDurationMs;
  if (!Number.isFinite(duration) || duration <= 0) return 0;

  let remainingMs: number | null = null;
  if (window.resetsAt) {
    const resetMs = new Date(window.resetsAt).getTime();
    if (Number.isFinite(resetMs)) remainingMs = resetMs - now;
  }
  if (remainingMs == null && typeof window.resetsInSec === "number" && Number.isFinite(window.resetsInSec)) {
    remainingMs = (window.fetchedAt ? window.fetchedAt - now : 0) + window.resetsInSec * 1000;
  }
  if (remainingMs == null) return 0;

  const clampedRemaining = Math.max(0, Math.min(duration, remainingMs));
  return Math.max(0, Math.min(1, 1 - clampedRemaining / duration));
}

export function computeUVI(window: QuotaWindow, now: number): number {
  const consumed = Math.max(0, Math.min(1, window.usedPercent / 100));
  const elapsed = computeElapsedFraction(window, now);
  const denom = Math.max(elapsed, EPSILON);
  const uvi = consumed / denom;
  return Number.isFinite(uvi) ? uvi : 0;
}

export function classifyUVI(
  uvi: number,
  elapsedFraction: number,
  thresholds: UVIThresholds = DEFAULT_UVI_THRESHOLDS,
): UVIStatus {
  if (uvi >= thresholds.critical) return "critical";
  if (uvi >= thresholds.stressed) return "stressed";
  if (uvi <= thresholds.surplus && elapsedFraction >= thresholds.surplusMinElapsed) return "surplus";
  return "ok";
}

function describeWindow(window: QuotaWindow): string {
  const pct = `${window.usedPercent.toFixed(0)}%`;
  return `${window.scope}@${pct}`;
}

export function aggregateProviderUVI(
  provider: string,
  windows: QuotaWindow[],
  now: number,
  thresholds: UVIThresholds = DEFAULT_UVI_THRESHOLDS,
): UtilizationSnapshot {
  if (!windows || windows.length === 0) {
    return {
      provider,
      uvi: 0,
      status: "ok",
      windows: [],
      reason: "no quota data",
      fetchedAt: now,
    };
  }

  let worstUvi = -Infinity;
  let worstWindow: QuotaWindow | null = null;
  let worstElapsed = 0;
  for (const w of windows) {
    const elapsed = computeElapsedFraction(w, now);
    const uvi = computeUVI(w, now);
    if (uvi > worstUvi) {
      worstUvi = uvi;
      worstWindow = w;
      worstElapsed = elapsed;
    }
  }

  const status = worstWindow ? classifyUVI(worstUvi, worstElapsed, thresholds) : "ok";
  const summary = windows.map(describeWindow).join(", ");
  const fetchedAt = Math.max(...windows.map((w) => w.fetchedAt || 0)) || now;
  const stale = windows.some((w) => w.source === "stale-cache");

  return {
    provider,
    uvi: Number.isFinite(worstUvi) ? Number(worstUvi.toFixed(3)) : 0,
    status,
    windows,
    reason: `${status} (worst: ${worstWindow ? describeWindow(worstWindow) : "n/a"}; all: ${summary})`,
    stale: stale || undefined,
    fetchedAt,
  };
}
