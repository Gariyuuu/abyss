// Player-facing mechanics: equipment provenance and bounds, armor math,
// the noise/sensing cross-system rule, companion lifecycle and permadeath,
// carry capacity, and food. These are the guarantees the expedition rests on.

import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { History, Civ } from "../src/gen/history";
import { generateRegion } from "../src/gen/regions";
import { RNG, rngFor } from "../src/core/rng";
import {
  generateArmor, generateLight, generateCharm, boundGear, Loadout, GEAR_BOUNDS, Gear,
} from "../src/player/equipment";
import {
  generateCandidate, hireCost, ROLE_INFO, carryBonus, observationMultiplier,
  scholarOf, hunterOf, CompanionActor, Companion,
} from "../src/player/companions";
import { Player } from "../src/player/player";
import { Creature } from "../src/ai/creature-ai";
import { Inventory, startingPack, MAX_WEIGHT, ITEMS, RECIPES } from "../src/player/inventory";
import { Ledger } from "../src/sim/ledger";

function civs(seed: string, chapters = 3): { h: History; all: Civ[] } {
  const h = new History(seed);
  const all: Civ[] = [];
  for (let c = 0; c < chapters; c++) all.push(...h.getChapter(c).civs);
  return { h, all };
}

function flatWorld() {
  return {
    heightAt: () => 0,
    waterLevel: null,
    colliders: [],
    creatures: [] as Creature[],
  };
}

function makePlayer() {
  const cam = new THREE.PerspectiveCamera(70, 1, 0.1, 100);
  return new Player(cam, flatWorld(), {
    onToast: () => {},
    onDamaged: () => {},
    onArrowFired: () => true,
    onManaSpent: () => true,
  });
}

// ------------------------------------------------------------- equipment ----

describe("equipment provenance", () => {
  it("derives armor from the culture's recorded military tradition", () => {
    const { all } = civs("equip-provenance");
    for (const civ of all) {
      const g = generateArmor(rngFor("x", civ.id), civ, 5, 0);
      expect(g.name).toContain(civ.name);              // attributable
      expect(g.origin).toContain(civ.military);        // cites the actual tradition
      expect(g.slot).toBe("body");
    }
  });

  it("maps corridor/spear traditions to corridor plate, not stealth silk", () => {
    const { all } = civs("tradition-map", 6);
    for (const civ of all) {
      const g = generateArmor(rngFor("y", civ.id), civ, 5, 0);
      if (/spear|phalanx|corridor/.test(civ.military)) {
        expect(g.name).toContain("corridor-guard plate");
        expect(g.defense).toBeGreaterThan(6);
        expect(g.drain).toBeGreaterThan(1.2);   // heavy
        expect(g.noise).toBeGreaterThan(1.2);   // loud
      }
      if (/silent|echo|sling/.test(civ.military)) {
        expect(g.name).toContain("echo-cloth");
        expect(g.noise).toBeLessThan(1);        // quiet tradition => quiet gear
        expect(g.drain).toBeLessThanOrEqual(1.05);
      }
    }
  });

  it("keeps stats consistent with the description (heavy implies loud and tiring)", () => {
    const { all } = civs("stat-consistency", 6);
    for (const civ of all) {
      const g = generateArmor(rngFor("z", civ.id), civ, 9, 1);
      // Heavier pieces must never be simultaneously the lightest to run in.
      if (g.weight > 5) expect(g.drain).toBeGreaterThan(1.1);
      if (g.weight < 2.5) expect(g.drain).toBeLessThanOrEqual(1.1);
    }
  });

  it("derives charms from the culture's actual religious tenet", () => {
    const { all } = civs("charm-provenance");
    for (const civ of all) {
      const c = generateCharm(rngFor("c", civ.id), civ, 3, 0);
      expect(c.origin).toContain(civ.religion.tenet);
      expect(c.name).toContain(civ.religion.deity);
    }
  });
});

describe("equipment stat bounds", () => {
  it("clamps hostile inputs instead of emitting NaN or negatives", () => {
    const evil: Gear = {
      id: "x", slot: "body", name: "n", origin: "o",
      defense: -50, weight: NaN, drain: 0, noise: Infinity,
      lightRadius: -1, fuelBurn: NaN,
    };
    const g = boundGear(evil);
    expect(g.defense).toBeGreaterThanOrEqual(GEAR_BOUNDS.defense[0]);
    expect(Number.isFinite(g.weight)).toBe(true);
    expect(g.drain).toBeGreaterThanOrEqual(GEAR_BOUNDS.drain[0]);
    expect(g.noise).toBeLessThanOrEqual(GEAR_BOUNDS.noise[1]);
    expect(g.lightRadius).toBeGreaterThanOrEqual(GEAR_BOUNDS.lightRadius[0]);
    expect(Number.isFinite(g.fuelBurn)).toBe(true);
  });

  it("keeps every generated item inside model bounds across many cultures", () => {
    const { all } = civs("bounds-fuzz", 8);
    let items = 0;
    for (const civ of all) {
      for (let i = 0; i < 8; i++) {
        const r = rngFor(`bounds-${i}`, civ.id);
        for (const g of [
          generateArmor(r, civ, i, i),
          generateLight(r, civ, i, i),
          generateCharm(r, civ, i, i),
        ]) {
          items++;
          for (const [k, [lo, hi]] of Object.entries(GEAR_BOUNDS)) {
            const v = g[k as keyof Gear] as number;
            expect(Number.isFinite(v)).toBe(true);
            expect(v).toBeGreaterThanOrEqual(lo);
            expect(v).toBeLessThanOrEqual(hi);
          }
          expect(g.name.length).toBeGreaterThan(3);
          expect(g.origin.length).toBeGreaterThan(10);
          expect(g.name).not.toContain("undefined");
          expect(g.origin).not.toContain("undefined");
        }
      }
    }
    expect(items).toBeGreaterThan(300);
  });

  it("produces genuine tradeoffs rather than one dominant armor", () => {
    const { all } = civs("tradeoffs", 10);
    const armors = all.map((c) => generateArmor(rngFor("t", c.id), c, 5, 0));
    // No single item may be best-or-equal on every axis simultaneously.
    const dominant = armors.filter((a) =>
      armors.every((b) =>
        a === b || (a.defense >= b.defense && a.drain <= b.drain && a.noise <= b.noise && a.weight <= b.weight)));
    expect(dominant.length).toBe(0);
    // And the population must actually vary.
    expect(new Set(armors.map((a) => a.defense)).size).toBeGreaterThan(2);
    expect(new Set(armors.map((a) => a.noise)).size).toBeGreaterThan(1);
  });

  it("does not scale armor by depth like levelled loot", () => {
    const { all } = civs("no-levelled-loot", 6);
    const civ = all[0];
    const shallow = generateArmor(rngFor("d", civ.id), civ, 1, 0);
    const deep = generateArmor(rngFor("d", civ.id), civ, 60, 0);
    // Same culture, same rng => same item regardless of depth found.
    expect(deep.defense).toBe(shallow.defense);
    expect(deep.name).toBe(shallow.name);
  });
});

describe("armor damage regression", () => {
  it("reduces a 30-damage hit to 20 with +10 armor", () => {
    const p = makePlayer();
    p.loadout.body = boundGear({
      id: "a", slot: "body", name: "test plate", origin: "test",
      defense: 10, weight: 5, drain: 1, noise: 1, lightRadius: 1, fuelBurn: 1,
    });
    p.hp = 100;
    p.damage(30, "test");
    expect(p.hp).toBe(80);
  });

  it("never heals the player through excessive armor", () => {
    const p = makePlayer();
    p.loadout.body = boundGear({
      id: "a", slot: "body", name: "absurd", origin: "test",
      defense: GEAR_BOUNDS.defense[1], weight: 5, drain: 1, noise: 1, lightRadius: 1, fuelBurn: 1,
    });
    p.hp = 100;
    p.damage(5, "test");
    expect(p.hp).toBeLessThan(100);       // still took damage
    expect(p.hp).toBeGreaterThanOrEqual(95);
    expect(p.hp).toBe(99);                // clamped to a 1-point floor
  });

  it("stacks defense across slots without going negative", () => {
    const l = new Loadout();
    l.body = boundGear({ id: "b", slot: "body", name: "x", origin: "x", defense: 8, weight: 4, drain: 1.2, noise: 1.3, lightRadius: 1, fuelBurn: 1 });
    l.charm = boundGear({ id: "c", slot: "charm", name: "y", origin: "y", defense: 3, weight: 0.3, drain: 1, noise: 0.8, lightRadius: 1, fuelBurn: 1 });
    expect(l.defense()).toBe(11);
    expect(l.noise()).toBeCloseTo(1.3 * 0.8, 5);
    expect(l.drain()).toBeCloseTo(1.2, 5);
  });
});

// ------------------------------------------------------- noise vs sensing ----

describe("noise and creature sensing", () => {
  function creatureOf(seed: string, opts: { eyes: number; weakness: "sound" | "none" }) {
    const h = new History(seed);
    const region = generateRegion(h, 4);
    const sp = { ...region.species[0] };
    sp.plan = { ...sp.plan, eyes: opts.eyes };
    sp.weaknessKind = opts.weakness;
    sp.aggro = 0.9;
    sp.fleesLight = false;
    return sp;
  }

  /** Probability a creature notices the player over many identical ticks. */
  function noticeRate(sp: ReturnType<typeof creatureOf>, noise: number, dist: number): number {
    let noticed = 0;
    const TRIALS = 400;
    for (let i = 0; i < TRIALS; i++) {
      const c = new Creature("t", sp, new THREE.Vector3(dist, 0, 0), () => 0, {
        onPlayerHit: () => {}, onObserve: () => {}, onDeath: () => {},
      });
      c.state = "idle";
      for (let step = 0; step < 20; step++) {
        c.update(0.05, new THREE.Vector3(0, 0, 0), false, false, noise);
        if ((c.state as string) === "stalk") { noticed++; break; }
      }
    }
    return noticed / TRIALS;
  }

  it("lets echo-hunting creatures detect loud armor from further away", () => {
    const echo = creatureOf("echo-sense", { eyes: 0, weakness: "sound" });
    // Just outside the quiet notice radius, inside the loud one.
    const dist = 25;
    const quiet = noticeRate(echo, 0.6, dist);
    const loud = noticeRate(echo, 1.6, dist);
    expect(quiet).toBe(0);                 // out of range when quiet
    expect(loud).toBeGreaterThan(0.2);     // heard when loud
  });

  it("raises alertness with noise even inside the base radius", () => {
    const echo = creatureOf("echo-alert", { eyes: 0, weakness: "sound" });
    const quiet = noticeRate(echo, 0.5, 12);
    const loud = noticeRate(echo, 1.8, 12);
    expect(loud).toBeGreaterThan(quiet);
  });

  it("does not let noise affect a sighted creature with no echo sense", () => {
    const sighted = creatureOf("sight-sense", { eyes: 2, weakness: "none" });
    const quiet = noticeRate(sighted, 0.5, 25);
    const loud = noticeRate(sighted, 1.9, 25);
    // Outside the fixed 22m sight radius, noise must not conjure detection.
    expect(quiet).toBe(0);
    expect(loud).toBe(0);
  });

  it("gives no creature omniscient unlimited-range detection", () => {
    const echo = creatureOf("omniscience", { eyes: 0, weakness: "sound" });
    expect(noticeRate(echo, GEAR_BOUNDS.noise[1], 200)).toBe(0);
  });
});

// ------------------------------------------------------------ companions ----

describe("companion canonicality", () => {
  it("always originates from a real generated culture", () => {
    const { h, all } = civs("companion-canon", 4);
    for (const civ of all) {
      for (let i = 0; i < 6; i++) {
        const c = generateCandidate(rngFor(`cand-${i}`, civ.id), civ, 7, i);
        expect(c.civId).toBe(civ.id);
        expect(h.civById(c.civId!)).toBeTruthy();
        expect(c.name.length).toBeGreaterThan(1);
        expect(ROLE_INFO[c.role]).toBeTruthy();
        expect(c.motive.length).toBeGreaterThan(10);
        expect(c.hp).toBe(ROLE_INFO[c.role].hp);
        expect(c.alive).toBe(true);
      }
    }
  });

  it("charges a hire price payable in real inventory items", () => {
    for (const role of ["porter", "warden", "scholar", "hunter"] as const) {
      const cost = hireCost(role);
      expect(cost.length).toBeGreaterThan(0);
      for (const c of cost) {
        expect(ITEMS[c.item]).toBeTruthy();   // must be a real item
        expect(c.qty).toBeGreaterThan(0);
      }
    }
  });

  it("only offers hires from settlements of surviving cultures", () => {
    // A settlement (and therefore a hiring fire) may only exist where people live.
    const h = new History("extinction-hiring");
    for (let d = 1; d <= 40; d++) {
      const r = generateRegion(h, d);
      if (!r.settlement) continue;
      const civ = h.civById(r.settlement.civId)!;
      expect(civ).toBeTruthy();
      expect(civ.fate === "extant" || civ.fate === "scattered").toBe(true);
      expect(r.settlement.population).toBeGreaterThan(0);
    }
  });

  it("gives every companion a unique id within a settlement", () => {
    const { all } = civs("unique-ids", 4);
    for (const civ of all) {
      const ids = new Set<string>();
      for (let i = 0; i < 5; i++) {
        ids.add(generateCandidate(rngFor(`u-${i}`, civ.id), civ, 3, i).id);
      }
      expect(ids.size).toBe(5);
    }
  });
});

describe("companion role effects", () => {
  const mk = (role: Companion["role"], alive = true): Companion => ({
    id: `c-${role}-${alive}`, name: "N", civId: null, role,
    hp: 10, maxHp: 10, alive, hiredAtDepth: 1, motive: "m",
  });

  it("applies porter capacity once per living porter", () => {
    expect(carryBonus([])).toBe(0);
    expect(carryBonus([mk("porter")])).toBe(12);
    expect(carryBonus([mk("porter"), mk("porter")])).toBe(24);
    // Dead porters carry nothing.
    expect(carryBonus([mk("porter"), mk("porter", false)])).toBe(12);
    // Other roles do not carry.
    expect(carryBonus([mk("warden"), mk("scholar"), mk("hunter")])).toBe(0);
  });

  it("drops the hunter learning bonus the moment the hunter dies", () => {
    expect(observationMultiplier([])).toBe(1);
    expect(observationMultiplier([mk("hunter")])).toBeGreaterThan(1);
    expect(observationMultiplier([mk("hunter", false)])).toBe(1);
    // Two hunters do not compound into omniscience.
    expect(observationMultiplier([mk("hunter"), mk("hunter")]))
      .toBe(observationMultiplier([mk("hunter")]));
  });

  it("stops offering scholar and hunter services after death", () => {
    expect(scholarOf([mk("scholar")])).toBeTruthy();
    expect(scholarOf([mk("scholar", false)])).toBeNull();
    expect(hunterOf([mk("hunter")])).toBeTruthy();
    expect(hunterOf([mk("hunter", false)])).toBeNull();
  });
});

describe("warden interposition", () => {
  const wardenComp = (): Companion => ({
    id: "w", name: "W", civId: null, role: "warden",
    hp: 130, maxHp: 130, alive: true, hiredAtDepth: 1, motive: "m",
  });

  it("moves between the player and a threat rather than teleporting", () => {
    const comp = wardenComp();
    const start = new THREE.Vector3(0, 0, 0);
    const actor = new CompanionActor(comp, null, start.clone(), {
      heightAt: () => 0, onSpeak: () => {}, onDeath: () => {},
    });
    const player = new THREE.Vector3(0, 0, 0);
    const threat = { pos: new THREE.Vector3(10, 0, 0), hp: 100, name: "t", damage: () => {} };
    const before = actor.mesh.position.clone();
    actor.update(0.1, player, [threat]);
    const moved = actor.mesh.position.distanceTo(before);
    expect(moved).toBeGreaterThan(0);
    expect(moved).toBeLessThan(2);          // no teleport
    // Heads toward the midpoint between player and threat.
    expect(actor.mesh.position.x).toBeGreaterThan(before.x);
  });

  it("only strikes once it is actually close to the threat", () => {
    const comp = wardenComp();
    let hits = 0;
    const far = new CompanionActor(comp, null, new THREE.Vector3(0, 0, 0), {
      heightAt: () => 0, onSpeak: () => {}, onDeath: () => {},
    });
    const threat = { pos: new THREE.Vector3(40, 0, 0), hp: 100, name: "t", damage: () => { hits++; } };
    // Threat far from the PLAYER means it is not engaged at all.
    far.update(0.1, new THREE.Vector3(0, 0, 0), [threat]);
    expect(hits).toBe(0);

    // Adjacent to a threat that is near the player: it strikes.
    const near = new CompanionActor({ ...comp, id: "w2" }, null, new THREE.Vector3(2, 0, 0), {
      heightAt: () => 0, onSpeak: () => {}, onDeath: () => {},
    });
    const close = { pos: new THREE.Vector3(3, 0, 0), hp: 100, name: "t", damage: () => { hits++; } };
    near.update(0.1, new THREE.Vector3(0, 0, 0), [close]);
    expect(hits).toBe(1);
  });

  it("returns to following once the threat is gone (no AI state lock)", () => {
    const comp = wardenComp();
    const actor = new CompanionActor(comp, null, new THREE.Vector3(6, 0, 0), {
      heightAt: () => 0, onSpeak: () => {}, onDeath: () => {},
    });
    const player = new THREE.Vector3(0, 0, 0);
    const threat = { pos: new THREE.Vector3(12, 0, 0), hp: 100, name: "t", damage: () => {} };
    for (let i = 0; i < 10; i++) actor.update(0.1, player, [threat]);
    // Threat removed: the warden must come back to the player.
    for (let i = 0; i < 120; i++) actor.update(0.1, player, []);
    expect(actor.mesh.position.distanceTo(player)).toBeLessThan(4);
  });

  it("can be injured and killed, and stops acting when dead", () => {
    const comp = wardenComp();
    let died: Companion | null = null;
    const actor = new CompanionActor(comp, null, new THREE.Vector3(0, 0, 0), {
      heightAt: () => 0, onSpeak: () => {}, onDeath: (c) => { died = c; },
    });
    actor.takeDamage(50);
    expect(comp.alive).toBe(true);
    expect(comp.hp).toBe(80);
    actor.takeDamage(200);
    expect(comp.alive).toBe(false);
    expect(died).toBeTruthy();

    // A dead warden neither moves nor strikes.
    const pos = actor.mesh.position.clone();
    let hits = 0;
    actor.update(0.1, new THREE.Vector3(30, 0, 0), [
      { pos: new THREE.Vector3(1, 0, 0), hp: 10, name: "t", damage: () => { hits++; } },
    ]);
    expect(actor.mesh.position.distanceTo(pos)).toBe(0);
    expect(hits).toBe(0);
  });

  it("does not sit on top of the player while following", () => {
    const comp: Companion = { ...wardenComp(), role: "porter" };
    const actor = new CompanionActor(comp, null, new THREE.Vector3(20, 0, 20), {
      heightAt: () => 0, onSpeak: () => {}, onDeath: () => {},
    });
    const player = new THREE.Vector3(0, 0, 0);
    for (let i = 0; i < 200; i++) actor.update(0.05, player, []);
    const d = actor.mesh.position.distanceTo(player);
    expect(d).toBeGreaterThan(0.8);   // keeps personal space
    expect(d).toBeLessThan(5);        // but stays with the party
  });
});

// ----------------------------------------------------- carry weight, food ----

describe("carry weight", () => {
  it("accepts a load up to exactly capacity and refuses beyond it", () => {
    const inv = new Inventory();
    const cap = 10;
    // "flint" weighs 0.3 -> 33 of them is 9.9, one more is 10.2 (over).
    for (let i = 0; i < 33; i++) expect(inv.add("flint", 1, cap)).toBe(true);
    expect(inv.weight()).toBeCloseTo(9.9, 5);
    expect(inv.add("flint", 1, cap)).toBe(false);
    expect(inv.weight()).toBeCloseTo(9.9, 5);   // refusal must not partially apply
  });

  it("computes weight without floating point drift over many items", () => {
    const inv = new Inventory();
    for (let i = 0; i < 200; i++) inv.add("arrow", 1, 1000);
    expect(inv.weight()).toBeCloseTo(14, 1);
    expect(Number.isFinite(inv.weight())).toBe(true);
  });

  it("refuses a zero or negative removal instead of writing NaN into the stack", () => {
    // Regression: remove(x, 0) on a missing item used to store NaN, after which
    // every comparison failed open and the item could be removed forever.
    const inv = new Inventory();
    expect(inv.remove("spore-bread", 0)).toBe(false);
    expect(inv.count("spore-bread")).toBe(0);
    expect(Number.isFinite(inv.weight())).toBe(true);
    expect(inv.weight()).toBe(0);
    // And it must not have become infinitely removable.
    expect(inv.remove("spore-bread", 1)).toBe(false);
    expect(inv.remove("spore-bread", -3)).toBe(false);
    expect(inv.add("spore-bread", 0)).toBe(false);
    expect(inv.add("spore-bread", NaN)).toBe(false);
    expect(Object.values(inv.items).every((v) => Number.isFinite(v))).toBe(true);
  });

  it("keeps weight finite even if a stack is externally corrupted", () => {
    const inv = new Inventory();
    inv.add("rations", 2, 100);
    (inv.items as Record<string, number>)["rations"] = NaN;
    expect(Number.isFinite(inv.weight())).toBe(true);
    expect(inv.count("rations")).toBe(0);
    expect(inv.remove("rations", 1)).toBe(false);
  });

  it("never goes negative when removing more than is held", () => {
    const inv = new Inventory();
    inv.add("rations", 2, 100);
    expect(inv.remove("rations", 5)).toBe(false);
    expect(inv.count("rations")).toBe(2);
    expect(inv.remove("nothing-here", 1)).toBe(false);
    expect(inv.count("nothing-here")).toBe(0);
  });

  it("gives porters real capacity that gear weight offsets", () => {
    const inv = startingPack();
    const base = MAX_WEIGHT;
    const withPorter = MAX_WEIGHT + carryBonus([{
      id: "p", name: "P", civId: null, role: "porter",
      hp: 1, maxHp: 1, alive: true, hiredAtDepth: 1, motive: "m",
    }]);
    expect(withPorter).toBe(base + 12);
    expect(inv.weight()).toBeLessThan(base);
  });
});

describe("crafting", () => {
  it("only produces recipes whose inputs and outputs are real items", () => {
    for (const r of RECIPES) {
      expect(ITEMS[r.out]).toBeTruthy();
      expect(r.qty).toBeGreaterThan(0);
      for (const [item, qty] of r.needs) {
        expect(ITEMS[item]).toBeTruthy();
        expect(qty).toBeGreaterThan(0);
      }
    }
  });

  it("consumes inputs exactly once and refuses when short", () => {
    const inv = new Inventory();
    const recipe = RECIPES.find((r) => r.out === "bandage")!;
    expect(inv.canCraft(recipe)).toBe(false);
    expect(inv.craft(recipe)).toBe(false);
    inv.add("fiber", 2, 100);
    expect(inv.craft(recipe)).toBe(true);
    expect(inv.count("fiber")).toBe(0);
    expect(inv.count("bandage")).toBe(recipe.qty);
  });
});

// ---------------------------------------------------------------- ledger ----

describe("ledger permanence and propagation", () => {
  it("keeps the first timestamp for a flag and never silently overwrites", () => {
    const l = new Ledger();
    l.set("slain:5:x", 10);
    l.set("slain:5:x", 99);
    expect(l.get("slain:5:x")!.t).toBe(10);
  });

  it("propagates a companion death into world news exactly once", () => {
    const l = new Ledger();
    const h = new History("death-propagation");
    l.set("comp-dead:c1", 0, "12");
    l.propagate(100, h);
    const first = l.takeNews();
    expect(first.length).toBeGreaterThan(0);
    expect(first.join(" ")).toMatch(/hiring|price|did not come back/i);
    l.propagate(200, h);
    expect(l.takeNews()).toEqual([]);   // no duplicate announcements
  });

  it("does not react to a death before news could have travelled", () => {
    const l = new Ledger();
    const h = new History("death-latency");
    l.set("comp-dead:c1", 0, "12");
    l.propagate(1, h);                  // one hour later
    expect(l.takeNews()).toEqual([]);   // too soon
    l.propagate(60, h);
    expect(l.takeNews().length).toBeGreaterThan(0);
  });

  it("opens a sealed passage permanently and reports first contact once", () => {
    const l = new Ledger();
    const h = new History("seal-propagation");
    l.set("seal-open:9", 0);
    l.propagate(48, h);
    expect(l.takeNews().length).toBeGreaterThan(0);
    expect(l.has("seal-open:9")).toBe(true);
  });
});
