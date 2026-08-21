// Full-expedition harness.
//
// Runs a complete descent through the SAME canonical modules the game uses:
// History -> Region -> terrain -> populate -> interact -> ledger -> save/load.
// It does not play combat like a human; it exercises every system that a real
// expedition touches, in order, so long-horizon coherence can be measured.

import * as THREE from "three";
import { History } from "../../src/gen/history";
import { Region, generateRegion } from "../../src/gen/regions";
import { buildTerrain } from "../../src/world/terrain";
import { populate } from "../../src/world/populate";
import { Ledger, SaveData } from "../../src/sim/ledger";
import { Expedition, validateExpedition, validateNarrativeOrder } from "../../src/sim/expedition";
import {
  Inventory, startingPack, MAX_WEIGHT, ITEMS, spillToCapacity,
} from "../../src/player/inventory";
import { Loadout, Gear } from "../../src/player/equipment";
import {
  Companion, scholarReading, carryBonus, observationMultiplier, scholarOf,
} from "../../src/player/companions";
import { interpret } from "../../src/gen/interpretation";
import { RNG } from "../../src/core/rng";

export interface ExpeditionResult {
  seed: string;
  depthReached: number;
  floors: number;
  documentsRead: number;
  interpretations: number;
  culturesMet: number;
  creaturesObserved: number;
  companionsHired: number;
  companionsDied: number;
  gearFound: number;
  gearEquipped: number;
  rests: number;
  mealsEaten: number;
  starvedRests: number;
  artifactsCarried: number;
  worldEvents: number;
  journalEntries: number;
  peakInventoryWeight: number;
  finalCapacity: number;
  errors: string[];
  integrityIssues: string[];
  /** Cross-checks that the run stayed coherent. */
  invariantFailures: string[];
}

export interface HarnessOptions {
  maxDepth: number;
  /** Hire whenever a hiring fire is available. */
  hire?: boolean;
  /** Kill a companion partway to exercise permadeath + propagation. */
  killCompanionAtDepth?: number;
  /** Start with no food to exercise the shortage path. */
  starve?: boolean;
  /** Round-trip the save at this depth and continue from the restored state. */
  saveLoadAtDepth?: number;
  /** Equip gear as it is found (heavy-armor run). */
  equipGear?: boolean;
}

/** Serialize/deserialize exactly as the game's save system does. */
function roundTripSave(
  seed: string, gameTime: number, depth: number, inv: Inventory,
  loadout: Loadout, companions: Companion[], ledger: Ledger, exp: Expedition,
): { inv: Inventory; loadout: Loadout; companions: Companion[]; ledger: Ledger; exp: Expedition } {
  const save: SaveData & { journal?: unknown } = {
    seed, gameTime, depth, campDepth: depth,
    hp: 80, stamina: 90, mana: 30, hunger: 70, thirst: 70, torchFuel: 55,
    injury: null,
    inventory: { ...inv.items },
    equipped: { weapon: "sword", armor: loadout.body?.name ?? null },
    companions, loadout: loadout.serialize(),
    ledgerFlags: ledger.flags, dynamicEvents: ledger.dynamicEvents,
    codex: { docsRead: [], docsMeta: [], speciesSeen: {}, civsMet: [], regionsVisited: [] },
    journal: exp.serialize(),
  };
  const json = JSON.parse(JSON.stringify(save));

  const inv2 = new Inventory();
  inv2.items = { ...json.inventory };
  const loadout2 = Loadout.restore(json.loadout);
  const ledger2 = new Ledger();
  ledger2.flags = json.ledgerFlags;
  ledger2.dynamicEvents = json.dynamicEvents;
  const exp2 = Expedition.restore(json.journal);
  return { inv: inv2, loadout: loadout2, companions: json.companions, ledger: ledger2, exp: exp2 };
}

export function runExpedition(seed: string, opts: HarnessOptions): ExpeditionResult {
  const rng = new RNG(seed + ":harness");
  const history = new History(seed);
  const errors: string[] = [];
  const invariantFailures: string[] = [];

  let inventory = startingPack();
  if (opts.starve) {
    for (const n of ["rations", "spore-bread", "old rations", "blindfish"]) {
      inventory.remove(n, inventory.count(n));
    }
  }
  let loadout = new Loadout();
  let companions: Companion[] = [];
  let ledger = new Ledger();
  let expedition = new Expedition();
  let gameTime = 8;

  const r: ExpeditionResult = {
    seed, depthReached: 0, floors: 0, documentsRead: 0, interpretations: 0,
    culturesMet: 0, creaturesObserved: 0, companionsHired: 0, companionsDied: 0,
    gearFound: 0, gearEquipped: 0, rests: 0, mealsEaten: 0, starvedRests: 0,
    artifactsCarried: 0, worldEvents: 0, journalEntries: 0,
    peakInventoryWeight: 0, finalCapacity: 0, errors, integrityIssues: [],
    invariantFailures,
  };
  const culturesMet = new Set<string>();
  const speciesSeen = new Set<string>();

  const carryLimit = () => MAX_WEIGHT + carryBonus(companions);
  const carried = () => inventory.exactWeight() + loadout.exactWeight();
  const capacity = () => Math.max(0, carryLimit() - loadout.exactWeight());

  for (let depth = 1; depth <= opts.maxDepth; depth++) {
    let region: Region;
    try {
      region = generateRegion(history, depth);
    } catch (e) {
      errors.push(`depth ${depth}: region generation threw: ${(e as Error).message}`);
      break;
    }

    let populated;
    try {
      const terrain = buildTerrain(region);
      populated = populate(region, terrain, ledger);
    } catch (e) {
      errors.push(`depth ${depth}: populate threw: ${(e as Error).message}`);
      break;
    }

    r.floors++;
    r.depthReached = depth;
    gameTime += 1.5;
    expedition.record({
      atTime: gameTime, depth, kind: "descend",
      ref: `depth:${depth}`, summary: `Descended to ${region.name}, ${region.epithet}`,
    });

    // --- Interact with everything on the floor, in the order the player would.
    for (const it of populated.interactables) {
      gameTime += 0.05;
      try {
        switch (it.kind) {
          case "doc": {
            const doc = it.doc!;
            r.documentsRead++;
            expedition.record({
              atTime: gameTime, depth, kind: "document",
              ref: doc.id, summary: doc.title,
            });
            if (doc.civId && !culturesMet.has(doc.civId)) {
              culturesMet.add(doc.civId);
              expedition.record({
                atTime: gameTime, depth, kind: "culture",
                ref: doc.civId, summary: history.civById(doc.civId)?.name ?? "?",
              });
            }
            // Scholar interpretation, exactly as the game path does it.
            const scholar = scholarOf(companions);
            if (scholar) {
              const reading = scholarReading(scholar, doc, history);
              if (reading) {
                r.interpretations++;
                expedition.record({
                  atTime: gameTime, depth, kind: "interpretation",
                  ref: scholar.id, summary: reading.text.slice(0, 60),
                  provenance: reading.provenance,
                });
                // Invariant: an unfamiliar reading must not claim shared events.
                if (reading.provenance.relationship === "unfamiliar" &&
                    reading.provenance.sharedEventIds.length > 0) {
                  invariantFailures.push(`d${depth}: unfamiliar reading cited shared events`);
                }
                // Invariant: opaque readings must admit ignorance.
                if (reading.provenance.legibility === "opaque" &&
                    !reading.provenance.admitsIgnorance) {
                  invariantFailures.push(`d${depth}: opaque reading did not admit ignorance`);
                }
              }
            } else if (companions.some((c) => c.role === "scholar" && !c.alive)) {
              // Invariant: a dead scholar must provide nothing.
              const ghost = companions.find((c) => c.role === "scholar")!;
              if (scholarReading(ghost, doc, history) !== null) {
                invariantFailures.push(`d${depth}: dead scholar still interpreting`);
              }
            }
            break;
          }
          case "recruit": {
            if (!opts.hire) break;
            for (const cand of it.candidates ?? []) {
              if (companions.length >= 3) break;
              // Pay in real supplies if we can afford it.
              const cost = [{ item: "rations", qty: 1 }];
              if (cost.every((c) => inventory.count(c.item) >= c.qty)) {
                for (const c of cost) inventory.remove(c.item, c.qty);
                companions.push(cand);
                ledger.set(`hired:${cand.id}`, gameTime);
                r.companionsHired++;
                expedition.record({
                  atTime: gameTime, depth, kind: "companion-hired",
                  ref: cand.id, summary: `${cand.name} the ${cand.role}`,
                });
                // Invariant: hired companion must come from a resolvable culture.
                if (!cand.civId || !history.civById(cand.civId)) {
                  invariantFailures.push(`d${depth}: companion ${cand.id} has no valid culture`);
                }
              }
            }
            break;
          }
          case "chest":
          case "camp-remnant": {
            for (const l of it.loot ?? []) {
              // A starvation run refuses food it finds, so the shortage path is real.
              if (opts.starve && ITEMS[l.item]?.type === "food") continue;
              if (inventory.add(l.item, l.qty, capacity())) {
                if (ITEMS[l.item]?.type === "artifact" || l.item.includes("(")) r.artifactsCarried += l.qty;
              }
            }
            for (const g of it.gearLoot ?? []) {
              r.gearFound++;
              // Gear pickup respects the carry budget, exactly as the game does.
              if (!loadout.tryAdd(g, carryLimit() - carried())) continue;
              // Invariant: gear provenance must name a real culture.
              if (region.builderCiv && !g.origin.includes(region.builderCiv.military) &&
                  g.slot === "body") {
                invariantFailures.push(`d${depth}: armor ${g.name} does not cite a tradition`);
              }
              if (opts.equipGear) {
                loadout.equip(g);
                r.gearEquipped++;
              }
              expedition.record({
                atTime: gameTime, depth, kind: "artifact", ref: g.id, summary: g.name,
              });
            }
            ledger.set(`looted:${it.id}`, gameTime);
            break;
          }
          case "resource": {
            // A starvation run also refuses food it could harvest or fish.
            if (opts.starve && ITEMS[it.resource!]?.type === "food") break;
            inventory.add(it.resource!, 1, capacity());
            break;
          }
          case "seal": {
            ledger.set(`seal-open:${depth}`, gameTime);
            break;
          }
        }
      } catch (e) {
        errors.push(`depth ${depth} interact ${it.kind}: ${(e as Error).message}`);
      }
    }

    // --- Observe / kill some creatures (drives bestiary + ledger persistence).
    const obsMult = observationMultiplier(companions);
    for (const spawn of populated.spawns.slice(0, 4)) {
      speciesSeen.add(spawn.species.id);
      if (rng.chance(0.35)) {
        ledger.set(`slain:${depth}:${spawn.id}`, gameTime);
        inventory.add("meat", 1, capacity());
        expedition.record({
          atTime: gameTime, depth, kind: "creature",
          ref: spawn.species.id, summary: spawn.species.name,
        });
      }
    }
    void obsMult;

    // --- Kill a companion to exercise permadeath + downstream consequences.
    // Fires at the requested depth OR the first floor after one is hired,
    // since settlements are not guaranteed above any particular depth.
    const wantKill = opts.killCompanionAtDepth !== undefined
      && depth >= opts.killCompanionAtDepth
      && companions.some((c) => c.alive)
      && r.companionsDied === 0;
    if (wantKill) {
      const victim = companions.find((c) => c.alive);
      if (victim) {
        victim.alive = false;
        victim.hp = 0;
        r.companionsDied++;
        ledger.set(`comp-dead:${victim.id}`, gameTime, String(depth));
        // Their share of the load stays with them.
        spillToCapacity(inventory, loadout.exactWeight(), carryLimit());
        expedition.record({
          atTime: gameTime, depth, kind: "companion-died",
          ref: victim.id, summary: `${victim.name} died at depth ${depth}`,
        });
      }
    }

    // --- Rest: everyone eats. This is the real resource pressure.
    if (depth % 3 === 0) {
      r.rests++;
      gameTime += 8;
      const mouths = 1 + companions.filter((c) => c.alive).length;
      let fed = 0;
      for (let m = 0; m < mouths; m++) {
        const ate = inventory.remove("rations", 1) || inventory.remove("spore-bread", 1)
          || inventory.remove("old rations", 1) || inventory.remove("blindfish", 1);
        if (ate) fed++;
      }
      r.mealsEaten += fed;
      if (fed < mouths) r.starvedRests++;
      // Invariant: no negative inventory, ever.
      for (const [name, qty] of Object.entries(inventory.items)) {
        if (qty < 0) invariantFailures.push(`d${depth}: negative inventory ${name}=${qty}`);
      }
      ledger.propagate(gameTime, history);
      const unseen = ledger.dynamicEvents.filter((d) => !d.seen);
      ledger.takeNews();
      for (const ev of unseen) {
        r.worldEvents++;
        expedition.record({
          atTime: gameTime, depth, kind: "consequence",
          ref: ev.id, summary: ev.text.slice(0, 60),
        });
      }
    }

    r.peakInventoryWeight = Math.max(r.peakInventoryWeight, inventory.weight());

    // --- Invariants that must hold on every floor.
    if (carried() > carryLimit() + 0.001) {
      invariantFailures.push(`d${depth}: overweight ${carried()} > ${carryLimit()}`);
    }
    if (capacity() < 0) invariantFailures.push(`d${depth}: negative capacity`);
    for (const c of companions) {
      if (!c.alive && c.hp > 0) invariantFailures.push(`d${depth}: dead companion with hp ${c.hp}`);
    }
    if (carryBonus(companions) !== companions.filter((c) => c.alive && c.role === "porter").length * 12) {
      invariantFailures.push(`d${depth}: porter bonus mismatch`);
    }

    // --- Save/load round trip mid-expedition.
    if (opts.saveLoadAtDepth === depth) {
      const before = {
        inv: JSON.stringify(inventory.items),
        gear: JSON.stringify(loadout.serialize()),
        comps: JSON.stringify(companions),
        flags: Object.keys(ledger.flags).length,
        journal: expedition.journal.length,
      };
      const restored = roundTripSave(seed, gameTime, depth, inventory, loadout, companions, ledger, expedition);
      inventory = restored.inv;
      loadout = restored.loadout;
      companions = restored.companions;
      ledger = restored.ledger;
      expedition = restored.exp;
      const after = {
        inv: JSON.stringify(inventory.items),
        gear: JSON.stringify(loadout.serialize()),
        comps: JSON.stringify(companions),
        flags: Object.keys(ledger.flags).length,
        journal: expedition.journal.length,
      };
      for (const k of Object.keys(before) as (keyof typeof before)[]) {
        if (before[k] !== after[k]) {
          invariantFailures.push(`d${depth}: save/load changed ${k}`);
        }
      }
    }
  }

  r.culturesMet = culturesMet.size;
  r.creaturesObserved = speciesSeen.size;
  r.companionsDied = Math.max(r.companionsDied, companions.filter((c) => !c.alive).length);
  r.journalEntries = expedition.journal.length;
  r.finalCapacity = capacity();
  r.integrityIssues = [
    ...validateExpedition(expedition, history, ledger).map((i) => `${i.entry.kind}: ${i.problem}`),
    ...validateNarrativeOrder(expedition).map((i) => `${i.entry.kind}: ${i.problem}`),
  ];
  return r;
}

/** Convenience for THREE object counting in memory checks. */
export function countSceneObjects(root: THREE.Object3D): number {
  let n = 0;
  root.traverse(() => n++);
  return n;
}
