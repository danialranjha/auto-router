# Phase 7 Plan: Dynamic Budget Reallocation via Utilization Velocity Index (UVI)

## Goal
Shift the budget auditor from a **static daily USD ceiling** to a **dynamic pressure signal** based on how fast each OAuth provider is burning through its real reset-window quota relative to how much of that window remains. UVI is then consumed by the selector to:
- **Tax** providers trending toward premature exhaustion (UVI > 1.0).
- **Unlock** premium providers for standard tasks when surplus is detected near the end of a reset cycle.

## Core Concept

```
UVI = consumed_fraction / elapsed_fraction_of_window
```

- `UVI ≈ 1.0` → on-pace
- `UVI > 1.0` → burning faster than safe → **tax** (deprioritize for non-essential calls)
- `UVI < 1.0` → underutilized → **unlock** for non-premium tiers

Thresholds (configurable):
- `UVI > 1.5` → **stressed** — only pick when tier strictly requires this provider
- `UVI > 2.0` → **critical** — treat like over-budget (skip unless last-resort fallback)
- `UVI < 0.5` AND `elapsedFraction > 0.7` → **surplus** — eligible for promotion to lower tiers

## Key Pivot from v1 of this Plan

**Old idea:** parse rate-limit response headers from each completed request + a config-declared token cap.

**New idea (from `pi-usage-bars/core.ts`):** call each provider's actual OAuth usage endpoint directly. Those endpoints *already* return `used_percent` and `resets_at` — exactly the inputs UVI needs. No header plumbing, no config caps.

This means:
- We don't need to expose response headers through the streaming SDK layer (was Open Question #1 in v1).
- We don't need users to declare token caps (was Open Question #2).
- "Active polling" is no longer a Phase 7.1 deferral — it's the primary path.

## Reference Implementation Analysis

`pi-usage-bars/extensions/usage-bars/core.ts` already implements:

| Provider | Endpoint | Auth | Window data |
|---|---|---|---|
| `openai-codex` | `chatgpt.com/backend-api/wham/usage` | OAuth `Bearer` | `primary_window` (5h) + `secondary_window` (7d) with `used_percent` and `reset_after_seconds` |
| `anthropic` | `api.anthropic.com/api/oauth/usage` (header `anthropic-beta: oauth-2025-04-20`) | OAuth `Bearer` | `five_hour.{utilization,resets_at}`, `seven_day.{utilization,resets_at}`, plus `extra_usage.{used_credits,monthly_limit}` for credit overage |
| `google-gemini-cli` | `cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota` POST | OAuth `Bearer` + `projectId` discovered via `:loadCodeAssist` | bucket-shaped `[{ tokenType, modelId, remainingFraction }]`; usage-bars picks the most-used REQUESTS bucket (gemini-pro primary, gemini-flash secondary) |
| `google-antigravity` | same Google endpoint | same | same buckets, but primary is `claude` non-thinking → fallback to gemini-pro → flash |

Also provides for free:
- Token refresh via `@mariozechner/pi-ai`'s `getOAuthApiKey()` — handles token expiry transparently and persists back to `~/.pi/agent/auth.json`.
- 429 handling: `retry-after` parsing, exponential backoff (2m → 30m capped), persisted cooldown state, stale-cache fallback so we still have *some* signal during cooldown.
- File-locked cache (`~/.pi/usage-bars-cache.json` or tmpdir variant) to prevent concurrent processes from hammering the endpoints.

## Decision: Reuse vs. Vendor vs. Re-implement

Three options:

**A. Add `pi-usage-bars` (or a sub-package of it) as a dependency.**  
Cleanest. Risk: it's a single-author repo and may not publish a library entrypoint — would need to confirm. The file is in `extensions/usage-bars/` which suggests it's structured as a Pi extension, not a published lib.

**B. Vendor `core.ts` into `src/quota-fetcher.ts`.**  
Copy the file (with attribution), strip the parts we don't need (z.ai, the formatting helpers used by the bar UI), and treat it as our own module. Pro: zero coupling, full control. Con: stale upstream when providers change endpoints.

**C. Re-implement from scratch using usage-bars as a spec.**  
Pointless given (B) is just `cp` + edits.

**Proposal:** **Option B**, vendor it. Concretely: import the necessary functions verbatim into `src/quota-fetcher.ts` with a header comment crediting `ajarellanod/pi-usage-bars`. Keep the surface small: `fetchAllUsages()`, `fetchClaudeUsageWithFallback()`, `fetchCodexUsage()`, `fetchGoogleUsage()`, plus the auth-refresh helper. Drop z.ai bits since we don't use it.

## File-by-File Changes

### `src/types.ts`
- `QuotaWindow`:
  ```ts
  type QuotaWindow = {
    provider: string;             // e.g. "anthropic", "openai-codex"
    scope: "session" | "weekly" | "monthly";
    usedPercent: number;          // 0–100
    resetsAt?: string;            // ISO timestamp when known
    resetsInSec?: number;         // alternative when only relative time provided (codex)
    windowDurationMs: number;     // 5h, 7d, etc — needed to compute elapsedFraction
    source: "oauth-usage" | "stale-cache";
    fetchedAt: number;
  };
  ```
- `UtilizationSnapshot`:
  ```ts
  type UtilizationSnapshot = {
    provider: string;
    uvi: number;                  // worst-window UVI
    status: "ok" | "surplus" | "stressed" | "critical";
    windows: QuotaWindow[];
    reason: string;
    error?: string;               // populated when fetch failed
    stale?: boolean;
  };
  ```
- Extend `BudgetState` with `utilization?: Record<string, UtilizationSnapshot>`.

### `src/quota-fetcher.ts` (new — vendored from pi-usage-bars)
- Functions imported (lightly trimmed, attribution comment):
  - `readAuth`, `writeAuth`, `ensureFreshAuthForProviders`
  - `fetchCodexUsage(token, config)` → returns `{ session, weekly, sessionResetsIn, weeklyResetsIn }`
  - `fetchClaudeUsageWithFallback(config)` → handles 429 cache + auto refresh
  - `fetchGoogleUsage(token, endpoint, projectId, "gemini"|"antigravity", config)` + `discoverGoogleProjectId`
  - `fetchAllUsages(config)` orchestration
- Adapter layer to convert pi-usage-bars `UsageData` → our `QuotaWindow[]`:
  - Codex: `[{ scope:"session", windowDurationMs: 5h }, { scope:"weekly", windowDurationMs: 7d }]`
  - Claude: same two windows + optional `monthly` from `extra_usage`
  - Gemini/Antigravity: model returns aggregate %; treat as a single window with `windowDurationMs: 24h` (Google's quotas reset daily; confirm vs. the buckets — open question)
- **Window duration constants** to be confirmed empirically:
  - Codex: `primary_window = 5h`, `secondary_window = 7d` (per the code's reset_after_seconds)
  - Claude: `five_hour = 5h`, `seven_day = 7d` (clear from field names)
  - Google: TBD — buckets don't expose duration; we may have to assume daily

### `src/uvi.ts` (new — pure math, no I/O)
- `computeUVI(window: QuotaWindow, now: number): number`
  - `consumedFraction = window.usedPercent / 100`
  - `elapsedFraction = 1 - max(0, (resetTime - now) / windowDurationMs)`
  - `return consumedFraction / max(elapsedFraction, ε)` — clamp ε to e.g. 0.05 to avoid div-by-zero at window start
- `classifyUVI(uvi: number, elapsedFraction: number): UVIStatus`
  - Surplus requires both `elapsedFraction > 0.7` and `uvi < 0.5`.
- `aggregateProviderUVI(windows: QuotaWindow[], now: number): UtilizationSnapshot`
  - Worst-window dominates. Reason string lists the dominant window.

### `src/quota-cache.ts` (new — thin layer over pi-usage-bars cache file)
- We re-use the existing `~/.pi/agent/extensions/auto-router.stats.json`-adjacent file or simply piggyback on the usage-bars cache (`~/.pi/usage-bars-cache.json` if present, falling back to our own).
- Refresh policy:
  - In-memory cached snapshot, default TTL **60s** (configurable via env `AUTO_ROUTER_UVI_TTL_MS`).
  - Hard floor of **30s** between calls per provider.
  - On 429: respect retry-after / exponential backoff (already implemented in the vendored code).
- Async refresh kickoff at the start of `streamAutoRouter()` if cache is stale, but **do not block**: route uses last-known UVI; new value lands for the next call. (Avoids adding latency to every prompt.)

### `src/budget-tracker.ts`
- Add a small `setUtilization(provider, snapshot)` setter so `getBudgetState()` returns it alongside spend.
- Keep static USD limits intact — UVI augments, doesn't replace them. (Critical for backward compat.)

### `src/budget-auditor.ts`
- Extend `BudgetAuditResult` with `uvi?: number`, `utilizationStatus?: UVIStatus`, and a `hint?: "promote" | "demote"`.
- New status precedence:
  - UVI `critical` OR USD-blocked → `status: "blocked"`
  - UVI `stressed` OR USD-warning → `status: "warning"` + `hint: "demote"`
  - UVI `surplus` → `status: "ok"` + `hint: "promote"`
  - else → unchanged.

### Selector integration in `index.ts` (`streamAutoRouter`)
- After `auditBudget` produces hints, partition `auditedCandidates` into `{ promoted, normal, taxed }`.
- Selection rule:
  - For the requested tier, prefer `promoted` ordering ahead of `normal`, `taxed` last.
  - For non-premium tiers (e.g. `economy`, `swe`), if the route's first target is a premium provider in `promoted`, allow it to be picked over a cheaper default (this is the "unlock premium for standard tasks" behavior from the proposal).
  - Never select `taxed` unless it's the only remaining option — same semantics as today's "constraint fallback".
- Kick the cache refresher (`refreshUtilizationsAsync()`) at the top of `streamAutoRouter` so subsequent calls have fresh data.

### Config surface
- Optional global config block (in routes JSON or env), all defaults sensible:
  ```jsonc
  "uvi": {
    "enabled": true,
    "ttlMs": 60000,
    "thresholds": { "stressed": 1.5, "critical": 2.0, "surplus": 0.5 },
    "surplusMinElapsed": 0.7
  }
  ```
- Backward compatible: missing block → defaults; UVI disabled → behaves exactly like today.

### UI / commands
- `/auto-router budget` extended with a UVI table:
  ```
  Provider          USD spend / limit     UVI    Status      Window
  anthropic         —                     1.73   stressed    5h@72%, 7d@40%
  openai-codex      —                     0.42   surplus     5h@10%, 7d@28%, 6d6h elapsed
  google-antigravity —                    0.95   ok          daily@31%
  ```
- `/auto-router explain` includes UVI in the rationale string.
- Status line gains a `uvi:` segment when any provider is `stressed` or `critical`.
- New `/auto-router uvi [refresh|show]` command for forcing a refresh & inspecting raw fetch results.

### Tests
- `tests/uvi.test.ts` — pure math: on-pace, stressed, critical, surplus-only-late, ε clamping.
- `tests/quota-fetcher.test.ts` — adapters from `UsageData` → `QuotaWindow[]` (mock the fetch fn, snapshot common payloads from each provider).
- `tests/budget-auditor.test.ts` — extend with UVI-driven status transitions and hint emission.
- `tests/budget-tracker.test.ts` — extend with utilization setter/getter.
- Integration test: candidate ordering with mixed UVI inputs feeding the selector.

## Open Questions (need your input before coding)

1. **Vendor or depend?** Is `pi-usage-bars` published anywhere installable, or do we vendor `core.ts` (with attribution) into `src/quota-fetcher.ts`? My recommendation: vendor.
2. **Google window duration.** The Google quota endpoint returns `remainingFraction` per bucket but doesn't expose the reset window length. Default assumption: daily (24h) — but worth confirming. If wrong, UVI for Google will be miscalibrated.
3. **Refresh on every request vs. async?** Sync fetch adds 100–500 ms per provider; async means UVI lags by one prompt. I lean async with a TTL of ~60s, but if you'd rather have always-fresh data, we trade off latency.
4. **Promotion aggression.** "Surplus → unlock premium on lower tiers": should this be a hard override (always pick the surplus premium target) or only as a tiebreaker? My default: tiebreaker only, with an env flag for hard override.
5. **Auth file location coupling.** pi-usage-bars reads `~/.pi/agent/auth.json` and refreshes tokens in place via `@mariozechner/pi-ai`. Are we OK with auto-router writing to that shared file, or do we want an opt-in (e.g. `AUTO_ROUTER_REFRESH_AUTH=1`)?
6. **Provider name mapping.** Routes config uses provider names like `claude-agent-sdk` and `google-antigravity`; usage endpoints are keyed `anthropic` / `openai-codex` / `google-gemini-cli` / `google-antigravity`. We need a mapping table — straightforward but worth calling out.

## Suggested Increments (review checkpoints)

- **Step 1 — Pure UVI math.** `src/types.ts` additions + `src/uvi.ts` + `tests/uvi.test.ts`. No I/O, mergeable on its own. Self-contained, low-risk.
- **Step 2 — Vendor quota-fetcher.** Bring in `src/quota-fetcher.ts` from pi-usage-bars (trimmed) + tests with mocked fetch. No integration with router yet.
- **Step 3 — Cache layer + provider mapping.** `src/quota-cache.ts` with TTL, async refresh, mapping table from route-provider-id → oauth-provider-id.
- **Step 4 — Auditor + selector wiring.** Hooks into `streamAutoRouter`, with a feature flag (`AUTO_ROUTER_UVI=1`) so we can ship dark and validate.
- **Step 5 — UI surfacing.** `/auto-router budget`, `/auto-router uvi`, status line, `explain` rationale.
- **Step 6 — Promote out of dark mode.** Flip the default to enabled, update PROPOSAL.md to mark Phase 7 UVI complete.

Ready to commit to this revised shape? If yes, I'll start on Step 1.
