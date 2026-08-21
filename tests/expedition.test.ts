// Full-expedition integration tests (the fast subset — the deep 100-expedition
// sweep lives in scripts/deep-validate.ts).

import { describe, it, expect } from "vitest";
import { runExpedition } from "./harness/expedition-harness";
import { Expedition, validateExpedition, validateNarrativeOrder } from "../src/sim/expedition";
import { History } from "../src/gen/history";

describe("complete expedition — scholar run (Test A)", () => {
  it("descends 25 floors hiring companions and reading with a scholar", () => {
    const r = runExpedition("expedition-A-scholar", { maxDepth: 25, hire: true });
    expect(r.errors).toEqual([]);
    expect(r.invariantFailures).toEqual([]);
    expect(r.integrityIssues).toEqual([]);
    expect(r.depthReached).toBe(25);
    expect(r.documentsRead).toBeGreaterThan(20);
    expect(r.culturesMet).toBeGreaterThan(2);
    expect(r.journalEntries).toBeGreaterThan(30);
  });

  it("produces interpretations whose provenance resolves against history", () => {
    // Search seeds until one actually hires a scholar, then verify the record.
    let checked = false;
    for (let s = 0; s < 12 && !checked; s++) {
      const r = runExpedition(`interp-run-${s}`, { maxDepth: 30, hire: true });
      expect(r.errors).toEqual([]);
      if (r.interpretations > 0) {
        expect(r.integrityIssues).toEqual([]);
        expect(r.invariantFailures).toEqual([]);
        checked = true;
      }
    }
    expect(checked).toBe(true);
  });
});

describe("complete expedition — heavy armor run (Test B)", () => {
  it("equips generated gear throughout without breaking weight or stats", () => {
    const r = runExpedition("expedition-B-armor", { maxDepth: 25, hire: true, equipGear: true });
    expect(r.errors).toEqual([]);
    expect(r.invariantFailures).toEqual([]);
    expect(r.gearFound).toBeGreaterThan(0);
    expect(r.gearEquipped).toBeGreaterThan(0);
    // Gear weight really eats into capacity.
    expect(r.finalCapacity).toBeLessThanOrEqual(38 + 36);
  });
});

describe("complete expedition — warden death (Test C)", () => {
  it("keeps the run valid after a companion dies and propagates consequences", () => {
    // Deep enough that news has time to travel back to the settlements.
    const r = runExpedition("expedition-C-death", {
      maxDepth: 40, hire: true, killCompanionAtDepth: 8,
    });
    expect(r.errors).toEqual([]);
    expect(r.invariantFailures).toEqual([]);
    expect(r.integrityIssues).toEqual([]);
    expect(r.companionsDied).toBeGreaterThan(0);
    // The death must have produced downstream world news.
    expect(r.worldEvents).toBeGreaterThan(0);
  });
});

describe("complete expedition — resource failure (Test D)", () => {
  it("survives an under-provisioned party without negative inventory", () => {
    const r = runExpedition("expedition-D-starve", {
      maxDepth: 25, hire: true, starve: true,
    });
    expect(r.errors).toEqual([]);
    expect(r.invariantFailures).toEqual([]);
    expect(r.starvedRests).toBeGreaterThan(0);   // shortage really bit
    expect(r.mealsEaten).toBeGreaterThanOrEqual(0);
  });
});

describe("complete expedition — no companions (Test E)", () => {
  it("remains fully playable and coherent solo", () => {
    const r = runExpedition("expedition-E-solo", { maxDepth: 25, hire: false });
    expect(r.errors).toEqual([]);
    expect(r.invariantFailures).toEqual([]);
    expect(r.integrityIssues).toEqual([]);
    expect(r.companionsHired).toBe(0);
    expect(r.interpretations).toBe(0);   // no scholar, no readings
    expect(r.documentsRead).toBeGreaterThan(15);
    expect(r.depthReached).toBe(25);
  });
});

describe("complete expedition — deep descent (Test F)", () => {
  it("reaches depth 60 across many region archetypes without failure", () => {
    const r = runExpedition("expedition-F-deep", { maxDepth: 60, hire: true });
    expect(r.errors).toEqual([]);
    expect(r.invariantFailures).toEqual([]);
    expect(r.integrityIssues).toEqual([]);
    expect(r.depthReached).toBe(60);
    expect(r.floors).toBe(60);
    // The journal must stay bounded on a long run.
    expect(r.journalEntries).toBeLessThanOrEqual(Expedition.MAX_ENTRIES);
  });
});

describe("save/load mid-expedition", () => {
  it("restores identical state and continues coherently", () => {
    const r = runExpedition("expedition-saveload", {
      maxDepth: 25, hire: true, saveLoadAtDepth: 12, equipGear: true,
    });
    expect(r.errors).toEqual([]);
    expect(r.invariantFailures).toEqual([]);   // includes the round-trip diff check
    expect(r.depthReached).toBe(25);
  });

  it("keeps a dead companion dead across a reload", () => {
    const r = runExpedition("expedition-death-persist", {
      maxDepth: 20, hire: true, killCompanionAtDepth: 6, saveLoadAtDepth: 10,
    });
    expect(r.errors).toEqual([]);
    expect(r.invariantFailures).toEqual([]);
    expect(r.companionsDied).toBeGreaterThan(0);
  });
});

describe("expedition journal integrity", () => {
  it("rejects a journal entry pointing at a non-existent culture", () => {
    const h = new History("journal-integrity");
    h.getChapter(0);
    const e = new Expedition();
    e.record({ atTime: 1, depth: 2, kind: "culture", ref: "civ:nope", summary: "x" });
    const issues = validateExpedition(e, h);
    expect(issues.length).toBe(1);
    expect(issues[0].problem).toMatch(/does not resolve/);
  });

  it("rejects an interpretation recorded after the scholar died", () => {
    const e = new Expedition();
    e.record({ atTime: 5, depth: 1, kind: "companion-died", ref: "comp:1", summary: "died" });
    e.record({
      atTime: 9, depth: 2, kind: "interpretation", ref: "comp:1", summary: "ghost reading",
      provenance: {
        scholarCultureId: "x", scholarCultureName: "X", documentCultureId: null,
        documentCultureName: null, documentKind: "chronicle", relationship: "unknown-author",
        contactPeriod: null, sharedEventIds: [], stance: "agnostic",
        legibility: "opaque", confidence: "none", admitsIgnorance: true,
      },
    });
    const issues = validateNarrativeOrder(e);
    expect(issues.some((i) => /after the scholar died/.test(i.problem))).toBe(true);
  });

  it("rejects time running backwards", () => {
    const e = new Expedition();
    e.record({ atTime: 10, depth: 1, kind: "descend", ref: "d:1", summary: "" });
    e.record({ atTime: 3, depth: 2, kind: "descend", ref: "d:2", summary: "" });
    expect(validateNarrativeOrder(e).some((i) => /backwards/.test(i.problem))).toBe(true);
  });

  it("bounds the journal on a very long run while keeping the spine", () => {
    const e = new Expedition();
    for (let i = 0; i < 900; i++) {
      e.record({ atTime: i, depth: 1 + (i % 40), kind: "document", ref: `d${i}`, summary: "x" });
      if (i % 50 === 0) {
        e.record({ atTime: i, depth: 1 + (i % 40), kind: "descend", ref: `dep${i}`, summary: "x" });
      }
    }
    expect(e.journal.length).toBeLessThanOrEqual(Expedition.MAX_ENTRIES);
    // Descents (the spine of the story) are preserved.
    expect(e.of("descend").length).toBe(18);
  });
});

describe("player actions never rewrite history", () => {
  it("leaves canonical events byte-identical after a full expedition", () => {
    const h = new History("no-retcon");
    for (let c = 0; c < 4; c++) h.getChapter(c);
    const before = JSON.stringify([0, 1, 2, 3].map((c) => h.getChapter(c).events));
    runExpedition("no-retcon", { maxDepth: 30, hire: true, equipGear: true, killCompanionAtDepth: 5 });
    const after = JSON.stringify([0, 1, 2, 3].map((c) => h.getChapter(c).events));
    expect(after).toBe(before);
  });
});
