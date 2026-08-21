// Headless smoke test of the generative core (no DOM, no Three).
// Verifies: determinism, region coherence, document-event grounding,
// river continuity across depths, and cultural descent.

import { History } from "../src/gen/history";
import { generateRegion } from "../src/gen/regions";

const seed = "the-first-descent";
const h1 = new History(seed);
const h2 = new History(seed);

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
  if (!ok) failures++;
};

// 1. Determinism: same seed → identical worlds.
const rA = generateRegion(h1, 7);
const rB = generateRegion(h2, 7);
check("determinism: region name", rA.name === rB.name, rA.name);
check("determinism: species", rA.species[0].name === rB.species[0].name, rA.species[0].name);
check("determinism: doc bodies", rA.docs[0]?.body === rB.docs[0]?.body);

// 2. Every region 1..25 has purpose, geology, species; docs cite real events.
let docCount = 0, eventGrounded = 0, civRegions = 0;
const riverSightings = new Map<string, number[]>();
for (let d = 1; d <= 25; d++) {
  const r = generateRegion(h1, d);
  if (!r.purpose || r.purpose.length < 20) check(`depth ${d} purpose`, false, r.purpose);
  if (r.species.length < 3) check(`depth ${d} ecosystem`, false, `${r.species.length} species`);
  if (r.builderCiv) civRegions++;
  for (const doc of r.docs) {
    docCount++;
    if (doc.eventId) {
      const ev = h1.eventById(doc.eventId);
      if (ev) eventGrounded++;
      else check(`depth ${d} doc grounding`, false, `${doc.title} cites missing ${doc.eventId}`);
    }
  }
  for (const rv of r.rivers) {
    if (!riverSightings.has(rv.id)) riverSightings.set(rv.id, rv.depths);
  }
}
check("regions 1-25 generated with purpose+ecosystem", true);
check("civ-built regions exist", civRegions > 5, `${civRegions}/25`);
check("documents generated", docCount > 40, `${docCount} docs`);
check("all event-docs grounded in recorded events", true, `${eventGrounded} grounded`);

// 3. River continuity: at least one river spans 2+ depths.
const multiRivers = [...riverSightings.values()].filter((ds) => ds.length >= 2);
check("rivers reappear across depths", multiRivers.length > 0,
  multiRivers[0] ? `river at depths ${multiRivers[0].join(", ")}` : "");

// 4. Cultural descent exists somewhere in the first 4 chapters.
let descent = 0;
for (let c = 0; c < 8; c++)
  for (const civ of h1.getChapter(c).civs)
    if (civ.parentCivId) descent++;
check("cultural descent (daughter civs)", descent > 0, `${descent} daughter cultures`);

// 5. Conflicting sources: find an event with 2+ docs and differing casualty figures.
let conflictsSeen = 0;
for (let d = 1; d <= 25; d++) {
  const r = generateRegion(h1, d);
  const byEvent = new Map<string, string[]>();
  for (const doc of r.docs) {
    if (!doc.eventId) continue;
    byEvent.set(doc.eventId, [...(byEvent.get(doc.eventId) ?? []), doc.body]);
  }
  for (const [, bodies] of byEvent) if (bodies.length >= 2 && bodies[0] !== bodies[1]) conflictsSeen++;
}
check("multiple disagreeing sources per event", conflictsSeen > 0, `${conflictsSeen} events with 2+ sources`);

// 6. Sample output for eyeballing.
const r12 = generateRegion(h1, 12);
console.log("\n--- Depth 12 sample ---");
console.log("Region:", r12.name, "—", r12.epithet, `(${r12.kind})`);
console.log("Purpose:", r12.purpose);
console.log("Inhabitants:", r12.inhabitantsDesc);
console.log("Mysteries:", r12.mysteries.join(" | "));
if (r12.builderCiv) {
  const c = r12.builderCiv;
  console.log(`Civ: ${c.name} (${c.species}, ${c.fate}), founded ${c.foundedYear}ya, surface: ${c.surfaceBelief}`);
}
console.log("Species:", r12.species.map((s) => `${s.name} [${s.diet}]`).join(", "));
console.log("\nSample doc:\n" + (r12.docs[0] ? `${r12.docs[0].title}\n${r12.docs[0].body}\n(${r12.docs[0].source})` : "none"));

// 7. Fuzz: many seeds × deep floors must all generate without throwing.
// (A flood event on a river-less floor once crashed generation here; one seed
// was never going to catch it.)
const SEEDS = [
  "the-first-descent", "scholar-run", "aaa", "bbb", "ccc", "ddd", "eee",
  "abyss-1", "abyss-2", "kingdom", "the deep", "x", "9174", "salt-and-lamplight",
];
let fuzzRegions = 0;
const crashes: string[] = [];
for (const s of SEEDS) {
  const h = new History(s);
  for (const d of [1, 2, 3, 5, 8, 11, 13, 17, 19, 23, 29, 31, 37, 41, 47, 53, 61, 73]) {
    try {
      const r = generateRegion(h, d);
      // Touch the fields the renderer will touch, so lazy crashes surface here.
      void r.purpose.length; void r.species.length; void r.docs.length;
      void r.mysteries.join(""); void r.inhabitantsDesc.length;
      for (const doc of r.docs) void doc.body.length;
      for (const sp of r.species) void sp.foodDesc.length;
      fuzzRegions++;
    } catch (e) {
      crashes.push(`seed "${s}" depth ${d}: ${(e as Error).message}`);
    }
  }
}
check(`fuzz: ${SEEDS.length} seeds × 18 depths generate cleanly`, crashes.length === 0,
  crashes.length ? crashes.slice(0, 3).join(" | ") : `${fuzzRegions} regions`);

console.log(failures ? `\n${failures} FAILURES` : "\nALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
