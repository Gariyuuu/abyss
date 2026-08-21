// Companions. Hired at living settlements, so every companion comes FROM a
// generated culture and carries that culture's perspective with them.
//
// The important tie-in: a scholar reads the documents you find through their
// own people's relationship to whoever wrote them. A Tharnic scholar standing
// in front of a Tharnic chronicle defends it; standing in front of their
// enemy's account of the same battle, they call it a lie. The player gets a
// second biased source for free — and has to weigh that bias too.
//
// Companions eat your food, carry your weight, fight beside you, and die
// permanently (recorded in the ledger, which the world then reacts to).

import * as THREE from "three";
import { RNG } from "../core/rng";
import { personName } from "../core/names";
import { Civ, History } from "../gen/history";
import { DocSpec } from "../gen/lore";
import { Species } from "../gen/creatures";

export type CompanionRole = "porter" | "warden" | "scholar" | "hunter";

export interface Companion {
  id: string;
  name: string;
  civId: string | null;
  role: CompanionRole;
  hp: number;
  maxHp: number;
  alive: boolean;
  hiredAtDepth: number;
  /** Their own line about why they came down with you. */
  motive: string;
}

export const ROLE_INFO: Record<CompanionRole, { label: string; blurb: string; hp: number }> = {
  porter: {
    label: "Porter",
    blurb: "carries +12 of your pack weight; complains about all of it",
    hp: 70,
  },
  warden: {
    label: "Warden",
    blurb: "fights what comes at you, and takes hits meant for you",
    hp: 130,
  },
  scholar: {
    label: "Scholar",
    blurb: "reads every document you find through their own people's eyes",
    hp: 55,
  },
  hunter: {
    label: "Hunter",
    blurb: "knows the local fauna; you learn creatures roughly twice as fast",
    hp: 90,
  },
};

const MOTIVES: Record<CompanionRole, string[]> = {
  porter: [
    "My family's debt is older than my family. Your coin is younger.",
    "I have carried stone up this stair for eleven years. Down is a change.",
    "I want to see the floor everyone says isn't there.",
  ],
  warden: [
    "The wall I was posted to fell. A post is a post.",
    "I swore to guard whoever pays the salt-price. You paid it.",
    "My brother went down and did not come up. I am not looking for him. I am.",
  ],
  scholar: [
    "Our records stop at a certain depth. I would like to know why.",
    "Everything I have read about below, I read from people who never went.",
    "I am told the deeper inscriptions are older than our alphabet. I want to be wrong.",
  ],
  hunter: [
    "The herds moved down this season. I follow the herds.",
    "There is something new in the lower galleries and nobody has named it yet.",
    "You will get yourself eaten without me. That is the whole of my reasoning.",
  ],
};

export function generateCandidate(
  rng: RNG, civ: Civ, depth: number, index: number,
): Companion {
  const role = rng.weighted([
    ["porter", 2], ["warden", 2.4], ["scholar", 1.6], ["hunter", 1.6],
  ] as const);
  const hp = ROLE_INFO[role].hp;
  return {
    id: `comp:${depth}:${index}`,
    name: personName(civ.phon, rng),
    civId: civ.id,
    role,
    hp, maxHp: hp,
    alive: true,
    hiredAtDepth: depth,
    motive: rng.pick(MOTIVES[role]),
  };
}

export function hireCost(role: CompanionRole): { item: string; qty: number }[] {
  // Paid in supplies, not abstract currency — hiring should cost you expedition depth.
  switch (role) {
    case "porter": return [{ item: "rations", qty: 2 }];
    case "warden": return [{ item: "rations", qty: 2 }, { item: "torch oil", qty: 1 }];
    case "scholar": return [{ item: "rations", qty: 1 }, { item: "waterskin", qty: 1 }];
    case "hunter": return [{ item: "rations", qty: 2 }, { item: "arrow", qty: 5 }];
  }
}

// ---------------------------------------------------------------- reading ----

/**
 * A scholar's annotation on a document, derived from the relationship between
 * the scholar's culture and the document's culture as recorded in history.
 * This is a real second perspective, not flavor text.
 */
export function scholarReading(
  comp: Companion, doc: DocSpec, history: History,
): { speaker: string; text: string } | null {
  if (comp.role !== "scholar" || !comp.alive) return null;
  const mine = comp.civId ? history.civById(comp.civId) : null;
  if (!mine) return null;
  const theirs = doc.civId ? history.civById(doc.civId) : null;
  const speaker = `${comp.name} of ${mine.name}`;

  if (!theirs) {
    return {
      speaker,
      text: `"I cannot place the hand. The letter-forms are older than anything we teach. ` +
        `Whoever cut this was not writing for us, and not, I think, for anyone who came after them either."`,
    };
  }

  if (theirs.id === mine.id) {
    return {
      speaker,
      text: `"These are my own people's records. I was raised on this account." ` +
        (doc.kind === "chronicle"
          ? `"Which is exactly why I will tell you the court wrote it, and the court had reasons. Halve the glory. Keep the dates."`
          : `"It reads true to me — and you should weigh that, because I am the last person able to read it coldly."`),
    };
  }

  const rel = mine.relations.find((r) => r.civId === theirs.id);
  if (rel?.kind === "war") {
    return {
      speaker,
      text: `"The ${theirs.demonym}." *They do not touch it.* "We have their version of this in our own archives, ` +
        `and it does not say what this says. Somebody is lying about who struck first. I know which way I lean, ` +
        `and I am telling you so you can discount me."`,
    };
  }
  if (rel?.kind === "trade" || rel?.kind === "vassal") {
    return {
      speaker,
      text: `"We knew these people — we traded ${mine.economy[0]} to them for a century." ` +
        `"Their record-keeping was honest by the standards of the deep. Where they and we disagree, ` +
        `I would check ours first."`,
    };
  }
  if (mine.parentCivId === theirs.id) {
    return {
      speaker,
      text: `"...This is our own alphabet, older." *A long pause.* "We are taught we have always been here. ` +
        `This says we came down from them. I would like to sit with that before I say anything else."`,
    };
  }
  if (theirs.parentCivId === mine.id) {
    return {
      speaker,
      text: `"These are the ones who left us." "The children of the schism. They kept the letters and changed the vowels, ` +
        `so it reads like listening to your own family through a wall."`,
    };
  }
  return {
    speaker,
    text: `"Unknown to us — and we thought we had a list of everyone." ` +
      `"Note the ${theirs.arch.motif} motif in the border. That is not a decoration; that is a signature. ` +
      `If we see it again lower down, it is the same people."`,
  };
}

/** A hunter's read on a creature the player has barely observed. */
export function hunterReading(comp: Companion, sp: Species): string | null {
  if (comp.role !== "hunter" || !comp.alive) return null;
  return `${comp.name}, low: "${sp.weakness.charAt(0).toUpperCase() + sp.weakness.slice(1)}. ` +
    `Do not let it get behind you while you work that out."`;
}

/** Region arrival remark, if the companion's culture actually knows this depth. */
export function arrivalRemark(
  comp: Companion, depth: number, regionName: string, history: History,
): string | null {
  const mine = comp.civId ? history.civById(comp.civId) : null;
  if (!mine || !comp.alive) return null;
  const inTerritory = depth >= mine.territory[0] && depth <= mine.territory[1];
  if (inTerritory && depth !== comp.hiredAtDepth) {
    return `${comp.name}: "This was ours, once. My grandmother's maps stop one floor below here."`;
  }
  if (depth > mine.territory[1] + 3) {
    return `${comp.name}: "We are past every name I know. From here I am as blind as you."`;
  }
  return null;
}

// -------------------------------------------------------------------- AI ----

export function buildCompanionMesh(comp: Companion, civ: Civ | null): THREE.Group {
  const g = new THREE.Group();
  const color = civ ? civ.arch.palette : 0x6a6258;
  const robe = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.28, 0.75, 4, 8),
    new THREE.MeshStandardMaterial({ color, roughness: 0.95 }),
  );
  robe.position.y = 0.85;
  robe.castShadow = true;
  g.add(robe);
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.17, 8, 6),
    new THREE.MeshStandardMaterial({ color: 0xc4b49c, roughness: 0.85 }),
  );
  head.position.y = 1.48;
  g.add(head);

  // Role is readable at a glance from silhouette.
  if (comp.role === "porter") {
    const pack = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.62, 0.34),
      new THREE.MeshStandardMaterial({ color: 0x5a4632, roughness: 1 }),
    );
    pack.position.set(0, 1.05, 0.32);
    g.add(pack);
  } else if (comp.role === "warden") {
    const spear = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.035, 2.1, 5),
      new THREE.MeshStandardMaterial({ color: 0x4a3a2a, roughness: 0.9 }),
    );
    spear.position.set(0.32, 1.0, 0);
    spear.rotation.z = 0.12;
    g.add(spear);
  } else if (comp.role === "scholar") {
    const lamp = new THREE.PointLight(0xffcc88, 14, 14, 2);
    lamp.position.set(0.4, 1.2, 0);
    g.add(lamp);
    const bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.09, 6, 5),
      new THREE.MeshBasicMaterial({ color: 0xffdd99 }),
    );
    bulb.position.copy(lamp.position);
    g.add(bulb);
  } else {
    const bow = new THREE.Mesh(
      new THREE.TorusGeometry(0.34, 0.03, 5, 12, Math.PI),
      new THREE.MeshStandardMaterial({ color: 0x5a4530, roughness: 0.9 }),
    );
    bow.position.set(0.3, 1.05, 0);
    bow.rotation.set(0, Math.PI / 2, 0);
    g.add(bow);
  }
  return g;
}

export interface CompanionActorDeps {
  heightAt(x: number, z: number): number;
  onSpeak(line: string): void;
  onDeath(comp: Companion): void;
}

/** Follow-and-fight actor. Wardens intercept; hunters shoot; others keep back. */
export class CompanionActor {
  mesh: THREE.Group;
  private attackCd = 0;
  private speakCd = 6;
  private bob = 0;

  constructor(
    public comp: Companion,
    civ: Civ | null,
    pos: THREE.Vector3,
    private deps: CompanionActorDeps,
  ) {
    this.mesh = buildCompanionMesh(comp, civ);
    this.mesh.position.copy(pos);
  }

  private get fights(): boolean {
    return this.comp.role === "warden" || this.comp.role === "hunter";
  }

  takeDamage(dmg: number) {
    if (!this.comp.alive) return;
    this.comp.hp -= dmg;
    if (this.comp.hp <= 0) {
      this.comp.alive = false;
      this.mesh.rotation.z = Math.PI / 2.2;
      this.mesh.position.y = this.deps.heightAt(this.mesh.position.x, this.mesh.position.z) + 0.2;
      this.deps.onDeath(this.comp);
    } else if (this.comp.hp < this.comp.maxHp * 0.35) {
      this.deps.onSpeak(`${this.comp.name}: "I'm hurt — badly. Do not count on me for the next one."`);
    }
  }

  update(
    dt: number,
    playerPos: THREE.Vector3,
    hostiles: { pos: THREE.Vector3; hp: number; damage(d: number): void; name: string }[],
  ) {
    if (!this.comp.alive) return;
    this.attackCd = Math.max(0, this.attackCd - dt);
    this.speakCd = Math.max(0, this.speakCd - dt);
    const pos = this.mesh.position;

    // Nearest hostile that is actually a threat to the party.
    let target: (typeof hostiles)[number] | null = null;
    let td = Infinity;
    if (this.fights) {
      for (const h of hostiles) {
        const d = h.pos.distanceTo(playerPos);
        if (d < 16 && d < td) { td = d; target = h; }
      }
    }

    let goal: THREE.Vector3;
    let speed = 5.2;
    if (target && this.comp.role === "warden") {
      // Interpose: stand between the player and the threat.
      goal = target.pos.clone().add(playerPos).multiplyScalar(0.5);
      if (pos.distanceTo(target.pos) < 2.4 && this.attackCd <= 0) {
        target.damage(18);
        this.attackCd = 1.5;
      }
    } else if (target && this.comp.role === "hunter") {
      // Hold at range and shoot.
      const away = playerPos.clone().sub(target.pos).normalize().multiplyScalar(6);
      goal = playerPos.clone().add(away);
      if (this.attackCd <= 0 && td < 22) {
        target.damage(13);
        this.attackCd = 2.0;
      }
    } else {
      // Trail the player, offset so they don't shove you.
      const back = new THREE.Vector3(Math.sin(this.bob * 0.7), 0, Math.cos(this.bob * 0.7)).multiplyScalar(2.4);
      goal = playerPos.clone().add(back);
      speed = pos.distanceTo(playerPos) > 12 ? 7.5 : 4.4; // catch up if left behind
    }

    const dir = goal.clone().sub(pos); dir.y = 0;
    const dist = dir.length();
    if (dist > 1.1) {
      dir.normalize();
      pos.addScaledVector(dir, Math.min(speed * dt, dist));
      this.mesh.rotation.y = Math.atan2(dir.x, dir.z);
    }
    this.bob += dt;
    const g = this.deps.heightAt(pos.x, pos.z);
    pos.y += (g - pos.y) * Math.min(1, dt * 9);

    // Occasional unprompted line when something is close.
    if (target && this.speakCd <= 0 && Math.random() < 0.3) {
      this.speakCd = 14;
      this.deps.onSpeak(
        this.comp.role === "warden"
          ? `${this.comp.name}: "Behind me. Now."`
          : `${this.comp.name}: "I have it in my sights — do not walk into the line."`,
      );
    }
  }
}

export function carryBonus(companions: Companion[]): number {
  return companions.filter((c) => c.alive && c.role === "porter").length * 12;
}
export function observationMultiplier(companions: Companion[]): number {
  return companions.some((c) => c.alive && c.role === "hunter") ? 2.1 : 1;
}
export function scholarOf(companions: Companion[]): Companion | null {
  return companions.find((c) => c.alive && c.role === "scholar") ?? null;
}
export function hunterOf(companions: Companion[]): Companion | null {
  return companions.find((c) => c.alive && c.role === "hunter") ?? null;
}
