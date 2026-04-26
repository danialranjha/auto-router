# Proposal: Intelligent Routing Policy Engine

## Overview
Transform `pi-auto-router` from a static target selector into a dynamic decision engine that analyzes context, intent, and budgets to select the optimal model.

## Current State
The auto-router currently has:
- ✅ Static route definitions with failover chains
- ✅ Basic cooldown/retry logic for failing targets
- ✅ Alias resolution
- ✅ Manual route switching via `/auto-router switch`

## Target Architecture

### 1. Routing Decision Pipeline
The PolicyEngine will run an ordered pipeline of rules:

```
┌─────────────────────────────────────────────────────────────────┐
│  INPUT: User prompt + Context + Route ID                         │
└──────────────────────────┬──────────────────────────────────────┘
                           │
    ┌──────────────────────▼──────────────────────┐
    │  1. SHORTCUT PARSER                          │
    │     Checks for @reasoning, @swe, @long, etc │
    │     → Returns tier hint or null             │
    └──────────────────────┬──────────────────────┘
                           │
    ┌──────────────────────▼──────────────────────┐
    │  2. CONTEXT ANALYZER                         │
    │     Calculates token count, history depth    │
    │     → Returns context classification          │
    └──────────────────────┬──────────────────────┘
                           │
    ┌──────────────────────▼──────────────────────┐
    │  3. CONSTRAINT SOLVER                        │
    │     Matches: vision? reasoning? max_tokens?  │
    │     Filters dead/unhealthy targets           │
    │     → Returns candidate targets               │
    └──────────────────────┬──────────────────────┘
                           │
    ┌──────────────────────▼──────────────────────┐
    │  4. BUDGET AUDITOR                           │
    │     Checks provider quotas/cost estimates    │
    │     → Filters over-budget paths             │
    └──────────────────────┬──────────────────────┘
                           │
    ┌──────────────────────▼──────────────────────┐
    │  5. SELECTOR                                   │
    │     Ranks candidates, picks best             │
    │     → Returns RoutingDecision               │
    └─────────────────────────────────────────────┘
```

### 2. New Data Structures

```typescript
// The final decision object
interface RoutingDecision {
  tier: 'reasoning' | 'swe' | 'long' | 'economy' | 'vision';
  phase: string;              // Which rule made the final call
  target: RouteTarget;        // Selected target
  reasoning: string;          // Human-readable explanation
  metadata: {
    estimatedTokens: number;
    budgetRemaining: number;
    confidence: number;       // 0-1 how sure we are
  };
}

// A single policy rule
interface PolicyRule {
  name: string;
  priority: number;         // Lower = runs first
  condition: (ctx: RoutingContext) => boolean;
  action: (ctx: RoutingContext) => RoutingDecision | null;
}

// Context passed through the pipeline
interface RoutingContext {
  prompt: string;
  history: Message[];
  routeId: string;
  estimatedTokens: number;
  availableTargets: RouteTarget[];
  userHint?: string;          // From @ shortcut
  budgetState?: BudgetState;
}

// Budget tracking
interface BudgetState {
  dailySpend: Record<string, number>;  // provider -> $ spent today
  dailyLimit: Record<string, number>;  // provider -> $ limit
}

// @ command shortcuts registry
interface ShortcutRegistry {
  [key: string]: {
    tier: RoutingDecision['tier'];
    description: string;
    pattern: RegExp;
  };
}
```

## 3. Implementation Phases

### Phase 1: Foundation (Core Types & Context Analyzer)
**Goal**: Establish the infrastructure without breaking existing behavior

- [ ] Define `RoutingDecision`, `PolicyRule`, `RoutingContext` interfaces
- [ ] Implement `ContextAnalyzer` class
  - [ ] Token estimation (naive: char count / 4)
  - [ ] History depth calculation
  - [ ] Context classification (short/medium/long/epic)
- [ ] Add unit tests for ContextAnalyzer
- [ ] Create `PolicyEngine` skeleton (no-op passthrough)

**Files**: `src/types.ts`, `src/context-analyzer.ts`, `src/policy-engine.ts`

### Phase 2: Shortcut Parser (@ Commands)
**Goal**: Allow users to hint intent via @ shortcuts

- [ ] Define `ShortcutRegistry` with patterns:
  - `@reasoning` → tier: 'reasoning'
  - `@swe` → tier: 'swe'
  - `@long` → tier: 'long'
  - `@vision` → tier: 'vision'
  - `@fast` → tier: 'economy'
- [ ] Implement `ShortcutParser.parse(prompt): string | null`
- [ ] Hook into existing prompt handling (pre-process)
- [ ] Add tests for pattern matching at start, middle, end of prompt
- [ ] Update README with @ command documentation

**Files**: `src/shortcut-parser.ts`, tests

### Phase 3: Constraint Solver
**Goal**: Filter targets by capability, health, cooldown

- [ ] Implement `ConstraintSolver` class
  - [ ] Filter by vision: boolean
  - [ ] Filter by reasoning: boolean
  - [ ] Filter by contextWindow >= estimated tokens
  - [ ] Filter by maxTokens >= requested
  - [ ] Integrate existing cooldown logic
- [ ] Add "capability mismatch" error messages
- [ ] Tests for all constraint combinations

**Files**: `src/constraint-solver.ts`

### Phase 4: Budget Auditor & Persistence
**Goal**: Track spending and respect limits

- [ ] Design `~/.pi/agent/extensions/auto-router.stats.json` schema:
```json
{
  "version": 1,
  "daily": {
    "2026-04-25": {
      "claude-agent-sdk": { "inputTokens": 15000, "outputTokens": 5000, "estimatedCost": 0.45 },
      "openai-codex": { "inputTokens": 8000, "outputTokens": 3000, "estimatedCost": 0.22 }
    }
  },
  "limits": {
    "claude-agent-sdk": { "dailyUsd": 10.00 },
    "openai-codex": { "dailyUsd": 5.00 }
  }
}
```
- [ ] Implement `BudgetTracker` class
  - [ ] Read/write stats file
  - [ ] Atomic updates (write to temp, rename)
  - [ ] Graceful handling of missing/corrupt stats
- [ ] Implement `BudgetAuditor` rule
- [ ] Add `/auto-router budget` command to show current spend
- [ ] Add budget warnings in routing decisions

**Files**: `src/budget-tracker.ts`, `src/budget-auditor.ts`

### Phase 5: Integration & Target Selection
**Goal**: Wire everything together and replace current logic

- [ ] Implement `PolicyEngine.selectTarget(): RoutingDecision`
  - [ ] Run pipeline in priority order
  - [ ] Return decision with reasoning
  - [ ] Fallback to first healthy target if no rule matches
- [ ] Integrate into `streamAutoRouter()`
  - [ ] Call PolicyEngine before attempting targets
  - [ ] Log routing decisions (debug mode)
- [ ] Add `lastRoutingDecision` tracking for UI

**Files**: `index.ts` (modifications)

### Phase 6: UI Improvements
**Goal**: Surface routing decisions to users

- [ ] Extend status line with routing hint:
  `auto-router premium | ▶︎ claude-opus-4-6 (tier=reasoning, confidence=0.95)`
- [ ] Add `/auto-router explain` command showing last decision details
- [ ] Show warning when budget limit approaching (80%, 100%)
- [ ] Update route summary to show tier compatibility

**Files**: `index.ts` (UI modifications)

### Phase 7: Advanced Features (Future)
**Goal**: Smarter routing based on feedback

- [ ] Performance-based ranking (track latency per provider)
- [ ] Intent classification (code vs creative vs analysis)
- [ ] Dynamic budget reallocation
- [ ] Provider health checks (proactive ping)
- [ ] User feedback loop (`/auto-router rate <good|bad> [reason]` after a response, persisted per-target to bias future selection — e.g., downrank targets with repeated thumbs-down for a given tier)

## 4. Integration Strategy

### How PolicyEngine fits into existing flow

```typescript
// Current flow:
streamAutoRouter() → getHealthyTargets() → tryTarget() (loop)

// New flow:
streamAutoRouter() → PolicyEngine.decide() → RoutingDecision
                      ↓
              ┌───────┴───────┐
              │ If decision    │
              │ → try specific │
              │   target first │
              │                │
              │ If decision    │
              │   fails        │
              │ → fall back to │
              │   existing     │
              │   tryTarget()  │
              │   loop         │
              └────────────────┘
```

### Backward Compatibility

- **Routes config**: New optional fields only (`tier`, `costPerToken`, etc.). Existing configs continue to work unchanged.
- **Failover loop**: Preserved as the ultimate fallback when PolicyEngine returns no decision.
- **Commands**: New subcommands added (`explain`, `budget`); existing commands unchanged.
- **Shadow mode**: `AUTO_ROUTER_SHADOW=1` env var runs PolicyEngine but ignores its decision (logs only) for safe rollout.

## 5. Testing Strategy

| Layer | Approach |
|-------|----------|
| **Unit** | Each module (`ContextAnalyzer`, `ShortcutParser`, etc.) has dedicated `*.test.ts` |
| **Integration** | Mock `ExtensionAPI` + `Context` and run end-to-end pipeline |
| **Shadow mode** | Run new engine in parallel with old; log divergences |
| **Manual QA** | Operator commands documented for verifying decisions |

Coverage target: 80% on new modules.

## 6. Open Questions

1. **Cost data source**: Read from model registry (`model.cost`) or duplicate in routes config?
2. **Budget scope**: Global (`~/.pi/`) or per-project (`./.pi/`)?
3. **`@` shortcut handling**: Strip from prompt before sending or pass through?
4. **Tier↔Route mapping**: Implicit (route name) or explicit (`tier` field on route)?

These need answers before Phase 1 implementation begins.

## 7. Success Metrics

- Zero regressions in existing failover behavior (validated via shadow mode)
- Routing decisions explainable via `/auto-router explain`
- Budget overruns prevented (or warned with override)
- @ shortcuts reduce manual route switching by ≥50%
