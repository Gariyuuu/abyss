// The world's memory. Every irreversible thing the player does becomes a flag
// with a timestamp; regions consult it on load (populate.ts), and consequences
// keep PROPAGATING while the player is elsewhere: each time the player rests or
// changes floors, `propagate` advances the world and may append DYNAMIC EVENTS
// to history — succession after a regicide, contact after a broken seal,
// ecosystem shifts after an extinction. These events then show up in NPC
// dialogue and the codex exactly like generated ones.

import { History } from "../gen/history";

export interface DynamicEvent {
  id: string;
  atTime: number;        // game-time hours when it happened
  depth: number;
  text: string;
  seen: boolean;         // surfaced to the player as news yet?
}

export interface LedgerFlag {
  t: number;             // game time set
  data?: string;
}

export class Ledger {
  flags: Record<string, LedgerFlag> = {};
  dynamicEvents: DynamicEvent[] = [];
  private nextId = 0;

  has(key: string): boolean { return key in this.flags; }
  get(key: string): LedgerFlag | undefined { return this.flags[key]; }
  set(key: string, t: number, data?: string) {
    if (!this.has(key)) this.flags[key] = { t, data };
  }

  addEvent(t: number, depth: number, text: string) {
    this.dynamicEvents.push({ id: "dyn:" + this.nextId++, atTime: t, depth, text, seen: false });
  }

  /** Advance consequences. Called on rest and on floor transitions. */
  propagate(now: number, history: History) {
    for (const [key, flag] of Object.entries(this.flags)) {
      const age = now - flag.t;
      const once = (suffix: string) => {
        const k = key + "#" + suffix;
        if (this.flags[k]) return false;
        this.flags[k] = { t: now };
        return true;
      };

      if (key.startsWith("seal-open:") && age > 24 && once("contact")) {
        const depth = parseInt(key.split(":")[1], 10);
        const above = history.civsAt(depth).filter((c) => c.fate === "extant");
        const below = history.civsAt(depth + 2).filter((c) => c.fate === "extant");
        if (above.length && below.length && above[0].id !== below[0].id) {
          this.addEvent(now, depth,
            `Because the seal at depth ${depth} was broken, the ${above[0].demonym} and the ${below[0].demonym} have met for the first time in recorded memory. First contact was ${above[0].relations.some(r => r.kind === "war") ? "spears-first" : "cautious trade"}.`);
        } else {
          this.addEvent(now, depth,
            `Cold air moves through the broken seal at depth ${depth}. Things that were on the other side no longer are.`);
        }
      }

      if (key.startsWith("ruler-dead:") && age > 12 && once("succession")) {
        const civId = key.slice("ruler-dead:".length);
        const civ = history.civById(civId);
        if (civ) {
          this.addEvent(now, civ.homeDepth,
            `Succession has settled among the ${civ.demonym}: a new hand holds ${civ.name}. Prices at the stair-gates have doubled while the factions test each other.`);
        }
      }

      if (key.startsWith("burned:") && age > 24 * 30 && once("regrow")) {
        const depth = parseInt(key.split(":")[1], 10);
        this.addEvent(now, depth,
          `A month on, pale shoots are rising through the ash at depth ${depth}. The forest that grows back will not be the one that burned.`);
      }

      if (key.startsWith("predator-gone:") && age > 24 * 3 && once("bloom")) {
        const depth = parseInt(key.split(":")[1], 10);
        this.addEvent(now, depth,
          `With its only predator dead, the grazing herds at depth ${depth} have exploded — and stripped the ${"flora"} faster than it regrows.`);
        this.set(`herd-bloom:${depth}`, now);
      }

      if (key.startsWith("legend-freed:") && age > 24 * 2 && once("migrate")) {
        const depth = parseInt(key.split(":")[1], 10);
        this.addEvent(now, depth - 2,
          `Something enormous has been heard moving UP from depth ${depth}. Settlements above are hanging double lamps at the stair-gates.`);
        this.set(`legend-at:${depth - 2}`, now);
      }

      if (key.startsWith("flooded:") && age > 24 && once("evac")) {
        const depth = parseInt(key.split(":")[1], 10);
        this.addEvent(now, depth,
          `The waters released at depth ${depth} have found their level. What lived on the low ground has moved, drowned, or learned to swim.`);
      }
    }
  }

  takeNews(): string[] {
    const news = this.dynamicEvents.filter((e) => !e.seen).map((e) => e.text);
    for (const e of this.dynamicEvents) e.seen = true;
    return news;
  }
}

// ------------------------------------------------------------------ save ----

export interface CodexState {
  docsRead: string[];                      // doc ids
  docsMeta: { id: string; title: string; body: string; source: string; depth: number }[];
  speciesSeen: Record<string, number>;     // species id -> observation level 0..3
  civsMet: string[];
  regionsVisited: number[];
}

export interface SaveData {
  seed: string;
  gameTime: number;
  depth: number;
  campDepth: number;
  hp: number; stamina: number; mana: number;
  hunger: number; thirst: number; torchFuel: number;
  injury: string | null;
  inventory: Record<string, number>;
  equipped: { weapon: string; armor: string | null };
  ledgerFlags: Record<string, LedgerFlag>;
  dynamicEvents: DynamicEvent[];
  codex: CodexState;
}

const KEY = "abyss-save-v1";

export function saveGame(data: SaveData) {
  localStorage.setItem(KEY, JSON.stringify(data));
}
export function loadGame(): SaveData | null {
  const raw = localStorage.getItem(KEY);
  if (!raw) return null;
  try { return JSON.parse(raw) as SaveData; } catch { return null; }
}
export function clearSave() { localStorage.removeItem(KEY); }
