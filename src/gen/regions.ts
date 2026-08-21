// Region assembly. A Region is NOT a dungeon layout — it is the answer to
// "why does this place exist?", computed from the macro-history:
//   geology (stratum) → what CAN be here
//   civ territory + economy/religion/military → what was BUILT here and why
//   events at this depth → what RUINED it and what documents survive
//   ecosystem → what LIVES here now
// The 3D builder (world/) only renders this record.

import { rngFor, RNG } from "../core/rng";
import { History, Civ, Stratum, HistoricalEvent, River, LegendCreature, CHAPTER_DEPTHS } from "./history";
import { regionEpithet, placeName, word } from "../core/names";
import { Species, generateEcosystem } from "./creatures";
import { DocSpec, documentsForEvent, cultureDoc } from "./lore";

export type RegionKind =
  | "fortress" | "mine" | "fungal" | "ocean" | "city" | "temple"
  | "crystal" | "volcanic" | "cavern" | "necropolis" | "vertical";

export interface Settlement {
  civId: string;
  name: string;
  population: number;
  mood: string;             // disposition toward surface strangers
  tradeGoods: string[];
}

export interface Region {
  depth: number;
  kind: RegionKind;
  name: string;
  epithet: string;
  stratum: Stratum;
  size: number;             // world units, square
  builderCiv: Civ | null;
  purpose: string;          // why this place was made (or formed)
  inhabitantsDesc: string;  // who/what lives here NOW
  floraName: string;
  floraColor: number;
  species: Species[];
  docs: DocSpec[];
  events: HistoricalEvent[];
  settlement: Settlement | null;
  rivers: River[];
  legends: LegendCreature[];
  mysteries: string[];
  resources: string[];      // harvestable node types
  ambientLight: number;     // 0..1
  fogColor: number;
  groundColor: number;
  ceilingHeight: number;
  ruinDensity: number;      // 0..1 how much architecture stands
  history: History;
}

const KIND_FOG: Record<RegionKind, [number, number]> = {
  fortress: [0x14120e, 0x4a4438],
  mine: [0x0e0c0a, 0x453b2e],
  fungal: [0x0c140e, 0x3a5940],
  ocean: [0x090d12, 0x27384a],
  city: [0x121014, 0x494049],
  temple: [0x120e0c, 0x4e4030],
  crystal: [0x0e1216, 0x3e5468],
  volcanic: [0x160b08, 0x5c2c1a],
  cavern: [0x0d0c0b, 0x3d3a34],
  necropolis: [0x0e0e10, 0x3c3c44],
  vertical: [0x0e1012, 0x3a4248],
};

const FLORA: Record<RegionKind, [string, number][]> = {
  fungal: [["glowcap groves", 0x7fd9a8], ["shelf-fungus towers", 0xc9b47f], ["pale reachers", 0xd8d2c4]],
  ocean: [["black kelp mats", 0x3e6e5a], ["shore-moss", 0x5a7a5a]],
  cavern: [["curtain lichens", 0x8a9a7a], ["drip-moss", 0x6a8a6a]],
  crystal: [["light-feeder lichen", 0x9ac8e8], ["prism moss", 0xb8d8f0]],
  volcanic: [["ash-bloom", 0xc87a5a], ["vent-fern", 0x8a5a4a]],
  mine: [["timber-rot fans", 0xb0a080], ["ore-bloom", 0x80a0b0]],
  city: [["feral rooftop moss", 0x7a9a6a], ["cistern algae", 0x5a8a7a]],
  fortress: [["wall-creep lichen", 0x8a8a6a]],
  temple: [["incense fungus", 0xc8a878]],
  necropolis: [["grave-flower fungus", 0xd8c8e8]],
  vertical: [["ledge grass, pale", 0xa8b890]],
};

const RESOURCES: Record<RegionKind, string[]> = {
  fungal: ["glowcap", "fiber", "spore-bread base"],
  ocean: ["blindfish", "fresh water", "kelp"],
  cavern: ["mushroom", "fresh water", "flint"],
  crystal: ["crystal shard", "light-lichen", "flint"],
  volcanic: ["obsidian", "sulfur", "vent-fern"],
  mine: ["iron scrap", "copper", "old timber"],
  city: ["salvage", "old timber", "cistern water"],
  fortress: ["iron scrap", "arrowheads", "old rations"],
  temple: ["candle wax", "incense", "offerings"],
  necropolis: ["candle wax", "bone", "grave goods"],
  vertical: ["rope", "salvage", "ledge grass"],
};

export function generateRegion(history: History, depth: number): Region {
  const rng = rngFor(history.seed, `region:${depth}`);
  const chapter = history.getChapter(history.chapterOf(depth));
  const stratum = chapter.stratum;
  const civs = history.civsAt(depth);
  const events = history.eventsAt(depth);
  const rivers = history.riversAt(depth);
  const legends = history.legendsAt(depth);

  // Builder: the civ whose home is closest to this depth, if any territory covers it.
  const builder = civs.length
    ? civs.reduce((a, b) => Math.abs(a.homeDepth - depth) <= Math.abs(b.homeDepth - depth) ? a : b)
    : null;

  const kind = chooseKind(rng, stratum, builder, depth, rivers.length > 0);
  const [fog] = [KIND_FOG[kind]];
  const floraPick = rng.pick(FLORA[kind] ?? FLORA.cavern);

  // Purpose — why this specific place was made.
  const purpose = derivePurpose(kind, builder, stratum, rng, depth);

  // Ecosystem, aware of any local extant culture (they'll have named the animals).
  const localPhon = builder && builder.fate === "extant" ? builder.phon : null;
  const species = generateEcosystem(rng.fork("eco"), kind, depth, floraPick[0], localPhon);

  // Settlement: extant civ near home → living town; scattered → holdout camp.
  let settlement: Settlement | null = null;
  if (builder && Math.abs(builder.homeDepth - depth) <= 2) {
    const sr = rng.fork("settlement");
    if (builder.fate === "extant") {
      settlement = {
        civId: builder.id,
        name: placeName(builder.phon, sr),
        population: sr.int(80, 4000),
        mood: sr.pick([
          "wary — strangers from above are a rumor coming true",
          "trading-minded — your surface goods are outlandishly valuable here",
          "reverent — some here believe a climber from above fulfills a prophecy",
          "hostile at the walls, curious in the market",
        ]),
        tradeGoods: builder.economy,
      };
    } else if (builder.fate === "scattered" && sr.chance(0.6)) {
      settlement = {
        civId: builder.id,
        name: "the " + word(builder.phon, sr, 2) + " holdouts",
        population: sr.int(6, 60),
        mood: "haunted — the last families who never left, living in one lit corner of a dead city",
        tradeGoods: [sr.pick(builder.economy)],
      };
    }
  }

  // Documents: 2–3 events get sources, plus daily-life documents of the builder.
  const docs: DocSpec[] = [];
  const civEvents = builder ? history.eventsOfCiv(builder.id) : [];
  const eventPool = [...events];
  for (const e of civEvents) if (!eventPool.find((x) => x.id === e.id)) eventPool.push(e);
  // Natural regions still hold evidence: travelers from the chapter's cultures
  // died or wrote here too, so borrow their events when nothing local happened.
  if (eventPool.length === 0 && chapter.events.length > 0) {
    eventPool.push(...rng.pickN(chapter.events, Math.min(2, chapter.events.length)));
  }
  const chosen = rng.pickN(eventPool, Math.min(eventPool.length, rng.int(2, 3)));
  for (const ev of chosen) docs.push(...documentsForEvent(ev, history, rng.fork("docs:" + ev.id)));
  if (builder) {
    docs.push(cultureDoc(builder, rng.fork("culturedoc"), `cd:${depth}:0`));
    if (rng.chance(0.5)) docs.push(cultureDoc(builder, rng.fork("culturedoc2"), `cd:${depth}:1`));
  }

  const mysteries = deriveMysteries(rng, kind, builder, events, legends, depth, history);

  const deepFrac = Math.min(1, depth / 50);
  const region: Region = {
    depth, kind,
    name: builder ? placeName(builder.phon, rng.fork("name")) : regionEpithet(kind, rng.fork("nm2")),
    epithet: regionEpithet(kind, rng.fork("ep")),
    stratum,
    size: kind === "cavern" || kind === "ocean" ? 420 : 340,
    builderCiv: builder,
    purpose,
    inhabitantsDesc: settlement
      ? `${settlement.population} ${builder!.species} of ${builder!.name} still live here`
      : species.length
        ? `no one — only the ${species[0].name} and what hunts it`
        : "nothing observed yet",
    floraName: floraPick[0],
    floraColor: floraPick[1],
    species, docs, events, settlement, rivers, legends,
    mysteries,
    resources: RESOURCES[kind] ?? RESOURCES.cavern,
    ambientLight: Math.max(0.04, 0.5 - deepFrac * 0.45) * (kind === "crystal" ? 2.2 : kind === "volcanic" ? 1.6 : 1),
    fogColor: fog[0],
    groundColor: fog[1],
    ceilingHeight: kind === "cavern" ? 90 : kind === "vertical" ? 160 : kind === "ocean" ? 70 : 34,
    ruinDensity: builder ? (builder.fate === "extant" ? 0.9 : Math.max(0.15, 0.85 - (builder.fellYear ?? 200) / 900)) : 0,
    history,
  };
  return region;
}

function chooseKind(rng: RNG, s: Stratum, builder: Civ | null, depth: number, hasRiver: boolean): RegionKind {
  if (builder) {
    const home = Math.abs(builder.homeDepth - depth);
    const edge = Math.min(Math.abs(depth - builder.territory[0]), Math.abs(depth - builder.territory[1]));
    const pairs: [RegionKind, number][] = [
      ["city", home === 0 ? 6 : home === 1 ? 2 : 0.3],
      ["vertical", home <= 1 && depth > 8 ? 2.5 : 0.2],
      ["fortress", edge <= 1 ? 4 : 0.8],
      ["mine", builder.economy.some((e) => /copper|silver|iron|obsidian|salt|crystal/.test(e)) ? 3 : 0.6],
      ["temple", 1.6],
      ["necropolis", builder.fate !== "extant" ? 2 : 0.7],
      ["fungal", s.water > 0.5 ? 1.4 : 0.4],
      ["cavern", 0.8],
    ];
    return rng.weighted(pairs);
  }
  const pairs: [RegionKind, number][] = [
    ["ocean", hasRiver && s.water > 0.55 ? 3.5 : s.water > 0.75 ? 2 : 0.1],
    ["fungal", s.water > 0.4 ? 3 : 0.8],
    ["volcanic", s.heat > 0.5 ? 4 : s.heat * 1.5],
    ["crystal", s.rock === "crystalline" ? 5 : s.rock === "obsidian" ? 1.5 : 0.2],
    ["cavern", 2.5],
  ];
  return rng.weighted(pairs);
}

function derivePurpose(kind: RegionKind, builder: Civ | null, s: Stratum, rng: RNG, depth: number): string {
  if (!builder) {
    switch (kind) {
      case "ocean": return `a sunless sea ponded over eons where the aquifer meets impermeable ${s.rock}; ${s.formation}`;
      case "fungal": return `a self-seeded forest: spores riding the downdrafts found standing water and ${s.rock} rich in minerals; ${s.formation}`;
      case "volcanic": return `a live fissure zone; ${s.formation}`;
      case "crystal": return `a geode the size of a valley; ${s.formation}`;
      default: return `a natural void; ${s.formation}`;
    }
  }
  const b = builder;
  switch (kind) {
    case "city": return `${b.name}'s ${Math.abs(b.homeDepth - depth) === 0 ? "capital" : "second city"}, seat of ${b.government}`;
    case "vertical": return `a shaft-city the ${b.demonym} built downward when floor-space ran out — homes hung from chains, ${b.government}`;
    case "fortress": return `a border citadel: the ${b.demonym} fortified this stair against ${neighborName(b) ?? "whatever climbed from below"}, garrisoned by ${b.military}`;
    case "mine": return `the ${rng.pick(b.economy)} workings that paid for everything else the ${b.demonym} built`;
    case "temple": return `a sanctuary of ${b.religion.deity}, built on the doctrine that ${b.religion.tenet}`;
    case "necropolis": return `the burial floor of the ${b.demonym}, who held that ${b.religion.tenet.includes("dead") ? b.religion.tenet : "the dead must rest deeper than the living"}`;
    case "fungal": return `the terrace-farms that fed ${b.name} — ${b.cuisine[0]} began here`;
    default: return `a holding of the ${b.demonym}`;
  }
}

function neighborName(civ: Civ): string | null {
  const war = civ.relations.find((r) => r.kind === "war");
  return war ? "their rivals below" : null;
}

function deriveMysteries(
  rng: RNG, kind: RegionKind, builder: Civ | null,
  events: HistoricalEvent[], legends: LegendCreature[], depth: number, history: History,
): string[] {
  const out: string[] = [];
  const sealing = events.find((e) => e.type === "sealing");
  if (sealing) out.push(`a poured-stone seal that postdates everything else here — the records say only that speaking of what lies beyond was forbidden`);
  const disc = events.find((e) => e.type === "discovery");
  if (disc) out.push(`miners once broke into "a hollow no map recorded" near here; the find was suppressed`);
  if (legends.length) out.push(`kill-sites with no scavengers touching the carcasses — something large passed through, moving UP`);
  if (builder && builder.parentCivId) {
    const parent = history.civById(builder.parentCivId);
    if (parent) out.push(`the oldest architecture here matches ${parent.name} work from shallower floors — these people came from above and stopped saying so`);
  }
  if (rng.chance(0.4)) out.push(`a stair, older than every culture in the records, that all of them independently chose not to use`);
  if (out.length === 0) out.push(`the age of the lowest walls does not match any culture known to have lived at this depth`);
  return out;
}
