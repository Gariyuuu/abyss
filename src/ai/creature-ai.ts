// Creatures: mesh assembled from the species' generated BodyPlan (size, legs,
// eyes, glow, armor — anatomy is data, not art), and behavior driven by diet.
// Observation: standing near a living specimen slowly raises the player's
// knowledge level for that species; the codex reveals fields per level.
//   L0 sighted → field description only
//   L1 observed (~10s watching) → habitat + behavior
//   L2 studied (~30s or a kill) → diet, prey, weakness
//   L3 understood (multiple kills/long study) → reproduction + full entry

import * as THREE from "three";
import { Species } from "../gen/creatures";

export function buildCreatureMesh(sp: Species): THREE.Group {
  const g = new THREE.Group();
  const p = sp.plan;
  const bodyLen = p.size * p.elongation * 0.8;
  const bodyR = p.size * 0.42;
  const mat = new THREE.MeshStandardMaterial({
    color: p.color, roughness: 0.85,
    emissive: p.glow ? p.glowColor : 0x000000,
    emissiveIntensity: p.glow ? 0.5 : 0,
  });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(bodyR, bodyLen, 4, 8), mat);
  body.rotation.z = Math.PI / 2;
  body.position.y = p.locomotion === "ceiling" ? 0 : bodyR + p.size * 0.35;
  body.castShadow = true;
  g.add(body);

  if (p.armor > 0.3) {
    const plate = new THREE.Mesh(
      new THREE.SphereGeometry(bodyR * 1.15, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: new THREE.Color(p.color).multiplyScalar(0.6), roughness: 0.6, metalness: 0.2 }),
    );
    plate.scale.set(p.elongation, 1, 1);
    plate.position.copy(body.position).add(new THREE.Vector3(0, bodyR * 0.3, 0));
    g.add(plate);
  }

  // Head with eyes (or eyeless smoothness).
  const head = new THREE.Mesh(new THREE.SphereGeometry(bodyR * 0.7, 8, 6), mat.clone());
  head.position.set(bodyLen / 2 + bodyR * 0.8, body.position.y + bodyR * 0.15, 0);
  g.add(head);
  if (p.eyes > 0) {
    const eyeMat = new THREE.MeshBasicMaterial({ color: p.glow ? p.glowColor : 0xffee88 });
    for (let i = 0; i < p.eyes; i++) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(bodyR * 0.09, 5, 4), eyeMat);
      const a = (i / p.eyes - 0.5) * 1.6;
      eye.position.copy(head.position).add(new THREE.Vector3(bodyR * 0.5, bodyR * 0.25, Math.sin(a) * bodyR * 0.5));
      g.add(eye);
    }
  }

  // Legs.
  if (p.legs > 0 && p.locomotion !== "swimmer" && p.locomotion !== "floater") {
    const legMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(p.color).multiplyScalar(0.75), roughness: 0.9 });
    const legLen = body.position.y;
    for (let i = 0; i < p.legs; i++) {
      const side = i % 2 === 0 ? 1 : -1;
      const along = (Math.floor(i / 2) / Math.max(1, p.legs / 2 - 1) - 0.5) * bodyLen;
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(bodyR * 0.12, bodyR * 0.08, legLen, 5), legMat);
      leg.position.set(along || 0, legLen / 2, side * bodyR * 0.9);
      leg.name = "leg";
      g.add(leg);
    }
  }
  return g;
}

export type CreatureState = "idle" | "wander" | "flee" | "stalk" | "attack" | "dead";

export interface CreatureCallbacks {
  onPlayerHit: (damage: number, byName: string) => void;
  onObserve: (speciesId: string, amount: number) => void;
  onDeath: (creature: Creature) => void;
}

export class Creature {
  mesh: THREE.Group;
  state: CreatureState = "idle";
  hp: number;
  private wanderTarget = new THREE.Vector3();
  private wanderTimer = 0;
  private attackCd = 0;
  private home: THREE.Vector3;
  observedTime = 0;

  constructor(
    public id: string,
    public species: Species,
    pos: THREE.Vector3,
    private heightAt: (x: number, z: number) => number,
    private cb: CreatureCallbacks,
  ) {
    this.mesh = buildCreatureMesh(species);
    this.mesh.position.copy(pos);
    this.home = pos.clone();
    this.hp = species.hp;
  }

  takeDamage(dmg: number, fromFlank: boolean, now: number): boolean {
    const sp = this.species;
    let mult = 1;
    if (sp.weaknessKind === "flanks" && fromFlank) mult = 2.2;
    else if (sp.plan.armor > 0.3 && !fromFlank) mult = 1 - sp.plan.armor * 0.5;
    this.hp -= dmg * mult;
    this.cb.onObserve(sp.id, 0.5); // fighting teaches
    if (this.hp <= 0) {
      this.state = "dead";
      this.mesh.rotation.z = Math.PI / 2;
      this.cb.onDeath(this);
      return true;
    }
    if (sp.aggro < 0.4) this.state = "flee";
    else this.state = "stalk";
    return false;
  }

  update(
    dt: number, playerPos: THREE.Vector3, torchOn: boolean,
    playerBlocking: boolean, playerNoise = 1,
  ) {
    if (this.state === "dead") return;
    const sp = this.species;
    const pos = this.mesh.position;
    const toPlayer = playerPos.clone().sub(pos);
    toPlayer.y = 0;
    const dist = toPlayer.length();

    // Observation: player watching a living creature within 18m learns it.
    if (dist < 18) {
      this.observedTime += dt;
      if (this.observedTime > 1) {
        this.cb.onObserve(sp.id, this.observedTime * 0.03);
        this.observedTime = 0;
      }
    }

    // Light weakness is mechanically real: torch pushes them back.
    const lightRepel = torchOn && sp.fleesLight && dist < 10;

    switch (this.state) {
      case "idle":
        this.wanderTimer -= dt;
        if (this.wanderTimer <= 0) {
          this.state = "wander";
          this.wanderTarget.set(
            this.home.x + (Math.random() - 0.5) * 30, 0,
            this.home.z + (Math.random() - 0.5) * 30,
          );
          this.wanderTimer = 3 + Math.random() * 5;
        }
        break;
      case "wander": {
        this.moveToward(this.wanderTarget, sp.speed * 0.45, dt);
        this.wanderTimer -= dt;
        if (this.wanderTimer <= 0) { this.state = "idle"; this.wanderTimer = 2 + Math.random() * 6; }
        break;
      }
      case "flee": {
        const away = pos.clone().sub(playerPos); away.y = 0;
        if (away.lengthSq() > 0.01) {
          this.moveToward(pos.clone().add(away.normalize().multiplyScalar(10)), sp.speed, dt);
        }
        if (dist > 35) this.state = "idle";
        break;
      }
      case "stalk": {
        if (lightRepel) {
          const back = pos.clone().sub(playerPos).normalize().multiplyScalar(6).add(pos);
          this.moveToward(back, sp.speed * 0.8, dt);
          break;
        }
        this.moveToward(playerPos, sp.speed, dt);
        if (dist < sp.plan.size + 1.6) this.state = "attack";
        if (dist > 45) this.state = "idle";
        break;
      }
      case "attack": {
        this.attackCd -= dt;
        if (this.attackCd <= 0) {
          const dmg = playerBlocking ? Math.round(this.species.damage * 0.25) : this.species.damage;
          this.cb.onPlayerHit(dmg, sp.name);
          this.attackCd = 1.4;
        }
        if (dist > sp.plan.size + 2.2) this.state = "stalk";
        break;
      }
    }

    // Aggro check from idle/wander. Creatures that hunt by echo — the eyeless and
    // the sound-weak — notice loud armor from further off, so what you wear
    // changes who finds you.
    const hearsByEcho = sp.plan.eyes === 0 || sp.weaknessKind === "sound";
    const noticeRange = hearsByEcho ? 22 * playerNoise : 22;
    if ((this.state === "idle" || this.state === "wander") && dist < noticeRange) {
      const alertness = sp.aggro * (hearsByEcho ? playerNoise : 1);
      if (sp.aggro > 0.4 && !lightRepel && Math.random() < alertness * dt * 1.2) this.state = "stalk";
      else if (sp.aggro <= 0.15 && dist < 7) this.state = "flee";
    }

    // Face travel direction; bob legs crudely.
    const y = this.heightAt(pos.x, pos.z);
    pos.y += ((sp.plan.locomotion === "ceiling" ? y + 3 : y) - pos.y) * Math.min(1, dt * 8);
  }

  private moveToward(target: THREE.Vector3, speed: number, dt: number) {
    const pos = this.mesh.position;
    const dir = target.clone().sub(pos); dir.y = 0;
    const d = dir.length();
    if (d < 0.3) return;
    dir.normalize();
    pos.addScaledVector(dir, Math.min(speed * dt, d));
    this.mesh.rotation.y = Math.atan2(dir.x, dir.z) - Math.PI / 2;
  }
}

export function observationLevel(x: number): number {
  return x >= 6 ? 3 : x >= 3 ? 2 : x >= 1 ? 1 : 0;
}
