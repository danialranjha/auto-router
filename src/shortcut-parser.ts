import type { ShortcutRegistry, Tier } from "./types.ts";

export const DEFAULT_SHORTCUTS: ShortcutRegistry = {
  "@reasoning": { tier: "reasoning", description: "Force reasoning-tier model", pattern: /(^|\s)@reasoning\b/i },
  "@swe": { tier: "swe", description: "Force SWE-tier model", pattern: /(^|\s)@swe\b/i },
  "@long": { tier: "long", description: "Force long-context model", pattern: /(^|\s)@long\b/i },
  "@vision": { tier: "vision", description: "Force vision-capable model", pattern: /(^|\s)@vision\b/i },
  "@fast": { tier: "economy", description: "Force fast/economy model", pattern: /(^|\s)@fast\b/i },
};

export type ShortcutMatch = {
  shortcut: string;
  tier: Tier;
  cleanedPrompt: string;
};

export function parseShortcut(prompt: string, registry: ShortcutRegistry = DEFAULT_SHORTCUTS): ShortcutMatch | null {
  if (!prompt) return null;
  for (const [key, entry] of Object.entries(registry)) {
    if (!entry.pattern.test(prompt)) continue;
    const cleanedPrompt = prompt.replace(entry.pattern, " ").replace(/\s+/g, " ").trim();
    return { shortcut: key, tier: entry.tier, cleanedPrompt };
  }
  return null;
}

export function listShortcuts(registry: ShortcutRegistry = DEFAULT_SHORTCUTS): Array<{ shortcut: string; tier: Tier; description: string }> {
  return Object.entries(registry).map(([shortcut, entry]) => ({
    shortcut,
    tier: entry.tier,
    description: entry.description,
  }));
}
