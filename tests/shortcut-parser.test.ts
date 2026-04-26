import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SHORTCUTS, listShortcuts, parseShortcut } from "../src/shortcut-parser.ts";

describe("parseShortcut", () => {
  it("returns null for empty/null prompt", () => {
    assert.equal(parseShortcut(""), null);
    assert.equal(parseShortcut(undefined as unknown as string), null);
  });
  it("returns null when no shortcut present", () => {
    assert.equal(parseShortcut("plain prompt with no markers"), null);
  });
  it("matches at start of prompt and strips it", () => {
    const m = parseShortcut("@reasoning solve this");
    assert.ok(m);
    assert.equal(m!.tier, "reasoning");
    assert.equal(m!.shortcut, "@reasoning");
    assert.equal(m!.cleanedPrompt, "solve this");
  });
  it("matches in middle and collapses whitespace", () => {
    const m = parseShortcut("please @swe refactor this code");
    assert.ok(m);
    assert.equal(m!.tier, "swe");
    assert.equal(m!.cleanedPrompt, "please refactor this code");
  });
  it("matches at end of prompt", () => {
    const m = parseShortcut("write a poem @fast");
    assert.ok(m);
    assert.equal(m!.tier, "economy");
    assert.equal(m!.cleanedPrompt, "write a poem");
  });
  it("ignores embedded @-tokens that are not standalone", () => {
    assert.equal(parseShortcut("email me at user@reasoning.com"), null);
    assert.equal(parseShortcut("see foo@swe-team"), null);
  });
  it("matches case-insensitively", () => {
    const m = parseShortcut("@VISION analyze this image");
    assert.ok(m);
    assert.equal(m!.tier, "vision");
  });
  it("returns the first registered match when multiple shortcuts present", () => {
    const m = parseShortcut("@long context but also @fast please");
    assert.ok(m);
    assert.equal(m!.tier, "long");
  });
  it("supports a custom registry", () => {
    const m = parseShortcut("@code do thing", {
      "@code": { tier: "swe", description: "custom", pattern: /(^|\s)@code\b/i },
    });
    assert.ok(m);
    assert.equal(m!.tier, "swe");
    assert.equal(m!.shortcut, "@code");
  });
});

describe("listShortcuts", () => {
  it("returns all default shortcuts with metadata", () => {
    const list = listShortcuts();
    assert.equal(list.length, Object.keys(DEFAULT_SHORTCUTS).length);
    const reasoning = list.find((s) => s.shortcut === "@reasoning");
    assert.ok(reasoning);
    assert.equal(reasoning!.tier, "reasoning");
  });
});
