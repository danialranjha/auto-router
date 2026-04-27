# Deferred Ideas

## PolicyEngine Follow-ups
- **Time-of-day conditions**: Add `condition.timeOfDay` (e.g. `{ "after": "22:00", "before": "06:00" }`) and `condition.dayOfWeek` to PolicyRuleConfig for time-based routing strategies
- **Route-specific rules**: Currently all rules from all routes are merged. Consider scoping rules per-route so different routes can have different strategies
- **Feedback-driven rules**: Wire FeedbackTracker ratings into PolicyEngine as a condition source (e.g. `condition.ratingBelow: 0.4` → demote provider)
- **Dry-run evaluation**: Expose `evaluateStrategy()` results in `/auto-router explain` even when no rules matched, so users can see what would have fired
- **Rule hot-reload**: Currently rules load on config reload. Consider allowing `/auto-router rules add|remove|enable|disable` for live rule management

## Architecture
- **Extract streamAutoRouter from index.ts**: 1,861-line file; the core pipeline could be its own module (`src/router.ts`) for testability
- **Circuit breaker**: Skip providers that fail repeatedly (3 errors in 60s → backoff). Would reduce tail latency
- **Cost-aware ranking**: Use token estimates + known pricing to sort candidates by projected cost within UVI buckets

## Testing
- **Integration tests for the routing pipeline**: Currently 0% coverage on streamAutoRouter. After extracting to src/router.ts, add tests for common scenarios
- **Balance fetcher retry**: Add 2-retry with exponential backoff to balance/health fetchers for transient network resilience
