// Archaeology. Every document in the world is derived from a HistoricalEvent that
// the simulation actually recorded (history.ts). A document = event + source
// perspective + deterministic distortion. Two sources describing the same event
// will disagree about dates, casualties and blame — but they disagree *around a
// real recorded truth*, which the codex lets the player triangulate.

import { RNG } from "../core/rng";
import { History, HistoricalEvent, Civ } from "./history";
import { personName } from "../core/names";

export type DocKind = "journal" | "chronicle" | "enemy-account" | "gravestone" | "mural" | "inscription" | "warning";

export interface DocSpec {
  id: string;
  kind: DocKind;
  title: string;
  sub: string;          // physical description of the object
  body: string;
  source: string;       // provenance line
  eventId: string | null;
  civId: string | null;
}

// A source's systematic bias, applied deterministically per (event, kind).
function distortYear(year: number, rng: RNG, reliability: number): number {
  if (rng.chance(reliability)) return year;
  const drift = Math.round(year * rng.range(0.03, 0.22)) * (rng.chance(0.5) ? 1 : -1);
  const y = Math.max(1, year + drift);
  return rng.chance(0.5) ? Math.round(y / 10) * 10 : y; // chroniclers love round numbers
}
function distortDeaths(deaths: number, rng: RNG, inflate: boolean): number {
  if (deaths === 0) return 0;
  const f = inflate ? rng.range(1.1, 3.5) : rng.range(0.25, 0.9);
  const d = Math.max(1, Math.round(deaths * f));
  return d > 1000 ? Math.round(d / 500) * 500 : d;
}
function yearsAgo(y: number): string {
  return `${y} years before the present descent`;
}

export function documentsForEvent(
  ev: HistoricalEvent, history: History, rng: RNG,
): DocSpec[] {
  const civ = ev.civId ? history.civById(ev.civId) : null;
  const foe = ev.otherCivId ? history.civById(ev.otherCivId) : null;
  const docs: DocSpec[] = [];
  const kinds: DocKind[] = [];

  // Which sources survived? 1–3 per event, chosen deterministically.
  kinds.push(rng.weighted([["chronicle", 3], ["journal", 3], ["inscription", 2], ["mural", 1.5]] as const));
  if (rng.chance(0.55)) kinds.push(rng.pick(["journal", "gravestone", "warning"] as const));
  if (foe && rng.chance(0.6)) kinds.push("enemy-account");

  let di = 0;
  for (const kind of kinds) {
    const dr = rng.fork(`${ev.id}:${kind}:${di}`);
    docs.push(renderDoc(`${ev.id}:doc:${di++}`, kind, ev, civ, foe, dr));
  }
  return docs;
}

function renderDoc(
  id: string, kind: DocKind, ev: HistoricalEvent,
  civ: Civ | null, foe: Civ | null, rng: RNG,
): DocSpec {
  const demonym = civ?.demonym ?? "the deep folk";
  const person = ev.person ?? "the ruler";

  switch (kind) {
    case "chronicle": {
      // Official record: accurate-ish dates, deflated own losses, flattering framing.
      const y = distortYear(ev.year, rng, 0.75);
      const deaths = distortDeaths(ev.deaths, rng, false);
      let body = `In the year reckoned ${y} before now: ${ev.detail}.`;
      if (ev.type === "war" && foe) {
        body = `In the year reckoned ${y} before now, ${person} led the ${demonym} against the treachery of the ${foe.demonym}. ` +
          `The court records ${deaths} honored dead, and does not count the enemy.`;
      } else if (ev.deaths > 0) {
        body += ` The rolls of the temple record ${deaths} names.`;
      }
      if (civ) body += ` So it is written, that ${civ.religion.tenet}.`;
      return {
        id, kind, title: `Chronicle of the ${demonym}`,
        sub: "Bound sheets of pressed fungus-paper, official seal intact",
        body, source: `Court chronicle — an official source; it flatters its own side`,
        eventId: ev.id, civId: civ?.id ?? null,
      };
    }
    case "enemy-account": {
      // The other side: blame reversed, enemy losses inflated.
      const y = distortYear(ev.year, rng, 0.4);
      const deaths = distortDeaths(ev.deaths, rng, true);
      const body = `Let it be remembered that the ${demonym} came against us without cause in the year ${y} before now, ` +
        `and that ${person}, whom they call great, broke the peace of salt first. ` +
        `We counted ${deaths} of their dead in the water afterward. Our own dead were few, and are avenged.`;
      return {
        id, kind, title: foe ? `A ${foe.demonym} account` : "An enemy account",
        sub: "A stone tablet, deliberately placed facing the border",
        body, source: `${foe ? foe.name : "Enemy"} source — hostile to the ${demonym}; note the reversed blame`,
        eventId: ev.id, civId: foe?.id ?? null,
      };
    }
    case "journal": {
      // Eyewitness: emotionally true, numerically vague, date approximate.
      const y = distortYear(ev.year, rng, 0.3);
      const writer = civ ? personName(civ.phon, rng) : "an unknown hand";
      let felt: string;
      switch (ev.type) {
        case "flood": felt = "The water came up the stair faster than a person can climb it. I write this from the roof of the granary. The lamps of the lower town are still burning under the water. No one is putting them out."; break;
        case "war": felt = `They breached the third gate before the bells finished. I saw ${person} standing in the smoke directing the carriers of the wounded. Whatever the chronicles say later, we started counting our dead by streets, not by names.`; break;
        case "plague": felt = "The spore-cough took my sister on the ninth day. The priests say to carry the dead one floor deeper, but there are not enough of us left to carry them."; break;
        case "collapse": felt = "The ceiling spoke all night. Old people said it always speaks. Then at the hour of the second lamp it stopped speaking, which was worse. I was on the far stair when the vault came down."; break;
        case "famine": felt = "We ate the seed-spores in the third cycle. My father would not eat his share, and gave it, and now he is a name on the ceiling."; break;
        case "sealing": felt = `Today they poured the stone. The masons would not look at what was on the other side while they worked. ${person} watched until it was done and then forbade the question I was going to ask.`; break;
        case "regicide": felt = `${person} is dead on the temple stair and every door in the city is barred. I heard the deed was done by kin. I will not write the name I heard.`; break;
        case "heresy": felt = "The prophet spoke in the fish-market until the wardens came. Half my street has gone down with them. My mother says the deep takes the mad, but she said it quietly."; break;
        default: felt = `I saw it myself and set it down plainly: ${ev.detail}.`;
      }
      return {
        id, kind, title: `Journal of ${writer}`,
        sub: "Water-stained pages in a beetle-shell cover; a personal hand",
        body: `${felt}\n\n— written, by its reckoning, ${yearsAgo(y)}`,
        source: "Private journal — an eyewitness; honest, but no head for numbers or dates",
        eventId: ev.id, civId: civ?.id ?? null,
      };
    }
    case "gravestone": {
      const y = distortYear(ev.year, rng, 0.85);
      const dead = civ ? personName(civ.phon, rng) : "one unnamed";
      const cause = ev.type === "war" ? `fell in the war of ${person}` :
        ev.type === "flood" ? "taken by the risen water" :
        ev.type === "plague" ? "carried below by the spore-cough" :
        `died in the ${ev.type}`;
      return {
        id, kind, title: "A grave marker",
        sub: "A worked stone, the name nearly worn smooth",
        body: `${dead.toUpperCase()}\n${cause}\n${yearsAgo(y)}\n\n"${civ ? civ.religion.tenet : "the dark keeps what it is given"}"`,
        source: "Funerary inscription — dates on graves are usually accurate",
        eventId: ev.id, civId: civ?.id ?? null,
      };
    }
    case "mural": {
      const body = `A painted procession covers the wall. ${describeMuralScene(ev, civ, rng)} ` +
        `The pigments are mineral — the reds have outlived the culture that mixed them.`;
      return {
        id, kind, title: "Wall mural",
        sub: `Fresco in mineral pigment${civ ? `, in the ${civ.name} style (${civ.arch.motif} motifs)` : ""}`,
        body, source: "Public art — propaganda by other means; read what it leaves out",
        eventId: ev.id, civId: civ?.id ?? null,
      };
    }
    case "warning": {
      return {
        id, kind, title: "A warning, crudely cut",
        sub: "Letters gouged in haste, crossing older decoration",
        body: ev.type === "sealing"
          ? `DO NOT OPEN WHAT ${(ev.person ?? "THE OLD KING").toUpperCase()} CLOSED.\nWE WERE NOT TOLD WHY. THAT WAS THE MERCY.`
          : `TURN BACK. THE ${ev.type.toUpperCase()} TOOK THE LOWER STAIR. NOTHING BELOW ANSWERS.`,
        source: "Anonymous graffiti — panic, but panic about something real",
        eventId: ev.id, civId: civ?.id ?? null,
      };
    }
    case "inscription":
    default: {
      const y = distortYear(ev.year, rng, 0.9);
      return {
        id, kind, title: "Monument inscription",
        sub: "Formal letters, gold leaf long since picked out",
        body: `RAISED IN THE YEAR ${y} BEFORE NOW.\n${ev.detail.toUpperCase()}.\nLET NONE SAY IT WAS OTHERWISE.`,
        source: "State monument — carved by the winners",
        eventId: ev.id, civId: civ?.id ?? null,
      };
    }
  }
}

function describeMuralScene(ev: HistoricalEvent, civ: Civ | null, rng: RNG): string {
  switch (ev.type) {
    case "war": return `Figures with ${civ?.military ?? "long spears"} drive smaller painted figures off the edge of the panel; the artist gave the enemy no faces.`;
    case "flood": return `A blue-black band swallows the lower third of the scene; above it, figures climb a stair that spirals off the wall's edge; below it, painted lamps still burn.`;
    case "founding": return `A single figure — ${ev.person} — strikes a rock face; behind them the same scene repeats smaller and smaller, city growing in each repetition.`;
    case "plague": return `Rows of figures lie wrapped; above them, priests carry bodies DOWN a stair, not up — note the direction.`;
    case "sealing": return `Masons pour stone into a doorway. On the far side of the door the artist painted only smooth black — not darkness: absence. It was scraped and repainted twice.`;
    case "discovery": return `Miners kneel before an opening in the rock. What is inside the opening has been chiseled off the wall, deliberately, in antiquity.`;
    default: return `The scene records ${ev.detail}; a later hand has scratched a correction that is now itself illegible.`;
  }
}

/** Flavor documents grounded in civ facts rather than a single event. */
export function cultureDoc(civ: Civ, rng: RNG, id: string): DocSpec {
  const writer = personName(civ.phon, rng);
  const pick = rng.int(0, 3);
  let body: string, title: string;
  switch (pick) {
    case 0:
      title = `Recipe tablet`;
      body = `In the hand of ${writer}, a household tablet:\n\n"${rng.pick(civ.cuisine)} — as my mother made it. ` +
        `Trade ${rng.pick(civ.economy)} for the good salt, not the gray. Serve when the second lamp is lit."`;
      break;
    case 1:
      title = `Rite instructions`;
      body = `A priest's crib-sheet for the rite: "${civ.religion.rite}." In the margin, in a child's hand: "why?" ` +
        `and beneath it, in the priest's: "because ${civ.religion.tenet}."`;
      break;
    case 2:
      title = `A letter, unsent`;
      body = `"${writer}, my brother — you ask what we believe about the surface. ` +
        surfaceLine(civ) + ` Do not ask again in writing."`;
      break;
    default:
      title = `Trade manifest`;
      body = `Manifest of a beetle-caravan: ${civ.economy.join(", ")}. ` +
        `Tariff paid at the stair-gate. The clerk has drawn the ${civ.arch.motif} of the ${civ.demonym} where a signature would go.`;
  }
  return {
    id, kind: "journal", title,
    sub: `Everyday writing of the ${civ.demonym}`,
    body, source: `Domestic document — daily life of ${civ.name}`,
    eventId: null, civId: civ.id,
  };
}

export function surfaceLine(civ: Civ): string {
  switch (civ.surfaceBelief) {
    case "myth": return `The old people say there is a roof to the world with fire on the far side of it. No one living has seen it. It is a story for children, and I notice adults tell it more often than children ask for it.`;
    case "heresy": return `To speak of an "above" is to say the dark has an edge, and the priests will not have it. People have gone to the deep-cells for less.`;
    case "known-lost": return `Our ancestors came down from it — this much the records agree on. The way back is another matter; every stair we knew is sealed, fallen, or lies.`;
    case "known-seeking": return `It is real, and we are going back. The Guild of the Upward Stair takes a tithe of every harvest for the digging. My grandmother gave her rings to it. So will I.`;
    case "indifferent": return `Perhaps it exists. Perhaps it is even as bright as they say. We have water rights, standing walls, and no wish to meet whatever made our ancestors run.`;
  }
}
