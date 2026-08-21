// Species generation. Each region generates a small FOOD WEB, not a spawn table:
// grazers eat the region's flora, predators eat specific named grazers, scavengers
// follow the predators. Anatomy follows depth (eyes are lost, other senses grow).
// The player's codex reveals these fields only through observation (see ai/observe).

import { RNG } from "../core/rng";
import { Phonology, makePhonology, word } from "../core/names";

export type Diet = "grazer" | "predator" | "scavenger" | "ambush" | "filter";
export type Locomotion = "walker" | "skitterer" | "ceiling" | "swimmer" | "floater";

export interface BodyPlan {
  size: number;            // shoulder height in meters, 0.2 .. 4.5
  elongation: number;      // 1 = round, 3 = very long
  legs: 0 | 2 | 4 | 6 | 8;
  eyes: number;            // deep species trend to 0
  glow: boolean;           // bioluminescence
  glowColor: number;
  armor: number;           // 0..1 plating
  color: number;
  locomotion: Locomotion;
}

export interface Species {
  id: string;
  name: string;            // explorer's field name until identified via locals/codex
  localName: string | null;// what a local culture calls it, if any culture knows it
  plan: BodyPlan;
  diet: Diet;
  habitat: string;
  foodDesc: string;        // what it actually eats (names real region flora / species)
  preyIds: string[];       // ids of species in the same region it hunts
  predatorIds: string[];
  behavior: string;
  reproduction: string;
  weakness: string;        // mechanically real (see combat): light, sound, flanks...
  weaknessKind: "light" | "sound" | "flanks" | "fire" | "none";
  hp: number;
  damage: number;
  speed: number;
  aggro: number;           // 0 passive .. 1 attacks on sight
  fleesLight: boolean;
}

const HABITATS: Record<string, string[]> = {
  fungal: ["the shaded understory of the glowcap groves", "hollow logs of giant fungus stems", "the spore-drifts near the ceiling"],
  ocean: ["the black shallows along the shore", "floating mats of pale kelp", "the deep water beyond lamplight"],
  cavern: ["scree slopes beneath the old rockfalls", "the warm cracks where air rises", "the dripping ceiling domes"],
  crystal: ["the resonant crystal thickets", "burrows in the soft gypsum floor", "the light-wells where crystals focus glow"],
  volcanic: ["the cool margins of the lava channels", "ash-beds that hold the day's heat", "steam vents and their mineral gardens"],
  mine: ["flooded lower galleries", "the timbered drift tunnels", "old ore chutes and their tailing cones"],
  city: ["collapsed cellars and cisterns", "the aqueduct channels", "rooftop gardens gone feral"],
  fortress: ["the arrow-slit galleries", "the flooded moat cut", "granaries and their spilled stores"],
  temple: ["the incense-blackened rafters", "reflecting pools", "the crypt levels below the altar"],
  necropolis: ["the ossuary shelves", "flower-fungus planted on old graves", "the processional avenues"],
  vertical: ["the wind-swept ledges of the shaft", "abandoned hanging houses", "the chain-ways between platforms"],
};

const WEAKNESSES: [Species["weaknessKind"], string, number][] = [
  ["light", "its skin blisters in strong light; a raised torch drives it back", 3],
  ["sound", "it hunts by echo; a thrown stone or a shout confuses its strikes", 2],
  ["flanks", "its plating is dorsal only; the flanks and belly are soft", 2.5],
  ["fire", "its spore-laden hide is dry and catches fire easily", 1.5],
  ["none", "no obvious weakness has been observed", 1],
];

function sizeClass(s: number): string {
  return s < 0.5 ? "small" : s < 1.2 ? "dog-sized" : s < 2.2 ? "cattle-sized" : "monstrous";
}

const PART_A = ["pale", "veined", "whistling", "mirror", "shag", "lantern", "dredge", "sulfur", "thread", "bell", "hollow", "grave", "silk", "chalk"];
const PART_B = ["stalker", "grazer", "creeper", "maw", "hound", "moth", "eel", "crab", "strider", "wolf", "leech", "swarmer", "titan", "shrike"];

export function generateEcosystem(
  rng: RNG,
  regionKind: string,
  depth: number,
  floraName: string,
  localPhon: Phonology | null,
): Species[] {
  const n = rng.int(3, 5);
  const list: Species[] = [];
  const habitats = HABITATS[regionKind] ?? HABITATS.cavern;
  const namePhon = makePhonology(rng.fork("fieldnames"));
  void namePhon;

  // Roll body plans first, largest tends to be the predator.
  const roles: Diet[] = ["grazer", "grazer", "predator", rng.pick(["scavenger", "ambush", "filter"] as const), "predator"];
  for (let i = 0; i < n; i++) {
    const cr = rng.fork(`species:${i}`);
    const diet = roles[i] ?? cr.pick(["grazer", "scavenger"] as const);
    const deepFactor = Math.min(1, depth / 45);

    const locomotion: Locomotion =
      regionKind === "ocean" && cr.chance(0.6) ? "swimmer"
      : cr.weighted([["walker", 4], ["skitterer", 3], ["ceiling", 1.5], ["floater", 0.7]] as const);

    const plan: BodyPlan = {
      size: diet === "predator" ? cr.range(0.9, 2.6 + deepFactor * 2) : cr.range(0.25, 1.4),
      elongation: cr.range(1, 3),
      legs: cr.weighted([[0, locomotion === "swimmer" || locomotion === "floater" ? 4 : 0.4], [2, 1], [4, 3], [6, 2.5], [8, 1.5]] as const) as BodyPlan["legs"],
      eyes: cr.chance(deepFactor * 0.8) ? 0 : cr.weighted([[2, 3], [4, 1], [6, 0.5], [0, 1]] as const),
      glow: cr.chance(0.25 + deepFactor * 0.35),
      glowColor: cr.pick([0x66ffcc, 0x66aaff, 0xff8866, 0xccff66, 0xff66aa]),
      armor: cr.chance(0.4) ? cr.range(0.3, 0.9) : cr.range(0, 0.2),
      color: cr.pick([0xb8b0a0, 0x8a9a8a, 0x9a8a9a, 0x6a6a72, 0xc8c0b8, 0x7a8a6a, 0x5a4a42]),
      locomotion,
    };

    const [wk, wdesc] = ((): [Species["weaknessKind"], string] => {
      const pick = cr.weighted(WEAKNESSES.map(([k, d, w]) => [[k, d] as [Species["weaknessKind"], string], w] as const));
      return pick;
    })();

    const name = `${cr.pick(PART_A)} ${cr.pick(PART_B)}`;
    const localName = localPhon && cr.chance(0.6) ? word(localPhon, cr, 2) : null;

    const behaviorByDiet: Record<Diet, string[]> = {
      grazer: [
        `moves in loose herds of ${cr.int(3, 12)}, drumming its feet when alarmed so the herd scatters as one`,
        `feeds in total stillness and freezes when light touches it, trusting its mottled hide`,
      ],
      predator: [
        `patrols a fixed circuit and marks it with scent posts; it will pursue far beyond its territory once blood is drawn`,
        `hunts by ${plan.eyes === 0 ? "echo and air-pressure" : "sight"}, stalking low before a short explosive charge`,
      ],
      scavenger: [
        `follows larger predators at a distance and calls others with a rattling cry when it finds a carcass`,
        `tests dead things with a long feeler before committing; it will flee from anything that moves twice`,
      ],
      ambush: [
        `buries itself leaving only sensory bristles exposed, and can wait ${cr.int(4, 30)} days between meals`,
        `hangs from the ceiling in the shape of a stalactite and drops on prey passing beneath`,
      ],
      filter: [
        `drifts on cave drafts trailing sticky threads, reeling in whatever the air brings`,
        `sits in flowing water with its fans open; it is harmless unless grasped`,
      ],
    };

    const s: Species = {
      id: `sp:${depth}:${i}`,
      name, localName, plan, diet,
      habitat: cr.pick(habitats),
      foodDesc: "", // filled after web assembly
      preyIds: [], predatorIds: [],
      behavior: cr.pick(behaviorByDiet[diet]),
      reproduction: cr.pick([
        `lays ${cr.int(6, 80)} leathery eggs in warm cracks and abandons them`,
        `carries live young on its back until they can ${locomotion === "swimmer" ? "swim" : "climb"}`,
        `broods a single offspring for ${cr.int(1, 4)} cycles; kills to defend it`,
        `buds asexually after heavy feeding; large individuals are actually colonies`,
      ]),
      weakness: wdesc, weaknessKind: wk,
      hp: Math.round(20 + plan.size * 45 + plan.armor * 60),
      damage: diet === "predator" || diet === "ambush" ? Math.round(8 + plan.size * 9) : Math.round(2 + plan.size * 3),
      speed: diet === "predator" ? cr.range(3.4, 5.2) : cr.range(1.2, 3.2),
      aggro: diet === "predator" ? cr.range(0.55, 0.95) : diet === "ambush" ? 1 : cr.range(0, 0.15),
      fleesLight: wk === "light",
    };
    list.push(s);
  }

  // Assemble the web: predators eat the grazers, scavengers reference predators.
  const grazers = list.filter((s) => s.diet === "grazer" || s.diet === "filter");
  const predators = list.filter((s) => s.diet === "predator" || s.diet === "ambush");
  for (const g of grazers) g.foodDesc = `feeds on ${floraName}`;
  for (const p of predators) {
    const prey = grazers.length ? grazers : list.filter((s) => s !== p);
    const target = prey[Math.floor(rng.next() * prey.length)];
    if (target) {
      p.preyIds.push(target.id);
      target.predatorIds.push(p.id);
      p.foodDesc = `hunts the ${target.name}`;
    } else p.foodDesc = "eats anything that bleeds";
  }
  for (const s of list.filter((x) => x.diet === "scavenger")) {
    const p = predators[0];
    s.foodDesc = p ? `scavenges the kills of the ${p.name}` : `strips carrion and old bones`;
    if (p) s.predatorIds.push(p.id);
  }
  return list;
}

export function speciesFieldSummary(s: Species): string {
  return `${sizeClass(s.plan.size)}, ${s.plan.legs === 0 ? "limbless" : s.plan.legs + "-legged"}, ${
    s.plan.eyes === 0 ? "eyeless" : s.plan.eyes + " eyes"}${s.plan.glow ? ", bioluminescent" : ""}`;
}
