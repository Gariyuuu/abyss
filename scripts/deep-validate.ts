// DEEP VALIDATION — the release gate. Too slow for every commit; run before
// shipping, or whenever the generative grammar changes.
//
//   npm run validate:deep
//
// Covers: 100 full expeditions, 20 of them to the deep horizon, mass fuzzing of
// cultures / events / equipment / companions, and the property checks that no
// canonical reference ever dangles.

import { runExpedition } from "../tests/harness/expedition-harness";
import { History, Civ } from "../src/gen/history";
import { generateRegion } from "../src/gen/regions";
import { interpret } from "../src/gen/interpretation";
import { generateArmor, generateLight, generateCharm, GEAR_BOUNDS, Gear } from "../src/player/equipment";
import { generateCandidate, ROLE_INFO } from "../src/player/companions";
import { isChronologicallyOrdered, wasAliveAt, isSatisfied } from "../src/gen/preconditions";
import { rngFor } from "../src/core/rng";
import { DocSpec } from "../src/gen/lore";

const t0 = Date.now();
let failures = 0;
const report: string[] = [];

function gate(name: string, ok: boolean, detail = "") {
  const line = `${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`;
  console.log(line);
  report.push(line);
  if (!ok) failures++;
}

// ================================================== 1. EXPEDITION SWEEP ====

console.log("\n=== 100 EXPEDITIONS ===");
const EXPEDITIONS = 100;
const DEEP_EXPEDITIONS = 20;
const agg = {
  errors: [] as string[],
  invariants: [] as string[],
  integrity: [] as string[],
  floors: 0, docs: 0, interps: 0, cultures: 0, hires: 0, deaths: 0,
  gear: 0, rests: 0, consequences: 0, reachedTarget: 0,
};

for (let i = 0; i < EXPEDITIONS; i++) {
  const deep = i < DEEP_EXPEDITIONS;
  const maxDepth = deep ? 60 : 25;
  const r = runExpedition(`sweep-${i}`, {
    maxDepth,
    hire: i % 4 !== 0,                                   // 75% hire companions
    equipGear: i % 3 === 0,                              // a third wear armor
    killCompanionAtDepth: i % 5 === 0 ? 6 : undefined,   // a fifth lose someone
    starve: i % 11 === 0,                                // some go under-provisioned
    saveLoadAtDepth: i % 7 === 0 ? Math.floor(maxDepth / 2) : undefined,
  });
  agg.errors.push(...r.errors.map((e) => `${r.seed}: ${e}`));
  agg.invariants.push(...r.invariantFailures.map((e) => `${r.seed}: ${e}`));
  agg.integrity.push(...r.integrityIssues.map((e) => `${r.seed}: ${e}`));
  agg.floors += r.floors;
  agg.docs += r.documentsRead;
  agg.interps += r.interpretations;
  agg.cultures += r.culturesMet;
  agg.hires += r.companionsHired;
  agg.deaths += r.companionsDied;
  agg.gear += r.gearFound;
  agg.rests += r.rests;
  agg.consequences += r.worldEvents;
  if (r.depthReached === maxDepth) agg.reachedTarget++;
}

gate("no uncaught generation exceptions across 100 expeditions",
  agg.errors.length === 0, agg.errors.slice(0, 3).join(" | ") || `${agg.floors} floors`);
gate("no invariant failures across 100 expeditions",
  agg.invariants.length === 0, agg.invariants.slice(0, 3).join(" | "));
gate("no journal integrity issues across 100 expeditions",
  agg.integrity.length === 0, agg.integrity.slice(0, 3).join(" | "));
gate("every expedition reached its target depth",
  agg.reachedTarget === EXPEDITIONS, `${agg.reachedTarget}/${EXPEDITIONS}`);
gate("expeditions exercised the real systems",
  agg.docs > 1000 && agg.hires > 20 && agg.gear > 50,
  `${agg.floors} floors, ${agg.docs} docs, ${agg.interps} interpretations, ` +
  `${agg.hires} hires, ${agg.deaths} deaths, ${agg.gear} gear, ${agg.rests} rests, ` +
  `${agg.consequences} consequences`);

// =============================================== 2. MASS CULTURE FUZZ ====

console.log("\n=== CULTURE / EVENT FUZZ ===");
const CULTURE_SEEDS = 120;
let civCount = 0, eventCount = 0;
const civIssues: string[] = [];
const eventIssues: string[] = [];
for (let s = 0; s < CULTURE_SEEDS; s++) {
  const h = new History(`culture-fuzz-${s}`);
  for (let c = 0; c < 6; c++) h.getChapter(c);
  // Ids need only be unique WITHIN a world; different seeds are different worlds.
  const seenIds = new Set<string>();
  for (let c = 0; c < 6; c++) {
    const ch = h.getChapter(c);
    for (const civ of ch.civs) {
      civCount++;
      if (seenIds.has(civ.id)) civIssues.push(`seed ${s} ${civ.id}: duplicate id`);
      seenIds.add(civ.id);
      if (!civ.name || !civ.demonym) civIssues.push(`${civ.id}: unnamed`);
      if (!civ.military) civIssues.push(`${civ.id}: no military tradition`);
      if (!civ.economy.length || !civ.cuisine.length || !civ.rulers.length) {
        civIssues.push(`${civ.id}: empty required collection`);
      }
      if (civ.parentCivId && !h.civById(civ.parentCivId)) civIssues.push(`${civ.id}: ghost parent`);
      for (const rel of civ.relations) {
        if (!h.civById(rel.civId)) civIssues.push(`${civ.id}: relation to ghost ${rel.civId}`);
      }
      const own = h.eventsOfCiv(civ.id).filter((e) => e.civId === civ.id);
      const mid = own.filter((e) => e.type !== "founding" && e.id !== civ.fallCauseEventId).map((e) => e.year);
      if (!isChronologicallyOrdered(civ.foundedYear, mid, civ.fellYear)) {
        civIssues.push(`${civ.id}: chronology violated`);
      }
      // Companion generation must work for every culture.
      const cand = generateCandidate(rngFor("cfz", civ.id), civ, 5, 0);
      if (cand.civId !== civ.id || !ROLE_INFO[cand.role]) {
        civIssues.push(`${civ.id}: companion generation invalid`);
      }
      // Equipment generation must work for every culture.
      for (const g of [
        generateArmor(rngFor("gfz", civ.id), civ, 5, 0),
        generateLight(rngFor("lfz", civ.id), civ, 5, 0),
        generateCharm(rngFor("hfz", civ.id), civ, 5, 0),
      ]) {
        for (const [k, [lo, hi]] of Object.entries(GEAR_BOUNDS)) {
          const v = g[k as keyof Gear] as number;
          if (!Number.isFinite(v) || v < lo || v > hi) {
            civIssues.push(`${civ.id}: gear ${g.name} ${k}=${v} out of bounds`);
          }
        }
      }
    }
    for (const e of ch.events) {
      eventCount++;
      if (e.type === "war" && !e.otherCivId) eventIssues.push(`${e.id}: war with no opponent`);
      if (e.type === "flood" && !e.subtype) eventIssues.push(`${e.id}: flood with no subtype`);
      if (e.otherCivId && !h.civById(e.otherCivId)) eventIssues.push(`${e.id}: ghost opponent`);
      if (e.civId && !h.civById(e.civId)) eventIssues.push(`${e.id}: ghost subject`);
      if (e.causedById && !h.eventById(e.causedById)) eventIssues.push(`${e.id}: ghost cause`);
      if (!Number.isFinite(e.year) || e.year < 0) eventIssues.push(`${e.id}: bad year`);
      if (!Number.isFinite(e.deaths) || e.deaths < 0) eventIssues.push(`${e.id}: bad casualties`);
      if (e.depth < 1) eventIssues.push(`${e.id}: bad depth`);
    }
  }
}
gate(`fuzzed ${civCount} cultures`, civIssues.length === 0, civIssues.slice(0, 3).join(" | "));
gate(`fuzzed ${eventCount} historical events`, eventIssues.length === 0, eventIssues.slice(0, 3).join(" | "));

// ================================================ 3. DOCUMENT VALIDITY ====

console.log("\n=== DOCUMENT / ARCHAEOLOGY FUZZ ===");
let docCount = 0;
const docIssues: string[] = [];
for (let s = 0; s < 40; s++) {
  const h = new History(`doc-fuzz-${s}`);
  for (let d = 1; d <= 30; d++) {
    for (const doc of generateRegion(h, d).docs) {
      docCount++;
      if (!doc.body || doc.body.length < 10) docIssues.push(`${doc.id}: empty body`);
      if (/undefined|NaN|\[object/.test(doc.body + doc.title + doc.source)) {
        docIssues.push(`${doc.id}: template leak`);
      }
      if (doc.eventId) {
        const ev = h.eventById(doc.eventId);
        if (!ev) { docIssues.push(`${doc.id}: cites unknown event`); continue; }
        if (doc.civId) {
          const author = h.civById(doc.civId);
          if (!author) { docIssues.push(`${doc.id}: ghost author`); continue; }
          // A contemporary account requires a living author at that date.
          if (doc.kind === "enemy-account" &&
              !wasAliveAt(author.foundedYear, author.fellYear, ev.year)) {
            docIssues.push(`${doc.id}: ${author.name} wrote after extinction`);
          }
        }
      }
    }
  }
}
gate(`fuzzed ${docCount} documents`, docIssues.length === 0, docIssues.slice(0, 3).join(" | "));

// ============================================ 4. INTERPRETATION FUZZ ====

console.log("\n=== SCHOLAR INTERPRETATION FUZZ ===");
let interpCount = 0;
const interpIssues: string[] = [];
const stanceCounts: Record<string, number> = {};
for (let s = 0; s < 50; s++) {
  const h = new History(`interp-fuzz-${s}`);
  const all: Civ[] = [];
  for (let c = 0; c < 3; c++) all.push(...h.getChapter(c).civs);
  for (const scholar of all) {
    for (const author of [...all, null]) {
      const doc: DocSpec = {
        id: "d", kind: "chronicle", title: "t", sub: "s", body: "b",
        source: "src", eventId: null, civId: author ? author.id : null,
      };
      const i = interpret(scholar.id, doc, h);
      if (!i) { interpIssues.push(`${scholar.id}: no interpretation`); continue; }
      interpCount++;
      stanceCounts[i.stance] = (stanceCounts[i.stance] ?? 0) + 1;
      // Provenance must resolve.
      if (!h.civById(i.scholarCultureId)) interpIssues.push("scholar culture ghost");
      if (i.documentCultureId && !h.civById(i.documentCultureId)) interpIssues.push("doc culture ghost");
      for (const evId of i.sharedEventIds) {
        if (!h.eventById(evId)) interpIssues.push(`cited ghost event ${evId}`);
      }
      // Never fabricate familiarity.
      if (i.relationship === "unfamiliar" && i.sharedEventIds.length > 0) {
        interpIssues.push("unfamiliar relationship citing shared events");
      }
      if (i.legibility === "opaque" && !i.admitsIgnorance) {
        interpIssues.push("opaque reading claiming knowledge");
      }
      if (i.confidence === "none" && !i.admitsIgnorance) {
        interpIssues.push("no-confidence reading not admitting ignorance");
      }
    }
  }
}
gate(`fuzzed ${interpCount} scholar interpretations`,
  interpIssues.length === 0, interpIssues.slice(0, 3).join(" | "));
gate("interpretation stances are genuinely varied",
  Object.keys(stanceCounts).length >= 4, JSON.stringify(stanceCounts));

// ================================================= 5. COMPANION FUZZ ====

console.log("\n=== COMPANION FUZZ ===");
let compCount = 0;
const compIssues: string[] = [];
const roleCounts: Record<string, number> = {};
for (let s = 0; s < 60; s++) {
  const h = new History(`comp-fuzz-${s}`);
  const all: Civ[] = [];
  for (let c = 0; c < 3; c++) all.push(...h.getChapter(c).civs);
  for (const civ of all) {
    const ids = new Set<string>();
    for (let i = 0; i < 4; i++) {
      const c = generateCandidate(rngFor(`cf-${s}-${i}`, civ.id), civ, 7, i);
      compCount++;
      roleCounts[c.role] = (roleCounts[c.role] ?? 0) + 1;
      if (ids.has(c.id)) compIssues.push(`${c.id}: duplicate within settlement`);
      ids.add(c.id);
      if (!c.civId || !h.civById(c.civId)) compIssues.push(`${c.id}: unresolvable culture`);
      if (!c.name || c.name.length < 2) compIssues.push(`${c.id}: unnamed`);
      if (!c.motive || c.motive.length < 10) compIssues.push(`${c.id}: no motive`);
      if (c.hp !== ROLE_INFO[c.role].hp) compIssues.push(`${c.id}: hp mismatch`);
      if (!c.alive) compIssues.push(`${c.id}: born dead`);
    }
  }
}
gate(`fuzzed ${compCount} companions`, compIssues.length === 0, compIssues.slice(0, 3).join(" | "));
gate("all four companion roles occur", Object.keys(roleCounts).length === 4, JSON.stringify(roleCounts));

// ============================================ 6. EXTINCTION / HIRING ====

console.log("\n=== CULTURE EXTINCTION RULES ===");
const extIssues: string[] = [];
let settlements = 0;
for (let s = 0; s < 30; s++) {
  const h = new History(`extinct-${s}`);
  for (let d = 1; d <= 40; d++) {
    const r = generateRegion(h, d);
    if (!r.settlement) continue;
    settlements++;
    const civ = h.civById(r.settlement.civId);
    if (!civ) { extIssues.push(`d${d}: settlement of ghost culture`); continue; }
    if (civ.fate === "fallen" || civ.fate === "transformed") {
      extIssues.push(`d${d}: living settlement of a ${civ.fate} culture (${civ.name})`);
    }
    if (r.settlement.population <= 0) extIssues.push(`d${d}: empty settlement`);
  }
}
gate(`hiring only from surviving cultures (${settlements} settlements)`,
  extIssues.length === 0, extIssues.slice(0, 3).join(" | "));

// ============================================ 7. EVENT PRECONDITIONS ====

console.log("\n=== PRECONDITION PROPERTY ===");
const preIssues: string[] = [];
for (let s = 0; s < 40; s++) {
  const h = new History(`precond-${s}`);
  for (let c = 0; c < 5; c++) {
    const ch = h.getChapter(c);
    for (const e of ch.events) {
      if (!e.civId) continue;
      const civ = h.civById(e.civId);
      if (!civ) continue;
      const enemies = civ.relations.filter((r) => r.kind === "war").length;
      const ctx = {
        enemyCount: enemies, riverCount: ch.rivers.length,
        rulerCount: civ.rulers.length, hasParentCulture: civ.parentCivId !== null,
        heat: ch.stratum.heat, peerCount: Math.max(0, ch.civs.length - 1),
      };
      if (!isSatisfied(e.type, ctx)) {
        preIssues.push(`${e.id}: ${e.type} generated without its preconditions`);
      }
    }
  }
}
gate("every generated event satisfies its declared preconditions",
  preIssues.length === 0, preIssues.slice(0, 3).join(" | "));

// ====================================================== 8. SUMMARY ====

const secs = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`\n=== DEEP VALIDATION ${failures ? "FAILED" : "PASSED"} in ${secs}s ===`);
console.log(`expeditions: ${EXPEDITIONS} (${DEEP_EXPEDITIONS} deep to depth 60), floors: ${agg.floors}`);
console.log(`cultures: ${civCount}, events: ${eventCount}, documents: ${docCount}, ` +
  `interpretations: ${interpCount}, companions: ${compCount}`);
if (failures) console.log(`${failures} GATE FAILURES`);
process.exit(failures ? 1 : 0);
