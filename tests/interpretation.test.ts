// Scholar interpretation. Structure is tested here; prose is only checked for
// "does it exist and does it differ", never snapshotted — the writing must be
// free to change without weakening the guarantee that nothing is invented.

import { describe, it, expect } from "vitest";
import { History, Civ } from "../src/gen/history";
import { generateRegion } from "../src/gen/regions";
import { DocSpec } from "../src/gen/lore";
import {
  interpret, renderInterpretation, Interpretation, Relationship, Stance,
} from "../src/gen/interpretation";

/** Build a minimal synthetic history so every relationship can be exercised. */
function fixture() {
  const h = new History("interpretation-fixture");
  h.getChapter(0);
  h.getChapter(1);
  const all: Civ[] = [];
  for (let c = 0; c < 2; c++) all.push(...h.getChapter(c).civs);
  return { h, all };
}

function docFrom(civId: string | null, kind: DocSpec["kind"] = "chronicle"): DocSpec {
  return {
    id: "test:doc", kind, title: "t", sub: "s", body: "b", source: "src",
    eventId: null, civId,
  };
}

describe("interpretation structure", () => {
  it("derives every field from canonical state only", () => {
    const { h, all } = fixture();
    const scholar = all[0];
    const interp = interpret(scholar.id, docFrom(scholar.id), h)!;
    expect(interp).toBeTruthy();
    expect(interp.scholarCultureId).toBe(scholar.id);
    expect(interp.documentCultureId).toBe(scholar.id);
    expect(interp.relationship).toBe("same-culture");
    expect(interp.stance).toBe("invested");
    expect(interp.legibility).toBe("fluent");
    expect(interp.confidence).toBe("high");
    expect(interp.admitsIgnorance).toBe(false);
  });

  it("returns null for a scholar whose culture does not resolve", () => {
    const { h } = fixture();
    expect(interpret("civ:does-not-exist", docFrom(null), h)).toBeNull();
  });

  it("admits ignorance for an unattributable document", () => {
    const { h, all } = fixture();
    const interp = interpret(all[0].id, docFrom(null), h)!;
    expect(interp.relationship).toBe("unknown-author");
    expect(interp.stance).toBe("agnostic");
    expect(interp.legibility).toBe("opaque");
    expect(interp.confidence).toBe("none");
    expect(interp.admitsIgnorance).toBe(true);
    expect(interp.sharedEventIds).toEqual([]);
  });

  it("only ever cites events involving both cultures", () => {
    const { h, all } = fixture();
    for (const scholar of all) {
      for (const other of all) {
        const interp = interpret(scholar.id, docFrom(other.id), h);
        if (!interp) continue;
        for (const id of interp.sharedEventIds) {
          const ev = h.eventById(id);
          expect(ev).toBeTruthy();
          const pair = [ev!.civId, ev!.otherCivId];
          expect(pair).toContain(scholar.id);
          expect(pair).toContain(other.id);
        }
      }
    }
  });

  it("never reports a contact period when the cultures did not overlap", () => {
    const { h, all } = fixture();
    for (const a of all) {
      for (const b of all) {
        const interp = interpret(a.id, docFrom(b.id), h);
        if (!interp?.contactPeriod) continue;
        // Both must have been alive somewhere inside the window.
        const { fromYear, toYear } = interp.contactPeriod;
        expect(fromYear).toBeGreaterThan(toYear); // years count backward
        expect(fromYear).toBeLessThanOrEqual(Math.min(a.foundedYear, b.foundedYear));
      }
    }
  });
});

describe("four-relationship regression", () => {
  // Each of the four verified relationships must produce a distinct stance.
  // We assert the stance, not the wording.
  const EXPECTED: Record<string, Stance> = {
    "same-culture": "invested",
    war: "hostile",
    trade: "trusting",
    ancestor: "kin-recognition",
    descendant: "estranged-kin",
    vassal: "deferential",
    unfamiliar: "agnostic",
    "unknown-author": "agnostic",
  };

  it("maps each canonical relationship to its own interpretive stance", () => {
    const seen = new Map<Relationship, Stance>();
    for (let s = 0; s < 40; s++) {
      const h = new History(`stance-${s}`);
      for (let c = 0; c < 3; c++) h.getChapter(c);
      const all: Civ[] = [];
      for (let c = 0; c < 3; c++) all.push(...h.getChapter(c).civs);
      for (const a of all) {
        for (const b of all) {
          const i = interpret(a.id, docFrom(b.id), h);
          if (!i) continue;
          expect(i.stance).toBe(EXPECTED[i.relationship]);
          seen.set(i.relationship, i.stance);
        }
      }
    }
    // The four headline cases must all actually occur in generated worlds.
    for (const rel of ["same-culture", "war", "trade"] as Relationship[]) {
      expect(seen.has(rel)).toBe(true);
    }
    // Descent-based relationships (schism) must occur somewhere too.
    expect(seen.has("ancestor") || seen.has("descendant")).toBe(true);
  });

  it("gives meaningfully different framing for war vs trade on the same document", () => {
    // Find one document culture judged by two scholars in opposite relationships.
    let found = false;
    for (let s = 0; s < 60 && !found; s++) {
      const h = new History(`contrast-${s}`);
      for (let c = 0; c < 3; c++) h.getChapter(c);
      const all: Civ[] = [];
      for (let c = 0; c < 3; c++) all.push(...h.getChapter(c).civs);
      for (const target of all) {
        const doc = docFrom(target.id);
        const enemy = all.find((x) => x.relations.some((r) => r.civId === target.id && r.kind === "war"));
        const partner = all.find((x) => x.relations.some((r) => r.civId === target.id && r.kind === "trade"));
        if (!enemy || !partner) continue;
        const ei = interpret(enemy.id, doc, h)!;
        const pi = interpret(partner.id, doc, h)!;
        expect(ei.stance).toBe("hostile");
        expect(pi.stance).toBe("trusting");
        const ep = renderInterpretation(ei, "E", h).text;
        const pp = renderInterpretation(pi, "P", h).text;
        expect(ep).not.toBe(pp);
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
  });
});

describe("scholar is not omniscient", () => {
  it("cannot read a stranger culture's script fluently", () => {
    let sawOpaque = false;
    for (let s = 0; s < 40 && !sawOpaque; s++) {
      const h = new History(`opaque-${s}`);
      for (let c = 0; c < 3; c++) h.getChapter(c);
      const all: Civ[] = [];
      for (let c = 0; c < 3; c++) all.push(...h.getChapter(c).civs);
      for (const a of all) {
        for (const b of all) {
          const i = interpret(a.id, docFrom(b.id), h);
          if (i?.relationship === "unfamiliar" && i.legibility === "opaque") {
            expect(i.confidence).toBe("none");
            expect(i.admitsIgnorance).toBe(true);
            // And the prose must actually decline to judge.
            const text = renderInterpretation(i, "S", h).text.toLowerCase();
            expect(text).toMatch(/do not know|cannot/);
            sawOpaque = true;
          }
        }
      }
    }
    expect(sawOpaque).toBe(true);
  });

  it("reads an enemy's script only partially", () => {
    let sawPartial = false;
    for (let s = 0; s < 30 && !sawPartial; s++) {
      const h = new History(`partial-${s}`);
      for (let c = 0; c < 3; c++) h.getChapter(c);
      const all: Civ[] = [];
      for (let c = 0; c < 3; c++) all.push(...h.getChapter(c).civs);
      for (const a of all) {
        const foe = a.relations.find((r) => r.kind === "war");
        if (!foe) continue;
        const i = interpret(a.id, docFrom(foe.civId), h);
        if (!i) continue;
        expect(i.legibility).toBe("partial");
        expect(i.confidence).toBe("moderate");
        sawPartial = true;
        break;
      }
    }
    expect(sawPartial).toBe(true);
  });

  it("never fabricates familiarity it cannot support", () => {
    // An agnostic stance must never claim shared events.
    for (let s = 0; s < 25; s++) {
      const h = new History(`nofab-${s}`);
      for (let c = 0; c < 3; c++) h.getChapter(c);
      const all: Civ[] = [];
      for (let c = 0; c < 3; c++) all.push(...h.getChapter(c).civs);
      for (const a of all) {
        for (const b of all) {
          const i = interpret(a.id, docFrom(b.id), h);
          if (i?.relationship === "unfamiliar") {
            expect(i.sharedEventIds).toEqual([]);
          }
        }
      }
    }
  });
});

describe("contradictory scholars", () => {
  it("lets two scholars reach different structured conclusions about one document", () => {
    let contradictions = 0;
    for (let s = 0; s < 30; s++) {
      const h = new History(`contradict-${s}`);
      for (let c = 0; c < 3; c++) h.getChapter(c);
      const all: Civ[] = [];
      for (let c = 0; c < 3; c++) all.push(...h.getChapter(c).civs);
      for (const target of all) {
        const doc = docFrom(target.id);
        const stances = new Set<Stance>();
        for (const a of all) {
          const i = interpret(a.id, doc, h);
          if (i) stances.add(i.stance);
        }
        if (stances.size > 1) contradictions++;
      }
    }
    // Disagreement must be common, not incidental.
    expect(contradictions).toBeGreaterThan(20);
  });

  it("does not reconcile disagreement into a single truth", () => {
    // The canonical event is untouched by anyone's reading of it.
    const h = new History("no-reconcile");
    const region = generateRegion(h, 6);
    const doc = region.docs.find((d) => d.eventId);
    if (!doc) return;
    const before = JSON.stringify(h.eventById(doc.eventId!));
    const all = h.getChapter(0).civs;
    for (const civ of all) {
      const i = interpret(civ.id, doc, h);
      if (i) renderInterpretation(i, "X", h);
    }
    expect(JSON.stringify(h.eventById(doc.eventId!))).toBe(before);
  });
});

describe("prose layer", () => {
  it("produces non-empty attributed speech for every structure", () => {
    const h = new History("prose");
    for (let c = 0; c < 3; c++) h.getChapter(c);
    const all: Civ[] = [];
    for (let c = 0; c < 3; c++) all.push(...h.getChapter(c).civs);
    const kinds: DocSpec["kind"][] = ["chronicle", "journal", "mural", "enemy-account", "gravestone", "inscription", "warning"];
    for (const a of all) {
      for (const b of [...all, null]) {
        for (const k of kinds) {
          const i = interpret(a.id, docFrom(b ? b.id : null, k), h);
          if (!i) continue;
          const out = renderInterpretation(i, "Test", h);
          expect(out.speaker).toContain("Test");
          expect(out.text.length).toBeGreaterThan(30);
          expect(out.text).not.toContain("undefined");
          expect(out.text).not.toContain("NaN");
          expect(out.text).not.toContain("[object");
        }
      }
    }
  });

  it("is a pure function of the structure", () => {
    const h = new History("pure-prose");
    h.getChapter(0);
    const civ = h.getChapter(0).civs[0];
    const i = interpret(civ.id, docFrom(civ.id), h)!;
    const a = renderInterpretation(i, "Same", h).text;
    const b = renderInterpretation(i, "Same", h).text;
    expect(a).toBe(b);
  });
});
