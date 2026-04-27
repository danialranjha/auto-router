# Phase 7 Plan: Dynamic Budget Reallocation via Utilization Velocity Index (UVI)

**Status:** ✅ Shipped in [PR #1](https://github.com/danialranjha/pi-auto-router/pull/1) (merged into `main`).

## Goal
Shift the budget auditor from a **static daily USD ceiling** to a **dynamic pressure signal** based on how fast each OAuth provider is burning through its real reset-window quota relative to how much of that window remains. UVI is consumed by the selector to:
- **Tax** providers trending toward premature exhaustion (UVI > 1.0).
- **Unlock** premium providers for standard tasks when surplus is detected near the end of a reset cycle.

## Core Concept

```
UVI = consumed_fraction / elapsed_fraction_of_window
```

- `UVI ≈ 1.0` → on-pace
- `UVI > 1.0` → burning faster than safe → **tax** (deprioritize)
- `UVI < 1.0` → underutilized → eligible to **unlock** for non-premium tiers

Thresholds (shipped defaults, configurable via `DEFAULT_UVI_THRESHOLDS`):
- `UVI ≥ 1.5` → **stressed** — auditor returns `warning` + `hint: "demote"`
- `UVI ≥ 2.0` → **critical** — auditor returns `blocked`
- `UVI ≤ 0.5` AND `elapsedFraction ≥ 0.7` → **surplus** — auditor returns `ok` + `hint: "promote"`

## Resolved Decisions

| Open Question (v2) | Decision |
|---|---|
| Vendor vs. depend on `pi-usage-bars`? | **Vendored** into `src/quota-fetcher.ts` with attribution comment. Upstream is a Pi extension, not a published lib. |
| Google window duration? | **Assumed 24h** (`GOOGLE_DAILY_WINDOW_MS`). Empirical confirmation deferred — flagged in PROPOSAL §9 Limitations. |
| Sync vs. async refresh? | **Async**, TTL 60s (override via `AUTO_ROUTER_UVI_TTL_MS`), 30s hard floor between refreshes. Never blocks a prompt; UVI lags by one prompt. |
| Promotion aggression? | **Partition-order tiebreaker only**: candidates split into `[promoted, normal, demoted]` and tried in that order. No hard-override flag yet (deferred). |
| Shared `auth.json` writes? | **Allowed** — uses `@mariozechner/pi-ai`'s `getOAuthApiKey()` which writes to `~/.pi/agent/auth.json`. Same behavior as `pi-usage-bars`. |
| Provider name mapping? | **`ROUTE_PROVIDER_TO_OAUTH`** in `src/quota-cache.ts`. `claude-agent-sdk` → `anthropic`; others 1:1. |
| Default on or opt-in? | **Opt-in** (off by default) pending real-world validation. Enable with `AUTO_ROUTER_UVI=1` or `/auto-router uvi enable`. |

## What Shipped

### New files
- **`src/uvi.ts`** — pure math: `computeElapsedFraction`, `computeUVI` (ε=0.05), `classifyUVI`, `aggregateProviderUVI` (worst-window dominates).
- **`src/quota-fetcher.ts`** — vendored from `ajarellanod/pi-usage-bars` (trimmed; z.ai dropped). Exports `fetchCodexUsage`, `fetchClaudeUsage`, `fetchGoogleUsage`, `fetchAllUsages`, `discoverGoogleProjectId`, `parseGoogleQuotaBuckets`, `readPercentCandidate`, `parseRetryAfterMs`, `readAuth`, `writeAuth`, `ensureFreshAuthForProviders`, `usageToWindows`. Window constants: `CODEX_PRIMARY_WINDOW_MS=5h`, `CODEX_SECONDARY_WINDOW_MS=7d`, `CLAUDE_FIVE_HOUR_WINDOW_MS=5h`, `CLAUDE_SEVEN_DAY_WINDOW_MS=7d`, `GOOGLE_DAILY_WINDOW_MS=24h`.
- **`src/quota-cache.ts`** — `QuotaCache` class: TTL=60s, MIN_REFRESH_INTERVAL=30s, `refreshIfStale()` (non-blocking background), `refreshNow()`, `getSnapshot/getAllSnapshots`, `isEnabled/setEnabled`. Provider mapping `mapRouteProviderToOAuth`.
- **`tests/uvi.test.ts`** — 16 tests.
- **`tests/quota-fetcher.test.ts`** — 17 tests with mocked fetch.

### Extended
- **`src/types.ts`** — `QuotaWindow`, `QuotaScope` (`session|weekly|monthly|daily`), `QuotaSource`, `UVIStatus`, `UtilizationSnapshot`, `UVIThresholds`, `DEFAULT_UVI_THRESHOLDS`. `BudgetState.utilization?: Record<string, UtilizationSnapshot>`.
- **`src/budget-tracker.ts`** — `setUtilization()`, `getUtilization()`, `getBudgetState()` includes `utilization` only when populated.
- **`src/budget-auditor.ts`** — `BudgetAuditHint = "promote" | "demote"`, plus `uvi`, `utilizationStatus`, `utilizationReason` fields. Precedence: critical→blocked, stressed→warning+demote, surplus→ok+promote. USD limits still respected.
- **`index.ts`** — `quotaCache` singleton, `syncUtilizationIntoBudget()` (re-keys `anthropic` snapshot under `claude-agent-sdk`), `formatUtilizationLines()`, `formatUviStatusSegment()`. `streamAutoRouter` calls `refreshIfStale()` + `syncUtilizationIntoBudget()` at top, partitions audited candidates into `[promoted, normal, demoted]`, includes UVI notes in `reasoning`. New `/auto-router uvi [show|refresh|enable|disable]` subcommand. UVI block in `/auto-router budget`. `uvi:` segment in status line when any provider is stressed/critical.

### Tests
- **`tests/budget-auditor.test.ts`** — +5 UVI tests (critical→blocked, stressed→warning+demote, surplus→ok+promote, UVI critical overrides USD-ok, USD blocked stays blocked with no UVI).
- **`tests/budget-tracker.test.ts`** — +1 utilization round-trip test.

**Final test count:** 97/97 pass.

## Reference Implementation

`pi-usage-bars/extensions/usage-bars/core.ts` provided the OAuth usage endpoints, retry-after parsing, exponential backoff, and `getOAuthApiKey()` integration. Vendored verbatim with trimming; attribution comment in `src/quota-fetcher.ts`.

| Provider | Endpoint | Auth | Window data |
|---|---|---|---|
| `openai-codex` | `chatgpt.com/backend-api/wham/usage` | OAuth `Bearer` | `primary_window` (5h) + `secondary_window` (7d), `used_percent`, `reset_after_seconds` |
| `anthropic` | `api.anthropic.com/api/oauth/usage` (header `anthropic-beta: oauth-2025-04-20`) | OAuth `Bearer` | `five_hour.{utilization,resets_at}`, `seven_day.{utilization,resets_at}`, `extra_usage` |
| `google-gemini-cli` | `cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota` POST | OAuth `Bearer` + `projectId` via `:loadCodeAssist` | bucket-shaped; window duration **not exposed** (assume 24h) |
| `google-antigravity` | same Google endpoint | same | same buckets |

## Configuration Surface

- `AUTO_ROUTER_UVI=1` — enable (off by default).
- `AUTO_ROUTER_UVI_TTL_MS=<ms>` — override TTL (default 60000).
- `/auto-router uvi enable|disable|show|refresh` — runtime control.

## Deferred (out of scope for this PR)

- **Hard-override env flag** for surplus-driven promotion (currently tiebreaker only via partition order).
- **Integration test** for end-to-end selector ordering through `streamAutoRouter` (unit-level hint emission is covered).
- **Default-on for UVI** — still opt-in pending real-world validation.
- **Empirical confirmation of Google's window duration** — currently assumed 24h.
- **Performance-based ranking, intent classification, proactive provider health checks, user feedback loop** — separate Phase 7 bullets in `PROPOSAL.md`.

## Notes for Future Work

- Snapshot only updates on the prompt *after* a successful refresh (TTL design). If we later want fresh-on-every-prompt, the trade is 100–500 ms latency per prompt.
- `auditBudget` keys by route-config provider name; the cache re-keys `anthropic` snapshots under `claude-agent-sdk` in `syncUtilizationIntoBudget`. New OAuth providers will need both a `ROUTE_PROVIDER_TO_OAUTH` entry and (if their route-config name differs from the OAuth ID) a re-keying line.
- Promotion currently fires only when `elapsed ≥ 0.7` AND `uvi ≤ 0.5`. Loosening either threshold would be a config-only change in `DEFAULT_UVI_THRESHOLDS`.
