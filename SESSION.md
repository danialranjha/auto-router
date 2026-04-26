# Auto-Router Policy Engine Session

**Status**: Phases 1–3 implemented and integrated into `index.ts` (Phase 5 slice)
**Last Updated**: 2026-04-25
**Current Phase**: Phase 4 - Budget Auditor & Persistence

## Phase 1–3 Delivered

- `src/types.ts` — `RoutingDecision`, `PolicyRule`, `RoutingContext`, `BudgetState`, `ShortcutRegistry`, etc.
- `src/context-analyzer.ts` — chars/4 token estimation, `classifyContext`, `buildRoutingContext`
- `src/shortcut-parser.ts` — `@reasoning|@swe|@long|@vision|@fast` registry + `parseShortcut`
- `src/constraint-solver.ts` — vision/reasoning/contextWindow/maxTokens filtering + cooldown hook + `inferRequirements`
- `src/policy-engine.ts` — priority-ordered rule pipeline skeleton, shadow-mode flag, last-decision tracking
- `tests/*.test.ts` — 42 tests across the four modules, all passing via `npm test` (Node `--test` + `tsx`)
- `package.json` — added `test` script and `tsx` / `@types/node` / `typescript` devDeps

## Phase 5 Slice (Integration into `index.ts`)

- `streamAutoRouter()` now parses `@` shortcuts from the last user message, strips them in-place, and feeds the cleaned prompt to the underlying provider.
- Healthy targets are passed through `solveConstraints` with capability data from the model registry; tier hints (`@vision`, `@reasoning`, `@swe`, `@long`) translate to constraint requirements.
- A `RoutingDecision` is recorded per route on every call (phase, tier, target, confidence, reasoning, estimated tokens).
- New subcommands: `/auto-router explain [routeId]` and `/auto-router shortcuts`.
- `/auto-router reset` now also clears decision/shortcut history.
- TypeScript error count unchanged (14 pre-existing strict-mode warnings, zero new).

## Phase 4 Delivered (Budget Tracker & Auditor)

- `src/budget-tracker.ts` — atomic JSON persistence at `~/.pi/agent/extensions/auto-router.stats.json`; tracks daily input/output tokens and estimated cost per provider; lazy-load + temp-file rename for safe writes; supports per-provider daily limits.
- `src/budget-auditor.ts` — pure function `auditBudget(provider, state, additional?)` returning `ok | warning (≥80%) | blocked (≥100%)` with provider/spend/limit/remaining/usageRatio.
- `tests/budget-tracker.test.ts` + `tests/budget-auditor.test.ts` — 11 new tests; 53/53 total passing.
- Wired into `streamAutoRouter`:
  - Loads tracker on first call, builds `BudgetState` and feeds it into `RoutingContext`.
  - Filters constraint-passing candidates through the auditor; blocked targets become "budget exhausted" rejections.
  - Budget warnings (80%+) surface in routing reasoning and the status line.
  - On successful response, `result.lastMessage.usage` is recorded via `BudgetTracker.recordUsage(provider, usage)`.
  - `decision.metadata.budgetRemaining` now reflects the selected provider's remaining daily $.
- New `/auto-router budget` subcommand:
  - `/auto-router budget` (or `show`) — daily summary per provider with limit + % used.
  - `/auto-router budget set <provider> <dailyUsd>` — set limit.
  - `/auto-router budget clear <provider>` — remove limit.

## Phase 6 Polish

- Status line now shows `tier=<tier> (<confidence>)` after the route name when a decision has been recorded.
- Budget warnings appear in the status line as `⚠ <message>` when nearing a limit.
- `/auto-router reset` clears budget warning state in addition to cooldown/decision history.
- Help text lists `/auto-router budget [show|set <provider> <usd>|clear <provider>]`.

## Remaining (Phase 7 — Future)

- Performance/latency tracking, intent classification, dynamic budget reallocation, proactive provider health checks, user feedback loop (`/auto-router rate`).

---

## Session Goals

Transform `pi-auto-router` from a static failover router into an intelligent policy-driven decision engine that:
1. Understands user intent via `@` shortcuts
2. Analyzes context to pick optimal targets
3. Respects budget constraints
4. Explains its routing decisions

---

## Completed Analysis

### Current Implementation Audit

| Component | Status | Notes |
|-----------|--------|-------|
| Route definitions | ✅ Working | Static JSON config with targets array |
| Failover logic | ✅ Working | `tryTarget()` loop with cooldowns |
| Cooldown tracking | ✅ Working | In-memory Map with time-based expiry |
| Alias resolution | ✅ Working | `resolveAlias()` with fallback chain |
| Model registry lookup | ✅ Working | `resolveModelFromRegistry()` with normalization |
| UI commands | ✅ Working | `/auto-router` with subcommands |
| Budget tracking | ❌ Missing | No spend persistence |
| Token estimation | ❌ Missing | No context analysis |
| Shortcut parsing | ❌ Missing | No `@` command support |
| Routing reasoning | ❌ Missing | No decision explanation |

### Architecture Assessment

**Strengths of current code**:
- Clean separation between route config and execution
- Robust error classification (retryable vs terminal)
- Good provider abstraction

**Gaps to address**:
- All routing decisions are static (first healthy target)
- No insight into why a target was chosen
- No user override mechanisms
- Budget blindness (could blow through limits)

---

## Next Steps (Prioritized)

### Immediate (This Session)

1. **Create type definitions** (`src/types.ts`)
   - ✋ Blocked by: None
   - Define `RoutingDecision`, `PolicyRule`, `RoutingContext`, `BudgetState`

2. **Implement ContextAnalyzer** (`src/context-analyzer.ts`)
   - ✋ Depends on: Types
   - Simple token estimation (characters / 4)
   - History length calculation
   - Return classification enum

3. **Add first tests**
   - ✋ Depends on: ContextAnalyzer
   - Test token estimation edge cases
   - Test classification boundaries

### Short Term (Next Session)

4. **Implement ShortcutParser** (`src/shortcut-parser.ts`)
   - Regex patterns for `@reasoning`, `@swe`, `@long`, etc.
   - Extract hint from prompt (and strip it before sending)
   - Tests for pattern positions

5. **ConstraintSolver** (`src/constraint-solver.ts`)
   - Filter by `vision`, `reasoning`, `contextWindow`
   - Integrate existing cooldown logic
   - Reuse in current routing flow

### Medium Term (Following Sessions)

6. **BudgetTracker** (`src/budget-tracker.ts`)
   - Design `auto-router.stats.json` schema
   - Implement atomic file updates
   - Add spend estimation to each request

7. **BudgetAuditor**
   - Check daily limits before routing
   - Warn user at 80% threshold
   - Block routing at 100% (configurable)

8. **PolicyEngine Integration**
   - Wire all components together
   - Run pipeline in priority order
   - Fallback to legacy behavior

9. **UI Enhancements**
   - Show routing reasoning in status
   - Add `/auto-router explain` command
   - Display budget warnings

---

## File Structure Target

```
pi-auto-router/
├── index.ts                 # Main entry point (existing, modified)
├── src/
│   ├── types.ts            # Shared interfaces
│   ├── context-analyzer.ts # Token estimation
│   ├── shortcut-parser.ts  # @ command parsing
│   ├── constraint-solver.ts# Capability matching
│   ├── budget-tracker.ts   # Spend persistence
│   ├── budget-auditor.ts   # Limit checking
│   └── policy-engine.ts    # Main orchestrator
├── tests/
│   ├── context-analyzer.test.ts
│   ├── shortcut-parser.test.ts
│   └── constraint-solver.test.ts
├── PROPOSAL.md             # This file
├── SESSION.md              # Session log
└── README.md               # Updated with new features
```

---

## Decisions Made

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-04-25 | Start with naive token estimation (chars/4) | Tiktoken requires model-specific vocab files; defer for MVP |
| 2026-04-25 | Stats file = `auto-router.stats.json` | Separate from `.routes.json` so routes can be version-controlled |
| 2026-04-25 | Shadow mode first | Validate decisions before relying on them |
| 2026-04-25 | Keep old failover as ultimate fallback | Safety net while PolicyEngine matures |

---

## Blockers / Questions

1. **Cost data**: Where do per-model costs come from?
   - Option A: Add to `routes.json` config
   - Option B: Read from model registry
   - *Need to check if model registry exposes cost*

2. **Shared state**: Is budget global or per-workspace?
   - If global: store in `~/.pi/agent/extensions/`
   - If per-workspace: store in `.pi/` of project

3. **@ command syntax**: Strip from prompt or pass through?
   - Strip: cleaner for models
   - Pass through: some models understand @-mentions
   - *Decision*: Strip for now, can re-enable per-model

---

## Notes

- Current codebase is ~700 LOC in single file
- Target is modular architecture with clear boundaries
- Prioritize backward compatibility
- Test coverage goal: 80% for new modules
