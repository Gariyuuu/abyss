// Scholar interpretation — structure first, prose second.
//
// A scholar's reading of a document is NOT freeform dialogue. It is computed
// from canonical state only:
//
//   1. the document (its kind and content)
//   2. the document's author culture
//   3. the scholar's own culture
//   4. the canonical relationship between those two cultures
//   5. the period during which both actually existed
//   6. the specific recorded events the two shared
//
// `interpret()` returns that structure. `renderInterpretation()` turns it into
// prose. Tests assert the STRUCTURE — the stance, the confidence, the cited
// event ids — and never snapshot exact wording, so the writing can change
// without weakening the guarantee that no relationship is ever invented.

import { History, Civ, HistoricalEvent } from "./history";
import { DocSpec } from "./lore";

/** How the scholar's people stand toward the document's people. */
export type Relationship =
  | "same-culture"      // the scholar's own people wrote it
  | "war"               // recorded belligerents
  | "trade"             // recorded trading partners
  | "vassal"            // recorded subordination either way
  | "ancestor"          // the document's culture is the scholar's parent culture
  | "descendant"        // the document's culture split off from the scholar's
  | "unfamiliar"        // both exist, no recorded relationship at all
  | "unknown-author";   // the document has no attributable culture

/** The interpretive posture the relationship licenses. */
export type Stance =
  | "invested"          // their own records: close reading, admitted bias
  | "hostile"           // an enemy's account: distrusted, blame contested
  | "trusting"          // a trading partner: credible, cross-checkable
  | "deferential"       // a culture they were subordinate to (or vice versa)
  | "kin-recognition"   // the parent culture — unsettling recognition
  | "estranged-kin"     // the daughter culture — familiar but drifted
  | "agnostic";         // no basis for judgment; must say so

/** How much the scholar can actually make of the document. */
export type Legibility = "fluent" | "partial" | "opaque";
export type Confidence = "high" | "moderate" | "low" | "none";

export interface Interpretation {
  scholarCultureId: string;
  scholarCultureName: string;
  documentCultureId: string | null;
  documentCultureName: string | null;
  documentKind: string;
  relationship: Relationship;
  /** Years-before-present window in which BOTH cultures existed, if they overlapped. */
  contactPeriod: { fromYear: number; toYear: number } | null;
  /** Canonical event ids involving both cultures — the basis for any claim made. */
  sharedEventIds: string[];
  stance: Stance;
  legibility: Legibility;
  confidence: Confidence;
  /** True when the scholar cannot support a judgment and must say so. */
  admitsIgnorance: boolean;
}

/** Walk the descent chain to find a culture's root ancestor. */
function rootAncestor(civ: Civ, history: History): string {
  const seen = new Set<string>();
  let cur: Civ = civ;
  while (cur.parentCivId && !seen.has(cur.parentCivId)) {
    seen.add(cur.parentCivId);
    const parent = history.civById(cur.parentCivId);
    if (!parent) break;
    cur = parent;
  }
  return cur.id;
}

function relationshipBetween(mine: Civ, theirs: Civ, history: History): Relationship {
  if (mine.id === theirs.id) return "same-culture";
  if (mine.parentCivId === theirs.id) return "ancestor";
  if (theirs.parentCivId === mine.id) return "descendant";
  const rel = mine.relations.find((r) => r.civId === theirs.id);
  switch (rel?.kind) {
    case "war": return "war";
    case "trade": return "trade";
    case "vassal": return "vassal";
    case "schism":
      // A schism relation without a direct parent link still means shared descent.
      return rootAncestor(mine, history) === rootAncestor(theirs, history)
        ? "estranged" as never : "unfamiliar";
    default: return "unfamiliar";
  }
}

const STANCE_BY_RELATIONSHIP: Record<Relationship, Stance> = {
  "same-culture": "invested",
  war: "hostile",
  trade: "trusting",
  vassal: "deferential",
  ancestor: "kin-recognition",
  descendant: "estranged-kin",
  unfamiliar: "agnostic",
  "unknown-author": "agnostic",
};

/**
 * A scholar is not a universal translator. Reading depends on shared descent
 * (shared script) or sustained contact (learned script). Strangers are opaque.
 */
function legibilityFor(rel: Relationship, sharedRoot: boolean): Legibility {
  switch (rel) {
    case "same-culture":
    case "ancestor":
    case "descendant":
      return "fluent";
    case "trade":
    case "vassal":
      return "fluent";           // sustained contact means learned letters
    case "war":
      return "partial";          // enemies read each other imperfectly
    case "unfamiliar":
      return sharedRoot ? "partial" : "opaque";
    case "unknown-author":
      return "opaque";
  }
}

const CONFIDENCE: Record<Legibility, Confidence> = {
  fluent: "high",
  partial: "moderate",
  opaque: "none",
};

/**
 * Compute the interpretation structure. Pure function of canonical state —
 * given the same scholar culture, document and history, always identical.
 */
export function interpret(
  scholarCivId: string, doc: DocSpec, history: History,
): Interpretation | null {
  const mine = history.civById(scholarCivId);
  if (!mine) return null;
  const theirs = doc.civId ? history.civById(doc.civId) : null;

  if (!theirs) {
    return {
      scholarCultureId: mine.id, scholarCultureName: mine.name,
      documentCultureId: null, documentCultureName: null,
      documentKind: doc.kind,
      relationship: "unknown-author",
      contactPeriod: null,
      sharedEventIds: [],
      stance: "agnostic",
      legibility: "opaque",
      confidence: "none",
      admitsIgnorance: true,
    };
  }

  const rawRel = relationshipBetween(mine, theirs, history);
  const relationship: Relationship = (rawRel as string) === "estranged"
    ? "descendant" : rawRel;
  const sharedRoot = rootAncestor(mine, history) === rootAncestor(theirs, history);
  const legibility = legibilityFor(relationship, sharedRoot);

  // Overlap window: both cultures alive at once. Years count BACK from present,
  // so the overlap runs from the more recent founding to the older ending.
  const startBoth = Math.min(mine.foundedYear, theirs.foundedYear);
  const endMine = mine.fellYear ?? 0;
  const endTheirs = theirs.fellYear ?? 0;
  const endBoth = Math.max(endMine, endTheirs);
  const contactPeriod = startBoth > endBoth
    ? { fromYear: startBoth, toYear: endBoth }
    : null;

  // Only canonical events involving BOTH cultures may be cited.
  const sharedEventIds = history
    .eventsOfCiv(mine.id)
    .filter((e: HistoricalEvent) =>
      (e.civId === mine.id && e.otherCivId === theirs.id) ||
      (e.civId === theirs.id && e.otherCivId === mine.id))
    .map((e) => e.id);

  return {
    scholarCultureId: mine.id, scholarCultureName: mine.name,
    documentCultureId: theirs.id, documentCultureName: theirs.name,
    documentKind: doc.kind,
    relationship,
    contactPeriod,
    sharedEventIds,
    stance: STANCE_BY_RELATIONSHIP[relationship],
    legibility,
    confidence: CONFIDENCE[legibility],
    admitsIgnorance: legibility === "opaque" || relationship === "unfamiliar",
  };
}

// ------------------------------------------------------------------ prose ----

/**
 * Render the structure as speech. Every clause here is licensed by a field of
 * the Interpretation; nothing is asserted that the structure does not carry.
 */
export function renderInterpretation(
  interp: Interpretation, scholarName: string, history: History,
): { speaker: string; text: string } {
  const speaker = `${scholarName} of ${interp.scholarCultureName}`;
  const theirs = interp.documentCultureId ? history.civById(interp.documentCultureId) : null;
  const mine = history.civById(interp.scholarCultureId);

  // Opaque first: if they cannot read it, they cannot judge it.
  if (interp.legibility === "opaque") {
    return {
      speaker,
      text: interp.relationship === "unknown-author"
        ? `"I cannot place the hand at all. The letter-forms belong to no alphabet we teach. ` +
          `I will not guess at it for you — a guess would be worse than the silence."`
        : `"${theirs ? `The ${theirs.demonym}. ` : ""}We do not know these people well enough for me to judge. ` +
          `I can tell you this is old and that it was meant to be read, and nothing else honestly."`,
    };
  }

  const hedge = interp.legibility === "partial"
    ? ` "Understand that I am reading a script we only half learned — take my rendering loosely."`
    : "";

  switch (interp.stance) {
    case "invested":
      return {
        speaker,
        text: `"These are my own people's records. I was raised on this account." ` +
          (interp.documentKind === "chronicle"
            ? `"Which is exactly why I will tell you the court wrote it, and the court had reasons. Halve the glory. Keep the dates."`
            : `"It reads true to me — and you should weigh that, because I am the last person able to read it coldly."`),
      };
    case "hostile": {
      const cited = interp.sharedEventIds.length;
      return {
        speaker,
        text: `"The ${theirs!.demonym}." *They do not touch it.* ` +
          `"We have our own record of ${cited > 0 ? `the ${cited === 1 ? "war" : `${cited} clashes`} between us` : "these years"}, ` +
          `and it does not say what this says. Somebody is lying about who struck first. ` +
          `I know which way I lean, and I am telling you so you can discount me."` + hedge,
      };
    }
    case "trusting":
      return {
        speaker,
        text: `"We knew these people — we traded ${mine?.economy[0] ?? "salt"} to them` +
          (interp.contactPeriod
            ? ` across the years between ${interp.contactPeriod.fromYear} and ${interp.contactPeriod.toYear} before now`
            : ` for a long while`) +
          `." "Their record-keeping was honest by the standards of the deep. Where they and we disagree, I would check ours first."` + hedge,
      };
    case "deferential":
      return {
        speaker,
        text: `"There was a tribute road between us once, and it did not run in our favor." ` +
          `"I will read it to you plainly, but I was taught to read these people carefully, and that training is itself a bias."` + hedge,
      };
    case "kin-recognition":
      return {
        speaker,
        text: `"...This is our own alphabet, older." *A long pause.* ` +
          `"We are taught we have always been here. This says we came down from them. ` +
          `I would like to sit with that before I say anything else."`,
      };
    case "estranged-kin":
      return {
        speaker,
        text: `"These are the ones who left us." "The children of the schism. They kept the letters and changed the vowels, ` +
          `so it reads like listening to your own family through a wall."`,
      };
    case "agnostic":
    default:
      return {
        speaker,
        text: `"We do not know these people well enough for me to judge." ` +
          `"Note the ${theirs?.arch.motif ?? "border"} motif — that is not decoration, that is a signature. ` +
          `If we meet it again lower down, it is the same hands. That is all I will claim."`,
      };
  }
}
