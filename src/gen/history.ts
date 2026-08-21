// The macro-history simulation. This runs BEFORE any geometry exists.
// The world is generated in "chapters" of CHAPTER_DEPTHS floors. Each chapter rolls
// geology, civilizations (possibly descended from shallower ones), rivers that
// continue downward across chapters, wars/floods/collapses with dates and named
// actors, and legendary creatures with migration paths. Regions, ruins, journals
// and murals are all *derived* from this record — nothing in the world cites an
// event that this file did not generate.

import { RNG, rngFor } from "../core/rng";
import {
  Phonology, makePhonology, driftPhonology, word, personName, placeName,
} from "../core/names";

export const CHAPTER_DEPTHS = 10;

// ---------------------------------------------------------------- geology ----

export type RockType = "limestone" | "granite" | "basalt" | "sandstone" | "obsidian" | "crystalline";

export interface Stratum {
  chapter: number;
  rock: RockType;
  ageMyr: number;          // geological age, grows with depth
  heat: number;            // 0..1, volcanic tendency
  water: number;           // 0..1, aquifer richness
  formation: string;       // one-line geological story
}

// ------------------------------------------------------------ civilizations ----

export type CivSpecies = "descended humans" | "deep-born humans" | "the Pale Folk" | "stone-singers" | "the Unblinking" | "mycelial communes";
export type SurfaceBelief = "myth" | "heresy" | "known-lost" | "known-seeking" | "indifferent";
export type CivFate = "extant" | "fallen" | "scattered" | "transformed";

export interface ArchStyle {
  arch: "round" | "pointed" | "corbel" | "trapezoid";
  column: "plain" | "fluted" | "figure" | "spiral";
  palette: number;         // base color hex
  trim: number;
  motif: "spiral" | "eye" | "stair" | "wave" | "root" | "flame";
}

export interface Civ {
  id: string;
  name: string;
  demonym: string;
  phon: Phonology;
  species: CivSpecies;
  homeDepth: number;
  territory: [number, number];   // depth span of influence (ruins appear across it)
  foundedYear: number;           // years before present
  fate: CivFate;
  fellYear: number | null;
  fallCauseEventId: string | null;
  parentCivId: string | null;    // cultural descent — architecture will visibly relate
  religion: { deity: string; tenet: string; rite: string };
  government: string;
  economy: string[];             // what they traded / extracted
  cuisine: string[];
  clothing: string;
  military: string;
  myth: string;
  surfaceBelief: SurfaceBelief;
  arch: ArchStyle;
  rulers: string[];              // dynasty, oldest first; last is final/current ruler
  relations: { civId: string; kind: "war" | "trade" | "vassal" | "schism" | "unknown-to-each-other" }[];
}

// ---------------------------------------------------------------- events ----

export type EventType =
  | "founding" | "war" | "plague" | "flood" | "collapse" | "regicide"
  | "discovery" | "sealing" | "migration" | "heresy" | "quake" | "famine" | "burning";

export interface HistoricalEvent {
  id: string;
  year: number;            // years before present
  type: EventType;
  depth: number;           // where it happened
  civId: string | null;
  otherCivId: string | null;
  person: string | null;   // named actor (ruler, prophet, general)
  place: string | null;    // named place involved
  detail: string;          // canonical one-line record — the TRUTH the sim recorded
  deaths: number;          // canonical casualty figure (sources will distort it)
  causedById: string | null;
}

// ---------------------------------------------------------------- rivers ----

export interface River {
  id: string;
  name: string;
  namedByCivId: string | null;
  spawnDepth: number;
  depths: number[];        // every floor it flows through / reappears on
}

export interface LegendCreature {
  id: string;
  name: string;
  title: string;
  homeDepth: number;
  migration: number[];     // depths it has passed through, shallowest last (it climbs)
  description: string;
}

export interface Chapter {
  index: number;
  stratum: Stratum;
  civs: Civ[];
  events: HistoricalEvent[];
  rivers: River[];
  legends: LegendCreature[];
}

// ================================================================ History ====

const GOVERNMENTS = [
  "a priest-monarchy where the ruler is also chief astronomer of the dark",
  "a council of the twelve oldest families",
  "an elective kingship chosen by ordeal in the deep water",
  "a guild-republic run by the miners' and growers' guilds",
  "a theocracy of blind oracles",
  "a military dictatorship descended from a garrison that was never relieved",
  "a loose federation of cistern-towns",
];
const ECONOMIES = [
  "glowcap fungus", "cave-fish", "copper", "silver", "salt", "obsidian blades",
  "tamed beetles of burden", "phosphor oil", "bone tools", "woven fungus-fiber cloth",
  "fresh water rights", "iron", "amber-resin", "crystal lenses", "dried moth-meal",
];
const CUISINES = [
  "blindfish stewed in phosphor oil", "pressed sporecake", "salt-cured moth larvae",
  "black bread of ground fungus flour", "beetle-milk cheese", "boiled cave-kelp",
  "smoked eel from the dark rivers", "candied stalactite honey", "fermented root-brew",
];
const CLOTHING = [
  "layered fungus-fiber robes dyed with mineral salts",
  "beetle-shell lamellar over woven kelp",
  "pale leather from blind cattle, worn with copper rings",
  "hooded oilcloth against the ceiling-rain",
  "bone-beaded shawls that clatter so kin can hear kin in the dark",
];
const MILITARY = [
  "phalanxes of long spears suited to corridor war",
  "silent slingers trained to fight by echo",
  "beetle-cavalry that charge along walls and ceilings",
  "wardens of the gates, few but armored in obsidian",
  "poison-dart skirmishers who blind lanterns first",
];
const TENETS = [
  "the dark is not absence but the body of the god",
  "every flame is a borrowed thing and must be repaid",
  "the dead must be carried one floor deeper than they lived",
  "water remembers every face it has reflected",
  "to dig is to pray; the pick is a liturgical instrument",
  "the surface is the afterlife, and the living are the dead of a higher world",
];
const RITES = [
  "extinguish every lamp for one silent hour each cycle",
  "carve the names of the dead into the ceiling, never the floor",
  "release a blind white moth at every birth",
  "share salt with strangers before speaking",
  "descend one floor alone at coming-of-age and return with a stone",
];
const MYTHS = [
  "that the first ancestors fell through a crack in a battlefield and the war above never ended",
  "that the Abyss is the throat of a sleeping animal and the wind is its breath",
  "that a city of light exists at the very bottom, brighter than the surface ever was",
  "that the stairs between floors were carved in a single night by something that was paid in years",
  "that anyone who counts every floor aloud will find one more than last time",
];

const SPECIES_BY_DEPTH: [CivSpecies, number, number][] = [
  ["descended humans", 0, 18],
  ["deep-born humans", 4, 40],
  ["the Pale Folk", 10, 60],
  ["stone-singers", 18, 999],
  ["the Unblinking", 26, 999],
  ["mycelial communes", 30, 999],
];

const MOTIFS = ["spiral", "eye", "stair", "wave", "root", "flame"] as const;
const PALETTES = [0x8a7a5c, 0x6e6e78, 0x7c5b4a, 0x5c6e5a, 0x8a8a6e, 0x5a5a6e, 0x746052];

export class History {
  private chapters = new Map<number, Chapter>();
  constructor(public readonly seed: string) {}

  chapterOf(depth: number): number {
    return Math.floor((depth - 1) / CHAPTER_DEPTHS);
  }

  getChapter(index: number): Chapter {
    const cached = this.chapters.get(index);
    if (cached) return cached;
    // Chapters build on their predecessors (descent, wars, rivers), so materialize
    // shallower ones first. Depth-first play order makes this cheap in practice.
    if (index > 0) this.getChapter(index - 1);
    const ch = this.generateChapter(index);
    this.chapters.set(index, ch);
    return ch;
  }

  eventById(id: string): HistoricalEvent | null {
    for (const ch of this.chapters.values())
      for (const e of ch.events) if (e.id === id) return e;
    return null;
  }

  civById(id: string): Civ | null {
    for (const ch of this.chapters.values())
      for (const c of ch.civs) if (c.id === id) return c;
    return null;
  }

  /** All civs whose territory covers a depth (their ruins/architecture appear there). */
  civsAt(depth: number): Civ[] {
    const out: Civ[] = [];
    const maxCh = this.chapterOf(depth) + 1;
    for (let i = 0; i <= maxCh; i++) {
      for (const c of this.getChapter(i).civs) {
        if (depth >= c.territory[0] && depth <= c.territory[1]) out.push(c);
      }
    }
    return out;
  }

  eventsAt(depth: number): HistoricalEvent[] {
    const out: HistoricalEvent[] = [];
    const maxCh = this.chapterOf(depth) + 1;
    for (let i = 0; i <= maxCh; i++) {
      for (const e of this.getChapter(i).events) if (e.depth === depth) out.push(e);
    }
    return out.sort((a, b) => b.year - a.year);
  }

  eventsOfCiv(civId: string): HistoricalEvent[] {
    const out: HistoricalEvent[] = [];
    for (const ch of this.chapters.values())
      for (const e of ch.events)
        if (e.civId === civId || e.otherCivId === civId) out.push(e);
    return out.sort((a, b) => b.year - a.year);
  }

  riversAt(depth: number): River[] {
    const out: River[] = [];
    const maxCh = this.chapterOf(depth);
    for (let i = 0; i <= maxCh; i++) {
      for (const r of this.getChapter(i).rivers) if (r.depths.includes(depth)) out.push(r);
    }
    return out;
  }

  legendsAt(depth: number): LegendCreature[] {
    const out: LegendCreature[] = [];
    const maxCh = this.chapterOf(depth) + 2;
    for (let i = 0; i <= maxCh; i++) {
      for (const l of this.getChapter(i).legends) if (l.migration.includes(depth)) out.push(l);
    }
    return out;
  }

  // ------------------------------------------------------------ generation ----

  private generateChapter(index: number): Chapter {
    const rng = rngFor(this.seed, `chapter:${index}`);
    const baseDepth = index * CHAPTER_DEPTHS + 1;

    const stratum = this.generateStratum(index, rng.fork("geo"));
    const civs = this.generateCivs(index, stratum, rng.fork("civs"));
    const rivers = this.generateRivers(index, stratum, civs, rng.fork("rivers"));
    const events = this.generateEvents(index, stratum, civs, rivers, rng.fork("events"));
    const legends = this.generateLegends(index, civs, rng.fork("legends"));

    // Fates decided by events: a civ with a collapse/war-loss terminal event is fallen.
    for (const civ of civs) {
      const terminal = events.find((e) => e.id === civ.fallCauseEventId);
      if (terminal && civ.fate !== "extant") civ.fellYear = terminal.year;
    }
    void baseDepth;
    return { index, stratum, civs, events, rivers, legends };
  }

  private generateStratum(index: number, rng: RNG): Stratum {
    const rocks: [RockType, number][] = [
      ["limestone", index < 3 ? 4 : 1],
      ["sandstone", index < 2 ? 3 : 1],
      ["granite", 2],
      ["basalt", 1 + index * 0.4],
      ["obsidian", index > 2 ? 1.5 : 0.1],
      ["crystalline", index > 1 ? 1.2 : 0.05],
    ];
    const rock = rng.weighted(rocks);
    const heat = Math.min(1, rng.range(0, 0.25) + index * 0.06 * rng.range(0.4, 1.4));
    const water = rock === "limestone" || rock === "sandstone" ? rng.range(0.4, 0.95) : rng.range(0.05, 0.6);
    const ageMyr = Math.round(30 + index * rng.range(35, 80));
    const formations: Record<RockType, string> = {
      limestone: `laid down ${ageMyr} million years ago as the bed of a vanished sea; water has been hollowing it ever since`,
      sandstone: `compacted dunes of a desert ${ageMyr} million years dead, cross-bedded and soft enough to carve`,
      granite: `a pluton ${ageMyr} million years old, cooled slowly in the dark, split by joints wide enough to walk`,
      basalt: `flood-lava ${ageMyr} million years old, cooled into columns and hollow lava tubes`,
      obsidian: `a glass seam quenched ${ageMyr} million years ago where lava met a buried sea`,
      crystalline: `a metamorphic vault ${ageMyr} million years old where pressure grew crystals instead of crushing them`,
    };
    return { chapter: index, rock, ageMyr, heat, water, formation: formations[rock] };
  }

  private generateCivs(index: number, stratum: Stratum, rng: RNG): Civ[] {
    const count = rng.weighted([[1, 3], [2, 4], [3, index > 1 ? 1.5 : 0.3]] as const);
    const civs: Civ[] = [];
    const prev = index > 0 ? this.chapters.get(index - 1) : undefined;

    for (let i = 0; i < count; i++) {
      const cr = rng.fork(`civ:${i}`);
      // Cultural descent: a chance this civ split off from a shallower one.
      let parent: Civ | null = null;
      if (prev && prev.civs.length > 0 && cr.chance(0.55)) parent = cr.pick(prev.civs);
      const phon = parent ? driftPhonology(parent.phon, cr) : makePhonology(cr);
      const name = word(phon, cr, 2);
      const homeDepth = index * CHAPTER_DEPTHS + cr.int(1, CHAPTER_DEPTHS);
      const reach = cr.int(2, 8);
      const foundedYear = Math.round(cr.range(180, 450) * (index + 1) + cr.range(0, 300));
      const depthOk = SPECIES_BY_DEPTH.filter(([, lo, hi]) => homeDepth >= lo && homeDepth <= hi);
      const species = cr.pick(depthOk.length ? depthOk : SPECIES_BY_DEPTH)[0];

      const fate: CivFate = cr.weighted([
        ["fallen", 4], ["extant", index < 5 ? 2.2 : 1.2], ["scattered", 1.5], ["transformed", 0.7],
      ] as const);

      const surfaceBelief: SurfaceBelief =
        index === 0 ? (cr.chance(0.7) ? "known-lost" : "known-seeking")
        : index < 3 ? cr.weighted([["known-lost", 2], ["myth", 2], ["known-seeking", 1.5], ["heresy", 0.5]] as const)
        : cr.weighted([["myth", 4], ["heresy", 2], ["indifferent", 1.5], ["known-seeking", 0.4]] as const);

      const arch: ArchStyle = parent
        ? { ...parent.arch, palette: cr.pick(PALETTES), motif: cr.chance(0.6) ? parent.arch.motif : cr.pick(MOTIFS) }
        : {
            arch: cr.pick(["round", "pointed", "corbel", "trapezoid"] as const),
            column: cr.pick(["plain", "fluted", "figure", "spiral"] as const),
            palette: cr.pick(PALETTES),
            trim: cr.pick(PALETTES),
            motif: cr.pick(MOTIFS),
          };

      const rulerCount = cr.int(3, 6);
      const rulers = Array.from({ length: rulerCount }, () => personName(phon, cr));

      const civ: Civ = {
        id: `civ:${index}:${i}`,
        name,
        demonym: name + (name.endsWith("n") || name.endsWith("r") ? "i" : "ai"),
        phon, species, homeDepth,
        territory: [Math.max(1, homeDepth - Math.floor(reach / 2)), homeDepth + reach],
        foundedYear, fate,
        fellYear: null, fallCauseEventId: null,
        parentCivId: parent ? parent.id : null,
        religion: { deity: word(phon, cr, 2), tenet: cr.pick(TENETS), rite: cr.pick(RITES) },
        government: cr.pick(GOVERNMENTS),
        economy: cr.pickN(ECONOMIES, cr.int(2, 4)),
        cuisine: cr.pickN(CUISINES, cr.int(2, 3)),
        clothing: cr.pick(CLOTHING),
        military: cr.pick(MILITARY),
        myth: cr.pick(MYTHS),
        surfaceBelief, arch, rulers,
        relations: [],
      };
      if (parent) {
        civ.relations.push({ civId: parent.id, kind: cr.chance(0.5) ? "schism" : "trade" });
        parent.relations.push({ civId: civ.id, kind: "schism" });
      }
      civs.push(civ);
    }

    // Same-chapter relations.
    for (let i = 0; i < civs.length; i++) {
      for (let j = i + 1; j < civs.length; j++) {
        const kind = rng.weighted([
          ["war", 3], ["trade", 3], ["vassal", 1], ["unknown-to-each-other", 1],
        ] as const);
        civs[i].relations.push({ civId: civs[j].id, kind });
        civs[j].relations.push({ civId: civs[i].id, kind });
      }
    }
    return civs;
  }

  private generateRivers(index: number, stratum: Stratum, civs: Civ[], rng: RNG): River[] {
    const rivers: River[] = [];
    const n = stratum.water > 0.5 ? rng.int(1, 2) : rng.chance(stratum.water) ? 1 : 0;
    for (let i = 0; i < n; i++) {
      const rr = rng.fork(`river:${i}`);
      const spawnDepth = index * CHAPTER_DEPTHS + rr.int(1, CHAPTER_DEPTHS);
      const depths = [spawnDepth];
      // The river vanishes into the rock and resurfaces deeper — possibly many times.
      let d = spawnDepth;
      const hops = rr.int(2, 5);
      for (let h = 0; h < hops; h++) {
        d += rr.int(2, 9);
        depths.push(d);
      }
      const namer = civs.length && rr.chance(0.8) ? rr.pick(civs) : null;
      rivers.push({
        id: `river:${index}:${i}`,
        name: namer ? placeName(namer.phon, rr) : "the Nameless Water",
        namedByCivId: namer ? namer.id : null,
        spawnDepth, depths,
      });
    }
    return rivers;
  }

  private generateEvents(
    index: number, stratum: Stratum, civs: Civ[], rivers: River[], rng: RNG,
  ): HistoricalEvent[] {
    const events: HistoricalEvent[] = [];
    let eid = 0;
    const mk = (e: Omit<HistoricalEvent, "id">): HistoricalEvent => {
      const ev = { ...e, id: `ev:${index}:${eid++}` };
      events.push(ev);
      return ev;
    };

    for (const civ of civs) {
      const er = rng.fork(civ.id);
      const cityName = placeName(civ.phon, er);
      mk({
        year: civ.foundedYear, type: "founding", depth: civ.homeDepth,
        civId: civ.id, otherCivId: null, person: civ.rulers[0], place: cityName,
        detail: `${civ.rulers[0]} founded ${cityName} at depth ${civ.homeDepth}, first seat of the ${civ.demonym}`,
        deaths: 0, causedById: null,
      });

      // Mid-history incidents; each may cascade.
      const incidents = er.int(2, 4);
      let lastEvent: HistoricalEvent | null = null;
      for (let k = 0; k < incidents; k++) {
        const year = Math.round(civ.foundedYear * er.range(0.25, 0.85));
        const rulerIdx = Math.min(civ.rulers.length - 1, 1 + k);
        const ruler = civ.rulers[rulerIdx];
        const enemies = civ.relations.filter((r) => r.kind === "war");
        const type: EventType = er.weighted([
          ["war", enemies.length ? 3 : 0],
          ["plague", 1.5],
          ["flood", rivers.length ? 2 : 0.3],
          ["regicide", 1.2],
          ["discovery", 1.5],
          ["heresy", 1],
          ["quake", stratum.heat],
          ["famine", 1],
          ["burning", 0.8],
          ["sealing", 1],
        ] as const);

        const depth = er.chance(0.6)
          ? civ.homeDepth
          : Math.max(1, er.int(civ.territory[0], civ.territory[1]));
        const deaths = type === "war" || type === "plague" || type === "flood"
          ? er.int(300, 40000) : type === "regicide" ? er.int(1, 40) : er.int(0, 900);

        let otherCivId: string | null = null;
        let detail = "";
        switch (type) {
          case "war": {
            const enemy = enemies.length ? er.pick(enemies) : null;
            if (!enemy) { detail = `a border skirmish flared in the reign of ${ruler}; the other side left no records of their own`; break; }
            otherCivId = enemy.civId;
            const foe = this.findCivIn(civs, otherCivId) ?? this.civById(otherCivId);
            detail = `${ruler} of the ${civ.demonym} made war on the ${foe ? foe.demonym : "deep folk"} at depth ${depth}; ${deaths} dead before the peace of salt`;
            break;
          }
          case "plague":
            detail = `a spore-plague rose from the lower vents in the reign of ${ruler}; ${deaths} were carried to the deep graves`;
            break;
          case "flood": {
            // A floor with no named river can still drown: the water comes up
            // through the rock instead, which the records find more frightening.
            const rv = rivers.length ? er.pick(rivers) : null;
            detail = rv
              ? `the river ${rv.name} rose without warning and drowned the lower galleries at depth ${depth}; ${deaths} drowned; the survivors moved one floor up`
              : `water rose from below with no river to blame it on, filling the lower galleries at depth ${depth}; ${deaths} drowned; the pumps ran for a generation afterward`;
            break;
          }
          case "regicide":
            detail = `${ruler} was killed on the temple stair by kin; the succession war that followed lasted ${er.int(2, 19)} years`;
            break;
          case "discovery":
            detail = `miners under ${ruler} broke into a hollow no map recorded at depth ${depth + er.int(1, 3)}, and what they found there was sealed by decree`;
            break;
          case "heresy":
            detail = `the prophet ${personName(civ.phon, er)} preached that ${er.pick(TENETS)}, and was exiled downward with ${er.int(40, 900)} followers`;
            break;
          case "quake":
            detail = `the Great Shaking of ${ruler}'s reign closed nine stairways and opened three that led to places already inhabited`;
            break;
          case "famine":
            detail = `the glowcap harvest failed for ${er.int(2, 7)} consecutive cycles; ${deaths} starved despite the opening of the crypt granaries`;
            break;
          case "burning":
            detail = `a lamp-fire in the fungus terraces spread for ${er.int(3, 30)} days; the pale forest at depth ${depth} has never fully regrown`;
            break;
          case "sealing":
            detail = `by order of ${ruler}, the passage below depth ${depth} was sealed with poured stone, and speaking of what lay beyond was forbidden`;
            break;
          default:
            detail = `an unrecorded calamity struck the ${civ.demonym}`;
        }
        lastEvent = mk({
          year, type, depth, civId: civ.id, otherCivId,
          person: ruler, place: er.chance(0.5) ? cityName : null,
          detail, deaths, causedById: lastEvent && er.chance(0.35) ? lastEvent.id : null,
        });
      }

      // Terminal event for non-extant civs — this is THE event ruins will reference.
      if (civ.fate !== "extant") {
        const fr = rng.fork(civ.id + ":fall");
        const year = Math.max(15, Math.round(civ.foundedYear * fr.range(0.06, 0.3)));
        const finalRuler = civ.rulers[civ.rulers.length - 1];
        const enemies = civ.relations.filter((r) => r.kind === "war");
        const cause: EventType = fr.weighted([
          ["war", enemies.length ? 3 : 0],
          ["collapse", 2],
          ["flood", rivers.length ? 1.5 : 0.2],
          ["plague", 1.5],
          ["migration", 1],
        ] as const);
        const deaths = fr.int(2000, 120000);
        let otherCivId: string | null = null;
        let detail: string;
        switch (cause) {
          case "war": {
            const enemy = enemies.length ? fr.pick(enemies) : null;
            if (!enemy) {
              detail = `${cityName} fell to raiders out of the unmapped deep in the reign of ${finalRuler}; ${deaths} died before the streets went quiet`;
              break;
            }
            otherCivId = enemy.civId;
            const foe = this.findCivIn(civs, otherCivId) ?? this.civById(otherCivId);
            detail = `${cityName} was broken by the ${foe ? foe.demonym : "enemy"} in the reign of ${finalRuler}; the ${civ.demonym} ceased to be a people; ${deaths} died in the last year alone`;
            break;
          }
          case "collapse":
            detail = `the ceiling of the great vault failed above ${cityName}; ${deaths} were entombed in an hour, ${finalRuler} among them`;
            break;
          case "flood":
            detail = `the dark water claimed ${cityName} entirely; divers still find its lamps burning cold below depth ${civ.homeDepth + 2}`;
            break;
          case "plague":
            detail = `the last plague left too few ${civ.demonym} to work the pumps and farms; ${finalRuler} ordered the gates opened and the people scattered`;
            break;
          default:
            detail = `the ${civ.demonym} abandoned ${cityName} and walked down into the deep in a single generation, for reasons their own records refuse to state`;
        }
        const fall = mk({
          year, type: cause === "migration" ? "migration" : cause, depth: civ.homeDepth,
          civId: civ.id, otherCivId, person: finalRuler, place: cityName,
          detail, deaths, causedById: lastEvent ? lastEvent.id : null,
        });
        civ.fallCauseEventId = fall.id;
        civ.fellYear = year;
      }
    }
    return events;
  }

  private findCivIn(civs: Civ[], id: string): Civ | null {
    return civs.find((c) => c.id === id) ?? null;
  }

  private generateLegends(index: number, civs: Civ[], rng: RNG): LegendCreature[] {
    if (!rng.chance(0.5)) return [];
    const lr = rng.fork("legend");
    const namer = civs.length ? lr.pick(civs) : null;
    const home = (index + 1) * CHAPTER_DEPTHS + lr.int(2, 14);
    const migration: number[] = [home];
    let d = home;
    while (d > Math.max(1, home - lr.int(6, 18))) {
      d -= lr.int(1, 3);
      migration.push(d);
    }
    const titles = [
      "the Unfed", "the Ceiling-Walker", "Mother of the Flood", "the Lampless",
      "the Sound Below the Floor", "the Patient One", "Eater of Echoes",
    ];
    return [{
      id: `legend:${index}`,
      name: namer ? word(namer.phon, lr, 2) : word(makePhonology(lr), lr, 2),
      title: lr.pick(titles),
      homeDepth: home,
      migration,
      description: `an apex thing of the deeps that has been climbing for generations; every ecosystem it passes through empties before it`,
    }];
  }
}
