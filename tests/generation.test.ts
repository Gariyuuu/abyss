// Generation integrity: preconditions, chronology, referential soundness and
// the two crash regressions. These are the gates that must never go red.

import { describe, it, expect } from "vitest";
import { History, CHAPTER_DEPTHS } from "../src/gen/history";
import { generateRegion } from "../src/gen/regions";
import {
  isSatisfied, admissible, floodSubtype, isChronologicallyOrdered, wasAliveAt,
  EventContext, UNCONDITIONAL,
} from "../src/gen/preconditions";

const FUZZ_SEEDS = Array.from({ length: 24 }, (_, i) => `fuzz-${i}`);
const FUZZ_DEPTHS = [1, 2, 3, 5, 8, 11, 13, 17, 19, 23, 29, 31, 37, 41, 47, 53, 61, 73];

function ctx(over: Partial<EventContext> = {}): EventContext {
  return {
    enemyCount: 0, riverCount: 0, rulerCount: 3,
    hasParentCulture: false, heat: 0.5, peerCount: 2, ...over,
  };
}

describe("event preconditions", () => {
  it("refuses war when the civ has no recorded enemy", () => {
    expect(isSatisfied("war", ctx({ enemyCount: 0 }))).toBe(false);
    expect(isSatisfied("war", ctx({ enemyCount: 1 }))).toBe(true);
  });

  it("refuses war when there are no peer societies at all", () => {
    expect(isSatisfied("war", ctx({ enemyCount: 1, peerCount: 0 }))).toBe(false);
  });

  it("refuses regicide without a ruler", () => {
    expect(isSatisfied("regicide", ctx({ rulerCount: 0 }))).toBe(false);
  });

  it("refuses quake in a geologically cold stratum", () => {
    expect(isSatisfied("quake", ctx({ heat: 0 }))).toBe(false);
  });

  it("models flood without a river as an explicit groundwater subtype", () => {
    // The regression: a flood used to be rolled with no river and then crash.
    expect(isSatisfied("flood", ctx({ riverCount: 0 }))).toBe(true);
    expect(floodSubtype(0)).toBe("groundwater");
    expect(floodSubtype(2)).toBe("river");
  });

  it("filters a weighted candidate list down to admissible entries only", () => {
    const cands = [["war", 3], ["plague", 1], ["regicide", 2]] as const;
    const got = admissible(cands, ctx({ enemyCount: 0, rulerCount: 0 })).map(([t]) => t);
    expect(got).toEqual(["plague"]);
  });

  it("always leaves an unconditional fallback available", () => {
    const barren = ctx({ enemyCount: 0, rulerCount: 0, heat: 0, peerCount: 0 });
    expect(UNCONDITIONAL.every((t) => isSatisfied(t, barren))).toBe(true);
  });
});

describe("chronology helpers", () => {
  it("rejects an event dated after the culture ended", () => {
    // Years count BACK from present: 100 is more recent than 300.
    expect(isChronologicallyOrdered(1000, [500], 300)).toBe(true);
    expect(isChronologicallyOrdered(1000, [200], 300)).toBe(false);
  });
  it("rejects an event dated before the culture was founded", () => {
    expect(isChronologicallyOrdered(1000, [1200], null)).toBe(false);
  });
  it("knows whether a culture was alive at a given year", () => {
    expect(wasAliveAt(1000, 300, 500)).toBe(true);
    expect(wasAliveAt(1000, 300, 200)).toBe(false); // after the end
    expect(wasAliveAt(1000, 300, 1200)).toBe(false); // before founding
    expect(wasAliveAt(1000, null, 5)).toBe(true);    // still extant
  });
});

describe(`region fuzz gate (${FUZZ_SEEDS.length} seeds x ${FUZZ_DEPTHS.length} depths)`, () => {
  it("generates every region without throwing and with usable fields", () => {
    const crashes: string[] = [];
    let regions = 0;
    for (const seed of FUZZ_SEEDS) {
      const h = new History(seed);
      for (const d of FUZZ_DEPTHS) {
        try {
          const r = generateRegion(h, d);
          // Touch everything the renderer and UI touch, so lazy crashes surface.
          expect(r.purpose.length).toBeGreaterThan(10);
          expect(r.species.length).toBeGreaterThanOrEqual(3);
          expect(r.mysteries.length).toBeGreaterThan(0);
          expect(r.resources.length).toBeGreaterThan(0);
          expect(r.ceilingHeight).toBeGreaterThan(0);
          for (const doc of r.docs) expect(doc.body.length).toBeGreaterThan(10);
          for (const sp of r.species) expect(sp.foodDesc.length).toBeGreaterThan(0);
          regions++;
        } catch (e) {
          crashes.push(`${seed}@${d}: ${(e as Error).message}`);
        }
      }
    }
    expect(crashes).toEqual([]);
    expect(regions).toBe(FUZZ_SEEDS.length * FUZZ_DEPTHS.length);
  });
});

describe("history invariants across many seeds", () => {
  const seeds = Array.from({ length: 30 }, (_, i) => `hist-${i}`);

  it("holds chronology, preconditions and referential integrity for every civ", () => {
    const violations: string[] = [];
    let civs = 0, events = 0;

    for (const seed of seeds) {
      const h = new History(seed);
      for (let c = 0; c < 6; c++) h.getChapter(c);

      for (let c = 0; c < 6; c++) {
        const chapter = h.getChapter(c);
        for (const civ of chapter.civs) {
          civs++;
          // Optional collections that other systems index into must be non-empty.
          if (!civ.economy.length) violations.push(`${civ.name}: empty economy`);
          if (!civ.cuisine.length) violations.push(`${civ.name}: empty cuisine`);
          if (!civ.rulers.length) violations.push(`${civ.name}: empty dynasty`);
          if (!civ.military) violations.push(`${civ.name}: no military tradition`);
          // Descent must resolve.
          if (civ.parentCivId && !h.civById(civ.parentCivId)) {
            violations.push(`${civ.name}: parent ${civ.parentCivId} does not resolve`);
          }
          // Territory must be a sane, ordered range.
          if (civ.territory[0] > civ.territory[1]) violations.push(`${civ.name}: inverted territory`);
          if (civ.territory[0] < 1) violations.push(`${civ.name}: territory above the surface`);
          // A fallen civ must have a recorded cause.
          if (civ.fate !== "extant" && !civ.fallCauseEventId) {
            violations.push(`${civ.name}: ${civ.fate} with no terminal event`);
          }
          if (civ.fate === "extant" && civ.fellYear !== null) {
            violations.push(`${civ.name}: extant but has a fall year`);
          }

          // Chronology: nothing after the end, nothing before the founding.
          const own = h.eventsOfCiv(civ.id).filter((e) => e.civId === civ.id);
          const mid = own
            .filter((e) => e.type !== "founding" && e.id !== civ.fallCauseEventId)
            .map((e) => e.year);
          if (!isChronologicallyOrdered(civ.foundedYear, mid, civ.fellYear)) {
            violations.push(
              `${civ.name}: chronology broken (founded ${civ.foundedYear}, fell ${civ.fellYear}, mid ${mid.join(",")})`);
          }
        }

        for (const e of chapter.events) {
          events++;
          // Preconditions, checked against the recorded outcome.
          if (e.type === "war" && !e.otherCivId) violations.push(`${e.id}: war with no counterparty`);
          if (e.otherCivId && !h.civById(e.otherCivId)) violations.push(`${e.id}: ghost counterparty`);
          if (e.civId && !h.civById(e.civId)) violations.push(`${e.id}: ghost subject`);
          if (e.causedById && !h.eventById(e.causedById)) violations.push(`${e.id}: ghost cause`);
          if (e.type === "flood" && !e.subtype) violations.push(`${e.id}: flood without a subtype`);
          if (e.year < 0) violations.push(`${e.id}: negative year`);
          if (e.deaths < 0) violations.push(`${e.id}: negative deaths`);
          if (!e.detail || e.detail.length < 10) violations.push(`${e.id}: empty detail`);
          if (e.depth < 1) violations.push(`${e.id}: depth above the surface`);
        }
      }
    }
    expect(violations.slice(0, 10)).toEqual([]);
    expect(civs).toBeGreaterThan(200);
    expect(events).toBeGreaterThan(600);
  });

  it("never attributes a document to a culture that could not have written it", () => {
    const bad: string[] = [];
    let docs = 0;
    for (const seed of seeds.slice(0, 15)) {
      const h = new History(seed);
      for (let d = 1; d <= 25; d++) {
        for (const doc of generateRegion(h, d).docs) {
          docs++;
          if (!doc.eventId) continue;
          const ev = h.eventById(doc.eventId);
          if (!ev) { bad.push(`${doc.title}: cites unknown event ${doc.eventId}`); continue; }
          if (!doc.civId) continue;
          const author = h.civById(doc.civId);
          if (!author) { bad.push(`${doc.title}: ghost author culture`); continue; }
          // Contemporary sources: the author must have existed at the event date.
          if (doc.kind === "enemy-account" && !wasAliveAt(author.foundedYear, author.fellYear, ev.year)) {
            bad.push(`${doc.title}: ${author.name} wrote about ${ev.year}ya but lived ${author.foundedYear}-${author.fellYear}`);
          }
        }
      }
    }
    expect(bad.slice(0, 8)).toEqual([]);
    expect(docs).toBeGreaterThan(400);
  });

  it("keeps rivers continuous across the depths they claim", () => {
    const h = new History("river-continuity");
    for (let c = 0; c < 5; c++) h.getChapter(c);
    let multi = 0;
    for (let c = 0; c < 5; c++) {
      for (const r of h.getChapter(c).rivers) {
        expect(r.depths.length).toBeGreaterThan(0);
        expect(r.depths[0]).toBe(r.spawnDepth);
        // Strictly descending order, no repeats.
        for (let i = 1; i < r.depths.length; i++) {
          expect(r.depths[i]).toBeGreaterThan(r.depths[i - 1]);
        }
        // Every claimed depth reports the river.
        for (const d of r.depths) {
          expect(h.riversAt(d).some((x) => x.id === r.id)).toBe(true);
        }
        if (r.depths.length > 1) multi++;
      }
    }
    expect(multi).toBeGreaterThan(0);
  });
});

describe("determinism", () => {
  it("reproduces identical canonical state from the same seed", () => {
    const a = new History("determinism-check");
    const b = new History("determinism-check");
    for (const d of [1, 7, 14, 22, 33]) {
      const ra = generateRegion(a, d);
      const rb = generateRegion(b, d);
      expect(rb.name).toBe(ra.name);
      expect(rb.kind).toBe(ra.kind);
      expect(rb.purpose).toBe(ra.purpose);
      expect(rb.species.map((s) => s.name)).toEqual(ra.species.map((s) => s.name));
      expect(rb.docs.map((x) => x.body)).toEqual(ra.docs.map((x) => x.body));
      expect(rb.builderCiv?.id).toBe(ra.builderCiv?.id);
      expect(rb.mysteries).toEqual(ra.mysteries);
    }
  });

  it("produces different worlds for different seeds", () => {
    const a = generateRegion(new History("seed-alpha"), 5);
    const b = generateRegion(new History("seed-beta"), 5);
    expect(a.name).not.toBe(b.name);
  });

  it("does not depend on the order regions are visited", () => {
    const forward = new History("order-independence");
    const backward = new History("order-independence");
    const f: string[] = [];
    for (let d = 1; d <= 12; d++) f.push(generateRegion(forward, d).name);
    const b: string[] = [];
    for (let d = 12; d >= 1; d--) b.unshift(generateRegion(backward, d).name);
    expect(b).toEqual(f);
  });
});

describe("chapter structure", () => {
  it("maps depths to chapters consistently", () => {
    const h = new History("chapters");
    expect(h.chapterOf(1)).toBe(0);
    expect(h.chapterOf(CHAPTER_DEPTHS)).toBe(0);
    expect(h.chapterOf(CHAPTER_DEPTHS + 1)).toBe(1);
  });
});
