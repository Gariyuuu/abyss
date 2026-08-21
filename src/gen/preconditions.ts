// Event preconditions — the generative grammar's guard rail.
//
// Two crashes and two chronology bugs all came from the same mistake: an event
// was rolled and then assumed an entity that need not exist (an enemy for a war,
// a river for a flood, a living author for an account). Weighting those cases to
// zero worked until someone added a new event type and forgot.
//
// So requirements are declared as data here, and the selector can only ever
// choose from event types whose requirements the current context satisfies.
// If nothing qualifies, there is an always-valid fallback set. Nothing is ever
// invented to rescue a roll (see the project's root-cause rule).

import { EventType } from "./history";

export interface EventContext {
  /** War partners actually recorded in this civ's relations. */
  enemyCount: number;
  /** Named rivers known at this civ's depths. */
  riverCount: number;
  /** Named rulers, needed for regicide/succession. */
  rulerCount: number;
  /** A parent culture, needed for a schism to mean anything. */
  hasParentCulture: boolean;
  /** Geothermal activity, needed for a quake to be geologically motivated. */
  heat: number;
  /** Other societies at all — needed for anything relational. */
  peerCount: number;
}

export type Requirement = (c: EventContext) => boolean;

/**
 * Requirements per event type. An event type absent from this map is
 * unconditionally valid (plague, famine, burning, discovery, sealing, founding).
 */
export const EVENT_REQUIREMENTS: Partial<Record<EventType, Requirement>> = {
  // A war needs someone to fight.
  war: (c) => c.enemyCount > 0 && c.peerCount > 0,
  // A regicide needs a ruler to kill.
  regicide: (c) => c.rulerCount > 0,
  // A quake needs a geologically live stratum.
  quake: (c) => c.heat > 0.08,
  // A heresy needs a body of doctrine, which every culture has, but it also
  // exiles people downward, so it needs somewhere to go: always allowed.
  heresy: () => true,
  // Flood is the interesting one — see FLOOD_SUBTYPES below. A flood is always
  // possible, but WHICH flood depends on whether a river exists.
  flood: () => true,
  // Migration means leaving toward or away from someone.
  migration: (c) => c.peerCount > 0 || c.hasParentCulture,
};

/** Event types that are valid in any context whatsoever. */
export const UNCONDITIONAL: EventType[] = [
  "plague", "famine", "burning", "discovery", "sealing", "collapse",
];

export function isSatisfied(type: EventType, ctx: EventContext): boolean {
  const req = EVENT_REQUIREMENTS[type];
  return req ? req(ctx) : true;
}

/** Filter a weighted candidate list down to entries whose requirements hold. */
export function admissible<T extends EventType>(
  candidates: readonly (readonly [T, number])[],
  ctx: EventContext,
): (readonly [T, number])[] {
  return candidates.filter(([t, w]) => w > 0 && isSatisfied(t, ctx));
}

// ------------------------------------------------------------- flood kinds ----

export type FloodSubtype = "river" | "groundwater";

/**
 * A floor with no named river can still drown — the water comes up through the
 * rock instead. Modelling the absence deliberately (rather than inventing a
 * river to satisfy the roll) is the whole point.
 */
export function floodSubtype(riverCount: number): FloodSubtype {
  return riverCount > 0 ? "river" : "groundwater";
}

// -------------------------------------------------------------- chronology ----

/**
 * Years are counted BEFORE PRESENT, so a larger number is older. A culture's
 * terminal event must be strictly more recent (smaller) than every other event
 * it participated in, and every event must be no older than its founding.
 */
export function isChronologicallyOrdered(
  foundedYear: number, midYears: number[], fellYear: number | null,
): boolean {
  for (const y of midYears) {
    if (y > foundedYear) return false;          // happened before the culture existed
    if (fellYear !== null && y < fellYear) return false; // happened after it ended
  }
  if (fellYear !== null && fellYear > foundedYear) return false;
  return true;
}

/** Was this culture alive at a given year-before-present? */
export function wasAliveAt(
  foundedYear: number, fellYear: number | null, year: number,
): boolean {
  if (year > foundedYear) return false;        // before founding
  if (fellYear !== null && year < fellYear) return false; // after the end
  return true;
}
