// Equipment. Armor is not a static loot table: each piece is generated from the
// military tradition of the culture whose floor you found it on, so a set of
// beetle-shell lamellar exists because that civ's `military` line says they
// fought in beetle-shell lamellar, and its stats follow from the material.
//
// Every stat here is mechanically real:
//   defense  — flat damage reduction
//   weight   — counts against the pack limit, so armor competes with food
//   drain    — extra stamina cost while running (heavy armor tires you)
//   noise    — sound-hunting creatures notice you sooner in loud armor
//   glow     — lanterns trade light radius against fuel burn

import { RNG } from "../core/rng";
import { Civ } from "../gen/history";

export type Slot = "body" | "light" | "charm";

export interface Gear {
  id: string;
  slot: Slot;
  name: string;
  origin: string;        // which culture made it, and why it looks like this
  defense: number;
  weight: number;
  drain: number;         // stamina multiplier while running (1 = normal)
  noise: number;         // 1 = normal; >1 attracts sound-hunters sooner
  lightRadius: number;   // multiplier on torch range (light slot)
  fuelBurn: number;      // multiplier on torch fuel use (light slot)
}

// Material inferred from the culture's own recorded military tradition.
const MATERIALS: [RegExp, { mat: string; def: number; wt: number; drain: number; noise: number }][] = [
  [/beetle-shell|lamellar/, { mat: "beetle-shell lamellar", def: 9, wt: 5.5, drain: 1.25, noise: 1.35 }],
  [/obsidian/, { mat: "obsidian-scale cuirass", def: 11, wt: 6.5, drain: 1.4, noise: 1.15 }],
  [/silent|echo|sling/, { mat: "padded echo-cloth", def: 4, wt: 2.0, drain: 1.0, noise: 0.55 }],
  [/poison|dart|skirmish/, { mat: "skirmisher's harness", def: 5, wt: 2.4, drain: 1.05, noise: 0.8 }],
  [/spear|phalanx|corridor/, { mat: "corridor-guard plate", def: 12, wt: 7.5, drain: 1.5, noise: 1.4 }],
  [/warden|gate|armored/, { mat: "warden's banded coat", def: 10, wt: 6.0, drain: 1.3, noise: 1.2 }],
  [/cavalry|ceiling|wall/, { mat: "climber's light mail", def: 6, wt: 3.2, drain: 1.1, noise: 1.0 }],
];

const FALLBACK = { mat: "layered fungus-fiber coat", def: 5, wt: 2.8, drain: 1.05, noise: 0.9 };

export function generateArmor(rng: RNG, civ: Civ, depth: number, index: number): Gear {
  const found = MATERIALS.find(([re]) => re.test(civ.military));
  const base = found ? found[1] : FALLBACK;
  // Condition: older ruins yield worse-preserved gear.
  const age = civ.fellYear ?? 0;
  const condition = rng.range(0.6, 1.0) * (age > 200 ? 0.75 : 1);
  const quality = rng.pick(["battered", "sound", "well-kept", "master-worked"] as const);
  const qMult = { battered: 0.7, sound: 1, "well-kept": 1.15, "master-worked": 1.35 }[quality];

  return boundGear({
    id: `gear:${depth}:${index}`,
    slot: "body",
    name: `${quality} ${base.mat} (${civ.name} make)`,
    origin: `The ${civ.demonym} fought in ${civ.military}. This came off that tradition — ` +
      `${civ.fate === "extant" ? "they still make it this way" : "and outlasted the people who wore it"}.`,
    defense: Math.round(base.def * qMult * condition),
    weight: Math.round(base.wt * 10) / 10,
    drain: base.drain,
    noise: base.noise,
    lightRadius: 1, fuelBurn: 1,
  });
}

export function generateLight(rng: RNG, civ: Civ | null, depth: number, index: number): Gear {
  const kind = rng.weighted([
    ["hooded lantern", 3], ["phosphor globe", 2], ["mirror-backed lamp", 1.5],
  ] as const);
  const spec = {
    "hooded lantern": { r: 1.15, f: 0.85, w: 1.2, note: "shutters down to a slit when you need the dark back" },
    "phosphor globe": { r: 0.85, f: 0.25, w: 0.9, note: "burns dimmer than fire, but barely drinks oil at all" },
    "mirror-backed lamp": { r: 1.55, f: 1.35, w: 1.6, note: "throws light far down a gallery and eats oil doing it" },
  }[kind];
  return boundGear({
    id: `light:${depth}:${index}`,
    slot: "light",
    name: civ ? `${kind} (${civ.name} make)` : kind,
    origin: civ
      ? `Standard issue for the ${civ.demonym}, who traded in ${civ.economy[0]}. It ${spec.note}.`
      : `Nobody's make; scavenged and repaired many times. It ${spec.note}.`,
    defense: 0, weight: spec.w, drain: 1, noise: 1,
    lightRadius: spec.r, fuelBurn: spec.f,
  });
}

export function generateCharm(rng: RNG, civ: Civ, depth: number, index: number): Gear {
  // Charms are religious objects — their effect follows the culture's actual tenet.
  const t = civ.religion.tenet;
  let name: string, def = 0, noise = 1, radius = 1, burn = 1;
  if (/flame|borrowed/.test(t)) { name = `oil-priest's token of ${civ.religion.deity}`; burn = 0.75; }
  else if (/dark|absence|body of the god/.test(t)) { name = `dark-rite charm of ${civ.religion.deity}`; noise = 0.7; }
  else if (/water|reflect/.test(t)) { name = `water-mirror of ${civ.religion.deity}`; def = 2; }
  else if (/dig|pick|liturg/.test(t)) { name = `consecrated pick-head of ${civ.religion.deity}`; def = 3; }
  else if (/dead|deeper/.test(t)) { name = `grave-token of ${civ.religion.deity}`; def = 2; noise = 0.85; }
  else { name = `sealed reliquary of ${civ.religion.deity}`; radius = 1.2; }
  void rng;
  return boundGear({
    id: `charm:${depth}:${index}`,
    slot: "charm",
    name,
    origin: `A ${civ.demonym} religious object. They held that ${t}. ` +
      `Whether it does anything is a question the ${civ.demonym} would find rude.`,
    defense: def, weight: 0.3, drain: 1, noise,
    lightRadius: radius, fuelBurn: burn,
  });
}

/** Model bounds. Generated stats are clamped into these before leaving the factory. */
export const GEAR_BOUNDS = {
  defense: [0, 30],
  weight: [0, 12],
  drain: [0.5, 2.0],
  noise: [0.3, 2.0],
  lightRadius: [0.4, 2.5],
  fuelBurn: [0.1, 2.5],
} as const;

function clamp(v: number, [lo, hi]: readonly [number, number], fallback: number): number {
  if (!Number.isFinite(v)) return fallback;
  return Math.min(hi, Math.max(lo, v));
}

/**
 * Enforce the model bounds and strip any non-finite value. Every generator
 * returns through here, so no NaN, negative armor, or zero speed multiplier can
 * reach the player no matter what a future tradition table produces.
 */
export function boundGear(g: Gear): Gear {
  return {
    ...g,
    defense: Math.round(clamp(g.defense, GEAR_BOUNDS.defense, 0)),
    weight: Math.round(clamp(g.weight, GEAR_BOUNDS.weight, 1) * 10) / 10,
    drain: clamp(g.drain, GEAR_BOUNDS.drain, 1),
    noise: clamp(g.noise, GEAR_BOUNDS.noise, 1),
    lightRadius: clamp(g.lightRadius, GEAR_BOUNDS.lightRadius, 1),
    fuelBurn: clamp(g.fuelBurn, GEAR_BOUNDS.fuelBurn, 1),
  };
}

export class Loadout {
  body: Gear | null = null;
  light: Gear | null = null;
  charm: Gear | null = null;
  /** Everything found but not worn; equipping is a choice, carrying costs weight. */
  stash: Gear[] = [];

  all(): Gear[] {
    return [this.body, this.light, this.charm].filter((g): g is Gear => g !== null);
  }
  get(slot: Slot): Gear | null {
    return slot === "body" ? this.body : slot === "light" ? this.light : this.charm;
  }
  equip(g: Gear): Gear | null {
    const prev = this.get(g.slot);
    if (g.slot === "body") this.body = g;
    else if (g.slot === "light") this.light = g;
    else this.charm = g;
    this.stash = this.stash.filter((x) => x.id !== g.id);
    if (prev) this.stash.push(prev);
    return prev;
  }
  unequip(slot: Slot): void {
    const g = this.get(slot);
    if (!g) return;
    if (slot === "body") this.body = null;
    else if (slot === "light") this.light = null;
    else this.charm = null;
    this.stash.push(g);
  }
  /**
   * Unconditional add — only for save-restore, where the weight was already
   * paid for. Gameplay pickup must go through `tryAdd`.
   */
  add(g: Gear) { this.stash.push(g); }

  /**
   * Pick up gear only if it fits the remaining carry allowance. Without this,
   * unworn gear accumulated forever and drove the player's usable capacity
   * negative, silently making food impossible to pick up.
   */
  tryAdd(g: Gear, remainingAllowance: number): boolean {
    if (g.weight > remainingAllowance) return false;
    this.stash.push(g);
    return true;
  }

  /** Drop a stashed piece to free carry weight. */
  drop(id: string): Gear | null {
    const i = this.stash.findIndex((g) => g.id === id);
    if (i < 0) return null;
    return this.stash.splice(i, 1)[0];
  }

  defense(): number { return this.all().reduce((s, g) => s + g.defense, 0); }
  /** Unrounded — used for capacity arithmetic. */
  exactWeight(): number {
    return [...this.all(), ...this.stash].reduce((s, g) => s + g.weight, 0);
  }
  /** Rounded for display only. */
  weight(): number { return Math.round(this.exactWeight() * 10) / 10; }
  drain(): number { return this.all().reduce((m, g) => m * g.drain, 1); }
  noise(): number { return this.all().reduce((m, g) => m * g.noise, 1); }
  lightRadius(): number { return this.all().reduce((m, g) => m * g.lightRadius, 1); }
  fuelBurn(): number { return this.all().reduce((m, g) => m * g.fuelBurn, 1); }

  serialize(): { worn: Record<string, Gear | null>; stash: Gear[] } {
    return { worn: { body: this.body, light: this.light, charm: this.charm }, stash: this.stash };
  }
  static restore(data: { worn: Record<string, Gear | null>; stash: Gear[] } | undefined): Loadout {
    const l = new Loadout();
    if (!data) return l;
    l.body = data.worn?.body ?? null;
    l.light = data.worn?.light ?? null;
    l.charm = data.worn?.charm ?? null;
    l.stash = data.stash ?? [];
    return l;
  }
}
