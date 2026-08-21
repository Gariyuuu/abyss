// Expedition state — deliberately separate from canonical world state.
//
// The world (History) is what happened. The expedition is what THIS player
// found out, carried, hired and lost. Nothing here may mutate history; the
// journal only holds references into it. That separation is what lets the run
// be reconstructed afterwards ("we distrusted those inscriptions because our
// scholar's people fought the writers") without the player's actions quietly
// rewriting the past they are trying to read.

import { History } from "../gen/history";
import { Interpretation } from "../gen/interpretation";

export type JournalKind =
  | "descend" | "document" | "interpretation" | "artifact" | "culture"
  | "creature" | "companion-hired" | "companion-died"
  /** A canonical historical event the player learned about. */
  | "world-event"
  /** A consequence the player's own actions caused — ledger news, not history. */
  | "consequence";

export interface JournalEntry {
  atTime: number;         // game hours
  depth: number;
  kind: JournalKind;
  /** Canonical id this entry points at (doc id, civ id, event id, species id...). */
  ref: string;
  summary: string;
  /** Structured provenance, recorded only for interpretation entries. */
  provenance?: Interpretation;
}

export class Expedition {
  journal: JournalEntry[] = [];
  /** Bounded: a very long descent must not grow the record without limit. */
  static readonly MAX_ENTRIES = 500;

  record(e: JournalEntry) {
    this.journal.push(e);
    if (this.journal.length > Expedition.MAX_ENTRIES) {
      // Keep descents and deaths — the spine of the story — drop routine finds.
      const spine = this.journal.filter(
        (x) => x.kind === "descend" || x.kind === "companion-died" || x.kind === "companion-hired",
      );
      const rest = this.journal.filter(
        (x) => !(x.kind === "descend" || x.kind === "companion-died" || x.kind === "companion-hired"),
      );
      const keepRest = rest.slice(-(Expedition.MAX_ENTRIES - spine.length));
      this.journal = [...spine, ...keepRest].sort((a, b) => a.atTime - b.atTime);
    }
  }

  of(kind: JournalKind): JournalEntry[] {
    return this.journal.filter((e) => e.kind === kind);
  }

  deepestReached(): number {
    return this.journal.reduce((m, e) => Math.max(m, e.depth), 0);
  }

  serialize(): JournalEntry[] { return this.journal; }
  static restore(data: JournalEntry[] | undefined): Expedition {
    const e = new Expedition();
    e.journal = Array.isArray(data) ? data : [];
    return e;
  }
}

// ------------------------------------------------------------- validation ----

export interface IntegrityIssue { entry: JournalEntry; problem: string }

/**
 * Every canonical id the expedition references must resolve, and every recorded
 * interpretation must still describe the relationship history actually holds.
 * Used by the stress harness after long runs and by the test suite.
 */
export function validateExpedition(
  exp: Expedition, history: History, ledger?: { dynamicEvents: { id: string }[] },
): IntegrityIssue[] {
  const issues: IntegrityIssue[] = [];
  for (const e of exp.journal) {
    if (!e.ref) issues.push({ entry: e, problem: "entry has no canonical reference" });
    if (e.depth < 1) issues.push({ entry: e, problem: `impossible depth ${e.depth}` });
    if (!Number.isFinite(e.atTime)) issues.push({ entry: e, problem: "non-finite timestamp" });

    switch (e.kind) {
      case "culture": {
        if (!history.civById(e.ref)) issues.push({ entry: e, problem: `culture ${e.ref} does not resolve` });
        break;
      }
      case "world-event": {
        // Canonical history only — the player learned about something that
        // genuinely happened before the expedition began.
        if (!history.eventById(e.ref)) issues.push({ entry: e, problem: `event ${e.ref} does not resolve` });
        break;
      }
      case "consequence": {
        // Caused by the player, so it lives in the ledger rather than history.
        // Validating it against history would be a category error.
        if (ledger && !ledger.dynamicEvents.some((d) => d.id === e.ref)) {
          issues.push({ entry: e, problem: `consequence ${e.ref} is not in the ledger` });
        }
        break;
      }
      case "interpretation": {
        const p = e.provenance;
        if (!p) { issues.push({ entry: e, problem: "interpretation without provenance" }); break; }
        if (!history.civById(p.scholarCultureId)) {
          issues.push({ entry: e, problem: `scholar culture ${p.scholarCultureId} does not resolve` });
        }
        if (p.documentCultureId && !history.civById(p.documentCultureId)) {
          issues.push({ entry: e, problem: `document culture ${p.documentCultureId} does not resolve` });
        }
        for (const evId of p.sharedEventIds) {
          if (!history.eventById(evId)) {
            issues.push({ entry: e, problem: `cited event ${evId} does not resolve` });
          }
        }
        // An agnostic reading may never claim shared history.
        if (p.relationship === "unfamiliar" && p.sharedEventIds.length > 0) {
          issues.push({ entry: e, problem: "unfamiliar relationship cites shared events" });
        }
        break;
      }
    }
  }
  return issues;
}

/**
 * Chronological coherence of the run itself: time never runs backwards, and
 * a companion cannot act after their recorded death.
 */
export function validateNarrativeOrder(exp: Expedition): IntegrityIssue[] {
  const issues: IntegrityIssue[] = [];
  let lastTime = -Infinity;
  const dead = new Map<string, number>();
  for (const e of exp.journal) {
    if (e.atTime < lastTime - 1e-6) {
      issues.push({ entry: e, problem: `time ran backwards (${e.atTime} after ${lastTime})` });
    }
    lastTime = Math.max(lastTime, e.atTime);
    if (e.kind === "companion-died") dead.set(e.ref, e.atTime);
    if (e.kind === "interpretation" && e.provenance) {
      // Recorded interpretations survive their author's death (they are memory),
      // but no NEW interpretation may be dated after it.
      const died = dead.get(e.ref);
      if (died !== undefined && e.atTime > died) {
        issues.push({ entry: e, problem: "interpretation recorded after the scholar died" });
      }
    }
  }
  return issues;
}
