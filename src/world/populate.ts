// Populates a region's terrain with everything the Region record implies:
// ruins in the builder's style, documents anchored to their events, graves for
// the actual dead, a settlement if anyone still lives here, resource nodes,
// the stair gates, and creature spawns. Consults the Ledger so the world stays
// changed: burned flora stays burned, looted chests stay empty, opened seals
// stay open, the dead stay dead.

import * as THREE from "three";
import { rngFor, RNG } from "../core/rng";
import { Region } from "../gen/regions";
import { Species } from "../gen/creatures";
import { DocSpec, surfaceLine } from "../gen/lore";
import { TerrainData } from "./terrain";
import {
  building, monument, graveMarker, muralWall, sealedDoor, stairGate,
  skeletonProp, campfireProp, chestProp, docProp, AABB,
} from "./structures";
import { Ledger } from "../sim/ledger";
import { personName } from "../core/names";
import { Companion, generateCandidate } from "../player/companions";
import { Gear, generateArmor, generateLight, generateCharm } from "../player/equipment";

export type InteractKind =
  | "doc" | "gate-down" | "gate-up" | "resource" | "chest" | "npc"
  | "camp-remnant" | "seal" | "recruit";

export interface Interactable {
  id: string;
  kind: InteractKind;
  pos: THREE.Vector3;
  radius: number;
  prompt: string;
  doc?: DocSpec;
  resource?: string;
  npcText?: { name: string; lines: string[] };
  loot?: { item: string; qty: number }[];
  gearLoot?: Gear[];
  candidates?: Companion[];
  object?: THREE.Object3D;
}

export interface CreatureSpawn {
  id: string;
  species: Species;
  pos: THREE.Vector3;
}

export interface PopulatedRegion {
  group: THREE.Group;
  colliders: AABB[];
  interactables: Interactable[];
  spawns: CreatureSpawn[];
  spawnPoint: THREE.Vector3;   // where the player arrives (at the up-gate)
  downGatePos: THREE.Vector3;
}

const ARTIFACT_ITEMS = ["ancient coin", "crystal lens", "obsidian blade", "beetle-shell bowl", "phosphor vial", "bone flute", "seal ring"];

export function populate(region: Region, terrain: TerrainData, ledger: Ledger): PopulatedRegion {
  const rng = rngFor(region.history.seed, "pop:" + region.depth);
  const group = new THREE.Group();
  const colliders: AABB[] = [];
  const interactables: Interactable[] = [];
  const spawns: CreatureSpawn[] = [];
  const half = region.size / 2;
  const placedSpots: THREE.Vector3[] = [];

  const groundY = (x: number, z: number) => terrain.heightAt(x, z);
  const burned = ledger.has(`burned:${region.depth}`);

  function findSpot(r: RNG, minDist = 10, maxTries = 24, rangeFactor = 0.78): THREE.Vector3 | null {
    for (let t = 0; t < maxTries; t++) {
      const x = r.range(-half * rangeFactor, half * rangeFactor);
      const z = r.range(-half * rangeFactor, half * rangeFactor);
      const y = groundY(x, z);
      if (terrain.waterLevel !== null && y < terrain.waterLevel + 0.5) continue;
      const p = new THREE.Vector3(x, y, z);
      if (placedSpots.every((s) => s.distanceTo(p) > minDist)) {
        placedSpots.push(p);
        return p;
      }
    }
    return null;
  }

  function place(obj: THREE.Object3D, p: THREE.Vector3, cols?: AABB[]) {
    obj.position.copy(p);
    group.add(obj);
    if (cols) {
      for (const c of cols) {
        colliders.push({
          min: c.min.clone().add(p),
          max: c.max.clone().add(p),
        });
      }
    }
  }

  // ---- Gates: up-gate near one edge (player spawn), down-gate far across. ----
  const gr = rng.fork("gates");
  const upPos = new THREE.Vector3(gr.range(-half * 0.5, half * 0.5), 0, -half * 0.62);
  upPos.y = groundY(upPos.x, upPos.z);
  const downPos = new THREE.Vector3(gr.range(-half * 0.5, half * 0.5), 0, half * 0.62);
  downPos.y = groundY(downPos.x, downPos.z);
  placedSpots.push(upPos, downPos);

  const upGate = stairGate(false, region.builderCiv, gr.fork("u"));
  place(upGate.group, upPos, upGate.colliders);
  interactables.push({
    id: `gate-up:${region.depth}`, kind: "gate-up", pos: upPos.clone(), radius: 4,
    prompt: region.depth <= 1 ? "climb toward the surface camp" : `ascend to depth ${region.depth - 1}`,
  });
  const downGate = stairGate(true, region.builderCiv, gr.fork("d"));
  downGate.group.rotation.y = Math.PI;
  place(downGate.group, downPos, downGate.colliders);
  interactables.push({
    id: `gate-down:${region.depth}`, kind: "gate-down", pos: downPos.clone(), radius: 4,
    prompt: `descend to depth ${region.depth + 1} — the air changes past this stair`,
  });

  // ---- Ruins / standing architecture. ----
  const civ = region.builderCiv;
  if (civ) {
    const br = rng.fork("bld");
    const count =
      region.kind === "city" ? 16 : region.kind === "vertical" ? 10 :
      region.kind === "fortress" ? 8 : region.kind === "temple" ? 6 :
      region.kind === "necropolis" ? 4 : region.kind === "mine" ? 6 : 5;
    for (let i = 0; i < count; i++) {
      const p = findSpot(br.fork("b" + i), 13, 24, 0.5); // ruins cluster toward the center
      if (!p) continue;
      const b = building(civ.arch, br.fork("bb" + i), region.ruinDensity * br.range(0.7, 1.2));
      b.group.rotation.y = br.range(0, Math.PI * 2);
      place(b.group, p, b.colliders);
    }
    // Parent-culture ruins: older, more broken, in the PARENT's style — visible descent.
    if (civ.parentCivId) {
      const parent = region.history.civById(civ.parentCivId);
      if (parent) {
        for (let i = 0; i < 2; i++) {
          const p = findSpot(br.fork("p" + i), 16);
          if (!p) continue;
          const b = building(parent.arch, br.fork("pb" + i), 0.2);
          place(b.group, p, b.colliders);
        }
      }
    }
    // Monument with inscription doc attached (if any doc is an inscription).
    const mon = monument(civ.arch, rng.fork("mon"));
    const mp = findSpot(rng.fork("monp"), 14);
    if (mp) place(mon.group, mp, mon.colliders);
  }

  // ---- Documents scattered as physical objects. ----
  const dr = rng.fork("docs");
  for (const doc of region.docs) {
    const p = findSpot(dr.fork(doc.id), 8);
    if (!p) continue;
    let obj: THREE.Object3D;
    if (doc.kind === "mural" && civ) {
      const m = muralWall(civ.arch, doc.id, doc.eventId ? eventTypeOf(region, doc.eventId) : null);
      m.group.rotation.y = dr.range(0, Math.PI * 2);
      place(m.group, p, m.colliders);
      obj = m.group;
    } else if (doc.kind === "gravestone") {
      obj = graveMarker(civ ? civ.arch : null, dr.fork("g" + doc.id));
      place(obj, p);
      // graves cluster — add silent companions
      for (let i = 0; i < dr.int(2, 6); i++) {
        const gp = p.clone().add(new THREE.Vector3(dr.range(-4, 4), 0, dr.range(-4, 4)));
        gp.y = groundY(gp.x, gp.z);
        place(graveMarker(civ ? civ.arch : null, dr.fork("gg" + i + doc.id)), gp);
      }
    } else {
      obj = docProp(doc.kind);
      place(obj, p);
      // journals often lie beside their writers
      if (doc.kind === "journal" && dr.chance(0.55)) {
        const sk = skeletonProp(dr.fork("sk" + doc.id));
        const sp = p.clone().add(new THREE.Vector3(dr.range(-1, 1), 0, dr.range(-1, 1)));
        sp.y = groundY(sp.x, sp.z);
        place(sk, sp);
      }
    }
    interactables.push({
      id: `doc:${region.depth}:${doc.id}`, kind: "doc", pos: p.clone(), radius: 2.5,
      prompt: `read — ${doc.title}`, doc,
    });
  }

  // ---- The seal, if a sealing event happened here (and wasn't opened). ----
  const sealing = region.events.find((e) => e.type === "sealing");
  if (sealing) {
    const p = findSpot(rng.fork("seal"), 15);
    if (p) {
      const opened = ledger.has(`seal-open:${region.depth}`);
      if (!opened) {
        const s = sealedDoor(rng.fork("sealb"));
        place(s.group, p, s.colliders);
        interactables.push({
          id: `seal:${region.depth}`, kind: "seal", pos: p.clone(), radius: 3.5,
          prompt: "break the poured-stone seal — this cannot be undone",
          object: s.group,
        });
      } else {
        const frame = sealedDoor(rng.fork("sealb"));
        frame.group.children.splice(1); // frame only, pour removed
        place(frame.group, p);
      }
    }
  }

  // ---- Settlement: lit fires and NPCs who speak from their actual culture. ----
  if (region.settlement && civ) {
    const sr = rng.fork("settle");
    const center = findSpot(sr, 20) ?? new THREE.Vector3(0, groundY(0, 0), 0);
    for (let i = 0; i < 3; i++) {
      const fp = center.clone().add(new THREE.Vector3(sr.range(-10, 10), 0, sr.range(-10, 10)));
      fp.y = groundY(fp.x, fp.z);
      place(campfireProp(true), fp);
    }
    const npcCount = Math.min(3, Math.max(1, Math.floor(region.settlement.population / 400)) + 1);
    for (let i = 0; i < npcCount; i++) {
      const np = center.clone().add(new THREE.Vector3(sr.range(-8, 8), 0, sr.range(-8, 8)));
      np.y = groundY(np.x, np.z);
      const name = personName(civ.phon, sr.fork("npc" + i));
      const npcMesh = makeNpcMesh(civ.arch.palette);
      place(npcMesh, np);
      const rulerLine = ledger.has(`ruler-dead:${civ.id}`)
        ? `Since the death, ${civ.rulers[civ.rulers.length - 1]}'s heir holds the seat — barely. You would know something about that death, climber.`
        : `${civ.rulers[civ.rulers.length - 1]} rules, as the line of ${civ.rulers[0]} always has.`;
      interactables.push({
        id: `npc:${region.depth}:${i}`, kind: "npc", pos: np.clone(), radius: 2.5,
        prompt: `speak with ${name} of ${region.settlement.name}`,
        npcText: {
          name: `${name} — ${civ.demonym}`,
          lines: [
            `"${surfaceLine(civ)}"`,
            `"We are ${region.settlement.population} here. We keep ${civ.government}. ${rulerLine}"`,
            `"Eat before you go down. ${civ.cuisine[0]} — there is no better, whatever the ${neighborTaunt(region, civ)} say."`,
            `"You want to trade? We take ${region.settlement.tradeGoods.join(", ")}. Surface metal is worth its weight in water here."`,
            `"${civ.myth.charAt(0).toUpperCase() + civ.myth.slice(1)}. That is what we tell children. Lately I wonder who it comforts."`,
          ],
        },
      });
    }

    // A hiring post: people from this culture willing to go down with you.
    const hr = sr.fork("hire");
    const candidates: Companion[] = [];
    const nCand = hr.int(2, 3);
    for (let i = 0; i < nCand; i++) {
      const c = generateCandidate(hr.fork("c" + i), civ, region.depth, i);
      if (ledger.has(`hired:${c.id}`) || ledger.has(`comp-dead:${c.id}`)) continue;
      candidates.push(c);
    }
    if (candidates.length) {
      const hp = center.clone().add(new THREE.Vector3(sr.range(-12, 12), 0, sr.range(-12, 12)));
      hp.y = groundY(hp.x, hp.z);
      place(campfireProp(true), hp);
      interactables.push({
        id: `recruit:${region.depth}`, kind: "recruit", pos: hp.clone(), radius: 3,
        prompt: `the hiring fire — ${candidates.length} of the ${civ.demonym} will go down with you`,
        candidates,
      });
    }
  }

  // ---- Resource nodes. ----
  const rr = rng.fork("res");
  for (let i = 0; i < 14; i++) {
    const p = findSpot(rr.fork("r" + i), 6);
    if (!p) continue;
    if (ledger.has(`harvested:${region.depth}:${i}`)) continue;
    if (burned && rr.chance(0.7)) continue; // a burned region yields little
    const res = rr.pick(region.resources);
    const node = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.45, 0),
      new THREE.MeshStandardMaterial({
        color: 0x8a9a7a, emissive: region.floraColor, emissiveIntensity: 0.35, roughness: 0.8,
      }),
    );
    node.position.copy(p).add(new THREE.Vector3(0, 0.35, 0));
    group.add(node);
    interactables.push({
      id: `res:${region.depth}:${i}`, kind: "resource", pos: p.clone(), radius: 2.2,
      prompt: `gather ${res}`, resource: res, object: node,
    });
  }

  // ---- Chests / grave goods with artifacts FROM the cultures whose depth this is. ----
  const cr = rng.fork("chests");
  const chestCount = civ ? 4 : 2;
  for (let i = 0; i < chestCount; i++) {
    const p = findSpot(cr.fork("c" + i), 10);
    if (!p) continue;
    const id = `chest:${region.depth}:${i}`;
    if (ledger.has(`looted:${id}`)) continue;
    const chest = chestProp(civ ? civ.arch : null);
    chest.rotation.y = cr.range(0, Math.PI * 2);
    place(chest, p);
    const item = cr.pick(ARTIFACT_ITEMS);
    const originCiv = civ ?? null;
    // Roughly half of chests hold real equipment, generated from this culture's
    // own military tradition / religion rather than from a static loot table.
    const gearLoot: Gear[] = [];
    if (cr.chance(0.55)) {
      const roll = cr.next();
      if (originCiv && roll < 0.45) gearLoot.push(generateArmor(cr.fork("g" + i), originCiv, region.depth, i));
      else if (roll < 0.78) gearLoot.push(generateLight(cr.fork("l" + i), originCiv, region.depth, i));
      else if (originCiv) gearLoot.push(generateCharm(cr.fork("ch" + i), originCiv, region.depth, i));
    }
    interactables.push({
      id, kind: "chest", pos: p.clone(), radius: 2.2,
      prompt: `open the ${originCiv ? originCiv.name + "-work" : "old"} chest`,
      loot: [
        { item: originCiv ? `${item} (${originCiv.name} make)` : item, qty: 1 },
        ...(cr.chance(0.5) ? [{ item: "old rations", qty: cr.int(1, 3) }] : []),
      ],
      gearLoot,
      object: chest,
    });
  }

  // ---- Old camp remnants of previous explorers (and the player's own past camps). ----
  if (rng.chance(0.4)) {
    const p = findSpot(rng.fork("oldcamp"), 12);
    if (p) {
      place(campfireProp(false), p);
      const sk = skeletonProp(rng.fork("oldsk"));
      const sp = p.clone().add(new THREE.Vector3(1.2, 0, 0.4));
      sp.y = groundY(sp.x, sp.z);
      place(sk, sp);
      interactables.push({
        id: `remnant:${region.depth}`, kind: "camp-remnant", pos: p.clone(), radius: 2.5,
        prompt: "search the cold camp",
        loot: [{ item: "torch oil", qty: 1 }, { item: "old rations", qty: 1 }],
      });
    }
  }

  // ---- Creatures. Legends thin the fauna; the ledger keeps the dead dead. ----
  const legendHere = region.legends.length > 0;
  const spr = rng.fork("spawn");
  for (const sp of region.species) {
    if (burned && sp.diet === "grazer" && spr.chance(0.6)) continue; // burned food web
    const packs = sp.diet === "grazer" ? spr.int(1, 2) : 1;
    for (let pk = 0; pk < packs; pk++) {
      const anchor = findSpot(spr.fork(sp.id + pk), 14);
      if (!anchor) continue;
      const n = legendHere ? 1 : sp.diet === "grazer" ? spr.int(2, 5) : spr.int(1, 2);
      for (let i = 0; i < n; i++) {
        const id = `${sp.id}:${pk}:${i}`;
        if (ledger.has(`slain:${region.depth}:${id}`)) continue;
        const p = anchor.clone().add(new THREE.Vector3(spr.range(-6, 6), 0, spr.range(-6, 6)));
        p.y = groundY(p.x, p.z);
        spawns.push({ id, species: sp, pos: p });
      }
    }
  }

  // Burned region: visibly scorch the ground record.
  if (burned) {
    const flora = terrain.group.getObjectByName("flora");
    if (flora) flora.visible = false;
    const scorch = new THREE.Mesh(
      new THREE.CircleGeometry(half * 0.7, 24).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x171310, roughness: 1, transparent: true, opacity: 0.85 }),
    );
    scorch.position.y = 0.05;
    group.add(scorch);
  }

  const spawnPoint = upPos.clone().add(new THREE.Vector3(0, 0.5, 6));
  spawnPoint.y = groundY(spawnPoint.x, spawnPoint.z) + 0.5;
  return { group, colliders, interactables, spawns, spawnPoint, downGatePos: downPos };
}

function eventTypeOf(region: Region, eventId: string): string | null {
  const ev = region.events.find((e) => e.id === eventId);
  return ev ? ev.type : null;
}

function neighborTaunt(region: Region, civ: { relations: { civId: string }[] }): string {
  const rel = civ.relations[0];
  if (!rel) return "deep folk";
  const other = region.history.civById(rel.civId);
  return other ? other.demonym : "deep folk";
}

function makeNpcMesh(color: number): THREE.Group {
  const g = new THREE.Group();
  const robe = new THREE.Mesh(
    new THREE.ConeGeometry(0.45, 1.5, 7),
    new THREE.MeshStandardMaterial({ color, roughness: 0.9 }),
  );
  robe.position.y = 0.75;
  g.add(robe);
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.22, 8, 6),
    new THREE.MeshStandardMaterial({ color: 0xcdbfa8, roughness: 0.8 }),
  );
  head.position.y = 1.65;
  g.add(head);
  const lantern = new THREE.PointLight(0xffcc77, 8, 10, 2);
  lantern.position.set(0.5, 1.1, 0);
  g.add(lantern);
  return g;
}
