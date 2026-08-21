// The expedition pack. Weight-limited: going deep means choosing what to carry.
// Crafting turns the world's actual resources into supplies — arrows from flint
// and bone, torch oil from phosphor and glowcaps, splints from old timber.

export type ItemType = "food" | "water" | "light" | "medicine" | "material" | "ammo" | "tool" | "artifact";

export interface ItemDef {
  type: ItemType;
  weight: number;
  desc: string;
  use?: { hp?: number; hunger?: number; thirst?: number; fuel?: number; cureInjury?: boolean; mana?: number };
}

export const ITEMS: Record<string, ItemDef> = {
  "rations": { type: "food", weight: 0.5, desc: "surface hardtack and dried meat", use: { hunger: 35 } },
  "old rations": { type: "food", weight: 0.5, desc: "someone else's expedition food; still edible", use: { hunger: 22, hp: -2 } },
  "spore-bread": { type: "food", weight: 0.4, desc: "the staple of the deep cultures; dense, faintly luminous", use: { hunger: 45 } },
  "blindfish": { type: "food", weight: 0.4, desc: "eyeless, sweet-fleshed; best stewed", use: { hunger: 30, hp: 4 } },
  "mushroom": { type: "material", weight: 0.2, desc: "an edible-looking cap; safer cooked into spore-bread" },
  "glowcap": { type: "material", weight: 0.2, desc: "bioluminescent fungus; food, or oil, or trade" },
  "waterskin": { type: "water", weight: 1.0, desc: "a full skin of clean water", use: { thirst: 50 } },
  "cistern water": { type: "water", weight: 1.0, desc: "old but filtered through a dead city's stone", use: { thirst: 40 } },
  "fresh water": { type: "water", weight: 1.0, desc: "cold water from a living aquifer", use: { thirst: 55 } },
  "torch oil": { type: "light", weight: 0.6, desc: "an hour of light, roughly. Light is life down here", use: { fuel: 45 } },
  "phosphor vial": { type: "light", weight: 0.2, desc: "glow that never burns out, but never brightens either", use: { fuel: 15 } },
  "bandage": { type: "medicine", weight: 0.2, desc: "boiled fungus-fiber wrap", use: { hp: 30 } },
  "splint": { type: "medicine", weight: 0.6, desc: "sets a wrenched limb well enough to walk", use: { cureInjury: true } },
  "aether draught": { type: "medicine", weight: 0.3, desc: "tastes like a struck bell sounds", use: { mana: 30 } },
  "arrow": { type: "ammo", weight: 0.07, desc: "flint-tipped, bone-hafted" },
  "flint": { type: "material", weight: 0.3, desc: "knappable stone" },
  "bone": { type: "material", weight: 0.3, desc: "clean and dry; the Abyss is generous with these" },
  "fiber": { type: "material", weight: 0.15, desc: "woven fungus thread" },
  "old timber": { type: "material", weight: 0.8, desc: "mine bracing, still sound" },
  "iron scrap": { type: "material", weight: 0.9, desc: "rust outside, good metal inside" },
  "copper": { type: "material", weight: 0.8, desc: "green-crusted ingot stock" },
  "obsidian": { type: "material", weight: 0.5, desc: "volcanic glass; edges beyond razors" },
  "crystal shard": { type: "material", weight: 0.4, desc: "hums almost below hearing" },
  "sulfur": { type: "material", weight: 0.3, desc: "yellow crusts from the vents" },
  "kelp": { type: "material", weight: 0.2, desc: "black ribbon-weed from the sunless sea" },
  "meat": { type: "material", weight: 0.6, desc: "flesh of something you had to learn about first; cook at camp" },
  "camp kit": { type: "tool", weight: 3.0, desc: "bedroll, firestones, small pot. Lets you make camp anywhere" },
  "rope": { type: "tool", weight: 1.2, desc: "thirty feet of braided fiber" },
  "salvage": { type: "material", weight: 0.5, desc: "buckles, hinges, lamp-fittings of a dead city" },
  "candle wax": { type: "material", weight: 0.3, desc: "temple stock, centuries old, perfectly good" },
  "incense": { type: "artifact", weight: 0.1, desc: "still fragrant; the god it was for is not answering" },
  "grave goods": { type: "artifact", weight: 0.4, desc: "what someone thought the dead would need" },
  "offerings": { type: "artifact", weight: 0.3, desc: "small bowls, small hopes" },
  "arrowheads": { type: "material", weight: 0.2, desc: "military stock from a fallen armory" },
  "ledge grass": { type: "material", weight: 0.1, desc: "pale tufts that grow where wind moves in the shaft" },
  "spore-bread base": { type: "material", weight: 0.3, desc: "ground fungus flour" },
  "vent-fern": { type: "material", weight: 0.2, desc: "grows only at the warm margins" },
  "light-lichen": { type: "material", weight: 0.1, desc: "scrapes off crystal in glowing sheets" },
};

export interface Recipe {
  out: string; qty: number;
  needs: [string, number][];
  where: "anywhere" | "camp";
}

export const RECIPES: Recipe[] = [
  { out: "arrow", qty: 4, needs: [["flint", 1], ["bone", 1], ["fiber", 1]], where: "anywhere" },
  { out: "arrow", qty: 6, needs: [["arrowheads", 1], ["bone", 1], ["fiber", 1]], where: "anywhere" },
  { out: "bandage", qty: 2, needs: [["fiber", 2]], where: "anywhere" },
  { out: "splint", qty: 1, needs: [["old timber", 1], ["fiber", 2]], where: "anywhere" },
  { out: "torch oil", qty: 2, needs: [["glowcap", 2], ["candle wax", 1]], where: "camp" },
  { out: "torch oil", qty: 1, needs: [["glowcap", 3]], where: "camp" },
  { out: "spore-bread", qty: 2, needs: [["spore-bread base", 1], ["mushroom", 1]], where: "camp" },
  { out: "spore-bread", qty: 1, needs: [["mushroom", 2]], where: "camp" },
  { out: "blindfish", qty: 1, needs: [["meat", 1]], where: "camp" },
  { out: "waterskin", qty: 1, needs: [["fresh water", 1]], where: "anywhere" },
  { out: "aether draught", qty: 1, needs: [["crystal shard", 1], ["fresh water", 1]], where: "camp" },
  { out: "rope", qty: 1, needs: [["fiber", 4], ["kelp", 2]], where: "camp" },
];

export const MAX_WEIGHT = 38;

export class Inventory {
  items: Record<string, number> = {};

  /** `capacity` lets porters and worn-gear weight adjust the real limit. */
  add(name: string, qty = 1, capacity = MAX_WEIGHT): boolean {
    const def = ITEMS[name] ?? { weight: 0.4 };
    if (this.weight() + def.weight * qty > capacity) return false;
    this.items[name] = (this.items[name] ?? 0) + qty;
    return true;
  }
  remove(name: string, qty = 1): boolean {
    if ((this.items[name] ?? 0) < qty) return false;
    this.items[name] -= qty;
    if (this.items[name] <= 0) delete this.items[name];
    return true;
  }
  count(name: string): number { return this.items[name] ?? 0; }
  weight(): number {
    let w = 0;
    for (const [n, q] of Object.entries(this.items)) w += (ITEMS[n]?.weight ?? 0.4) * q;
    return Math.round(w * 10) / 10;
  }
  canCraft(r: Recipe): boolean {
    return r.needs.every(([n, q]) => this.count(n) >= q);
  }
  craft(r: Recipe): boolean {
    if (!this.canCraft(r)) return false;
    for (const [n, q] of r.needs) this.remove(n, q);
    this.items[r.out] = (this.items[r.out] ?? 0) + r.qty; // crafting output ignores weight cap by a hair
    return true;
  }
}

export function startingPack(): Inventory {
  const inv = new Inventory();
  inv.add("rations", 4);
  inv.add("waterskin", 3);
  inv.add("torch oil", 4);
  inv.add("bandage", 2);
  inv.add("arrow", 10);
  inv.add("camp kit", 1);
  inv.add("rope", 1);
  return inv;
}

/** Surface resupply: what the camp above the pit will give per expedition. */
export function surfaceResupply(inv: Inventory): string[] {
  const gave: string[] = [];
  const grant = (n: string, target: number) => {
    const need = target - inv.count(n);
    if (need > 0) { inv.add(n, need); gave.push(`${n} ×${need}`); }
  };
  grant("rations", 4);
  grant("waterskin", 3);
  grant("torch oil", 4);
  grant("bandage", 2);
  grant("arrow", 10);
  grant("camp kit", 1);
  return gave;
}
