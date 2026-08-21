// The explorer. Third-person controller (orbit camera + pointer lock), grounded
// movement with stamina, jumping, ledge-climbing, swimming, dodge rolls, fall
// injuries, and three disciplines: sword (arc melee, flank-aware), bow (arrows
// are ammunition you craft), and aether bolts (mana). Light is survival:
// the torch burns real fuel and most deep predators respect it.

import * as THREE from "three";
import { AABB } from "../world/structures";
import { Creature } from "../ai/creature-ai";

export interface WorldQuery {
  heightAt(x: number, z: number): number;
  waterLevel: number | null;
  colliders: AABB[];
  creatures: Creature[];
}

export type Weapon = "sword" | "bow" | "aether";

export interface PlayerEvents {
  onToast(msg: string): void;
  onDamaged(cause: string): void;
  onArrowFired(): boolean;      // returns whether an arrow was available
  onManaSpent(cost: number): boolean;
}

const EYE = 1.0;
const RADIUS = 0.45;

export class Player {
  group = new THREE.Group();
  velocity = new THREE.Vector3();
  yaw = 0; pitch = -0.25;
  hp = 100; maxHp = 100;
  stamina = 100; mana = 40; maxMana = 40;
  hunger = 100; thirst = 100;       // deplete toward 0
  torchFuel = 100; torchOn = true;
  injury: string | null = null;
  weapon: Weapon = "sword";
  blocking = false;
  aiming = false;
  dead = false;

  private grounded = false;
  private climbing = false;
  private dodgeTimer = 0;
  private attackCd = 0;
  private keys = new Set<string>();
  private torchLight: THREE.PointLight;
  private bodyMesh: THREE.Group;
  private swimHint = false;

  constructor(
    public camera: THREE.PerspectiveCamera,
    private world: WorldQuery,
    private events: PlayerEvents,
  ) {
    this.bodyMesh = this.makeBody();
    this.group.add(this.bodyMesh);
    this.torchLight = new THREE.PointLight(0xffa64d, 55, 34, 1.7);
    this.torchLight.position.set(0.35, 1.6, 0);
    this.torchLight.castShadow = false;
    this.group.add(this.torchLight);
  }

  private makeBody(): THREE.Group {
    const g = new THREE.Group();
    const cloak = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.32, 0.85, 4, 8),
      new THREE.MeshStandardMaterial({ color: 0x4a4238, roughness: 0.95 }),
    );
    cloak.position.y = 0.95;
    cloak.castShadow = true;
    g.add(cloak);
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.19, 8, 6),
      new THREE.MeshStandardMaterial({ color: 0xc9b8a0, roughness: 0.85 }),
    );
    head.position.y = 1.66;
    g.add(head);
    const pack = new THREE.Mesh(
      new THREE.BoxGeometry(0.42, 0.55, 0.25),
      new THREE.MeshStandardMaterial({ color: 0x5c4a34, roughness: 1 }),
    );
    pack.position.set(0, 1.15, 0.3);
    g.add(pack);
    const blade = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.8, 0.12),
      new THREE.MeshStandardMaterial({ color: 0x9a9aa2, roughness: 0.3, metalness: 0.8 }),
    );
    blade.name = "blade";
    blade.position.set(0.45, 1.0, -0.1);
    blade.rotation.z = 0.4;
    g.add(blade);
    return g;
  }

  attachInput(dom: HTMLElement) {
    window.addEventListener("keydown", (e) => {
      this.keys.add(e.code);
      if (e.code === "KeyQ") this.dodge();
      if (e.code === "KeyT") this.toggleTorch();
      if (e.code === "Digit1") { this.weapon = "sword"; this.events.onToast("sword drawn"); }
      if (e.code === "Digit2") { this.weapon = "bow"; this.events.onToast("bow in hand"); }
      if (e.code === "Digit3") { this.weapon = "aether"; this.events.onToast("aether gathered to the fingers"); }
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));
    dom.addEventListener("mousemove", (e) => {
      if (document.pointerLockElement !== dom) return;
      this.yaw -= e.movementX * 0.0024;
      this.pitch = Math.max(-1.2, Math.min(0.6, this.pitch - e.movementY * 0.0022));
    });
    dom.addEventListener("mousedown", (e) => {
      if (document.pointerLockElement !== dom) return;
      if (e.button === 0) this.attack();
      if (e.button === 2) { this.blocking = this.weapon === "sword"; this.aiming = this.weapon !== "sword"; }
    });
    dom.addEventListener("mouseup", (e) => {
      if (e.button === 2) { this.blocking = false; this.aiming = false; }
    });
    dom.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  toggleTorch() {
    if (!this.torchOn && this.torchFuel <= 0) { this.events.onToast("no oil left — the dark is total"); return; }
    this.torchOn = !this.torchOn;
    this.events.onToast(this.torchOn ? "torch lit" : "torch shuttered");
  }

  private dodge() {
    if (this.stamina < 18 || this.dodgeTimer > 0 || !this.grounded) return;
    this.stamina -= 18;
    this.dodgeTimer = 0.38;
    const dir = this.moveDir();
    if (dir.lengthSq() < 0.01) dir.set(Math.sin(this.yaw + Math.PI), 0, Math.cos(this.yaw + Math.PI));
    this.velocity.x = dir.x * 13;
    this.velocity.z = dir.z * 13;
  }

  private attack() {
    if (this.attackCd > 0 || this.dead) return;
    const facing = new THREE.Vector3(Math.sin(this.yaw + Math.PI), 0, Math.cos(this.yaw + Math.PI));
    if (this.weapon === "sword") {
      if (this.stamina < 10) { this.events.onToast("too exhausted to swing"); return; }
      this.stamina -= 10;
      this.attackCd = 0.55;
      this.animateSwing();
      for (const c of this.world.creatures) {
        if (c.state === "dead") continue;
        const to = c.mesh.position.clone().sub(this.group.position); to.y = 0;
        const dist = to.length();
        if (dist < 2.8 + c.species.plan.size && to.normalize().dot(facing) > 0.45) {
          const creatureFacing = new THREE.Vector3(Math.cos(-c.mesh.rotation.y), 0, Math.sin(-c.mesh.rotation.y));
          const fromFlank = Math.abs(creatureFacing.dot(to)) < 0.5;
          c.takeDamage(26, fromFlank, 0);
        }
      }
    } else if (this.weapon === "bow") {
      if (!this.events.onArrowFired()) { this.events.onToast("quiver empty — craft arrows from flint and bone"); return; }
      this.attackCd = 0.9;
      this.fireProjectile(46, 60);
    } else {
      if (!this.events.onManaSpent(12)) { this.events.onToast("the aether will not answer — rest to recover"); return; }
      this.attackCd = 0.8;
      this.fireProjectile(34, 40, true);
    }
  }

  /** Hitscan along camera ray for bow/aether; aether bolts also sear light-weak creatures. */
  private fireProjectile(damage: number, range: number, aether = false) {
    const origin = this.group.position.clone().add(new THREE.Vector3(0, 1.4, 0));
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    let best: { c: Creature; d: number } | null = null;
    for (const c of this.world.creatures) {
      if (c.state === "dead") continue;
      const to = c.mesh.position.clone().add(new THREE.Vector3(0, c.species.plan.size * 0.6, 0)).sub(origin);
      const t = to.dot(dir);
      if (t < 0 || t > range) continue;
      const perp = to.clone().addScaledVector(dir, -t).length();
      if (perp < 1.1 + c.species.plan.size * 0.6) {
        if (!best || t < best.d) best = { c, d: t };
      }
    }
    if (best) {
      const bonus = aether && best.c.species.weaknessKind === "light" ? 1.8 : 1;
      best.c.takeDamage(damage * bonus, false, 0);
    }
  }

  private animateSwing() {
    const blade = this.bodyMesh.getObjectByName("blade");
    if (!blade) return;
    blade.rotation.z = -1.4;
    setTimeout(() => { blade.rotation.z = 0.4; }, 180);
  }

  private moveDir(): THREE.Vector3 {
    const f = new THREE.Vector3(Math.sin(this.yaw + Math.PI), 0, Math.cos(this.yaw + Math.PI));
    const r = new THREE.Vector3(f.z, 0, -f.x);
    const dir = new THREE.Vector3();
    if (this.keys.has("KeyW")) dir.add(f);
    if (this.keys.has("KeyS")) dir.sub(f);
    if (this.keys.has("KeyA")) dir.add(r);
    if (this.keys.has("KeyD")) dir.sub(r);
    if (dir.lengthSq() > 0) dir.normalize();
    return dir;
  }

  update(dt: number) {
    if (this.dead) return;
    this.attackCd = Math.max(0, this.attackCd - dt);
    this.dodgeTimer = Math.max(0, this.dodgeTimer - dt);
    const pos = this.group.position;
    const dir = this.moveDir();

    const inWater = this.world.waterLevel !== null && pos.y < this.world.waterLevel - 0.2;
    const running = this.keys.has("ShiftLeft") && this.stamina > 1 && dir.lengthSq() > 0;
    let speed = running ? 7.4 : 4.2;
    if (this.injury === "wrenched leg") speed *= 0.55;
    if (this.blocking || this.aiming) speed *= 0.5;
    if (inWater) speed *= 0.55;

    if (this.dodgeTimer <= 0) {
      this.velocity.x = dir.x * speed;
      this.velocity.z = dir.z * speed;
    }
    if (running) this.stamina = Math.max(0, this.stamina - dt * 9);
    else this.stamina = Math.min(100, this.stamina + dt * (this.hunger > 20 ? 12 : 4));
    this.mana = Math.min(this.maxMana, this.mana + dt * 0.8);

    // Needs tick.
    this.hunger = Math.max(0, this.hunger - dt * 0.12);
    this.thirst = Math.max(0, this.thirst - dt * 0.2);
    if (this.hunger <= 0 || this.thirst <= 0) {
      this.hp -= dt * 1.5;
      if (this.hp <= 0) this.die(this.hunger <= 0 ? "starvation, far from any table" : "thirst, in a world made of water");
    }
    if (this.torchOn) {
      this.torchFuel = Math.max(0, this.torchFuel - dt * 0.45);
      if (this.torchFuel <= 0) { this.torchOn = false; this.events.onToast("the torch gutters out"); }
    }
    this.torchLight.visible = this.torchOn;
    this.torchLight.intensity = 55 * (0.75 + 0.25 * Math.sin(performance.now() * 0.01)) * Math.min(1, this.torchFuel / 10 + 0.6);

    // Gravity / swim.
    if (inWater) {
      this.velocity.y = this.keys.has("Space") ? 3 : -1.2;
      this.grounded = false;
    } else {
      this.velocity.y -= 22 * dt;
      if (this.keys.has("Space") && this.grounded) {
        this.velocity.y = 8.2;
        this.grounded = false;
      }
    }

    // Integrate.
    const prevY = pos.y;
    pos.x += this.velocity.x * dt;
    pos.z += this.velocity.z * dt;
    pos.y += this.velocity.y * dt;

    // Ground.
    const ground = this.world.heightAt(pos.x, pos.z);
    if (pos.y <= ground) {
      const fallSpeed = -this.velocity.y;
      if (fallSpeed > 16 && !inWater) {
        const dmg = Math.round((fallSpeed - 15) * 4);
        this.hp -= dmg;
        this.events.onDamaged(`a fall (${dmg})`);
        if (fallSpeed > 21 && !this.injury) {
          this.injury = "wrenched leg";
          this.events.onToast("something in your leg gives — you need a splint or a long rest");
        }
        if (this.hp <= 0) this.die("the floor of the Abyss, arriving suddenly");
      }
      pos.y = ground;
      this.velocity.y = 0;
      this.grounded = true;
    }

    // Ledge climbing: pushing into a slope too steep to walk while holding space.
    const ahead = this.world.heightAt(pos.x + dir.x * 1.2, pos.z + dir.z * 1.2);
    this.climbing = false;
    if (dir.lengthSq() > 0 && ahead > pos.y + 1.1 && ahead < pos.y + 6 && this.keys.has("Space") && this.stamina > 5) {
      pos.y += dt * 3.2;
      this.velocity.y = 0;
      this.stamina -= dt * 16;
      this.climbing = true;
      this.grounded = false;
    }

    // AABB push-out.
    for (const c of this.world.colliders) {
      if (pos.x + RADIUS < c.min.x || pos.x - RADIUS > c.max.x) continue;
      if (pos.z + RADIUS < c.min.z || pos.z - RADIUS > c.max.z) continue;
      if (pos.y > c.max.y - 0.1 || pos.y + 1.7 < c.min.y) continue;
      const dxMin = pos.x + RADIUS - c.min.x, dxMax = c.max.x - (pos.x - RADIUS);
      const dzMin = pos.z + RADIUS - c.min.z, dzMax = c.max.z - (pos.z - RADIUS);
      const m = Math.min(dxMin, dxMax, dzMin, dzMax);
      if (m === dxMin) pos.x = c.min.x - RADIUS;
      else if (m === dxMax) pos.x = c.max.x + RADIUS;
      else if (m === dzMin) pos.z = c.min.z - RADIUS;
      else pos.z = c.max.z + RADIUS;
    }

    void prevY; void EYE;
    // Face move direction.
    if (dir.lengthSq() > 0.01) {
      const target = Math.atan2(dir.x, dir.z);
      this.bodyMesh.rotation.y = target;
    }
    // Drinking from water edges handled via interaction in main.

    // Camera orbit.
    const camDist = this.aiming ? 2.6 : 5.4;
    const look = pos.clone().add(new THREE.Vector3(0, 1.55, 0));
    const off = new THREE.Vector3(
      Math.sin(this.yaw) * Math.cos(this.pitch),
      -Math.sin(this.pitch),
      Math.cos(this.yaw) * Math.cos(this.pitch),
    ).multiplyScalar(camDist);
    const camPos = look.clone().add(off);
    const camGround = this.world.heightAt(camPos.x, camPos.z) + 0.4;
    if (camPos.y < camGround) camPos.y = camGround;
    this.camera.position.lerp(camPos, Math.min(1, dt * 10));
    this.camera.lookAt(look);

    if (inWater !== this.swimHint) {
      this.swimHint = inWater;
      if (inWater) this.events.onToast("cold water — hold SPACE to swim up");
    }
  }

  damage(amount: number, cause: string) {
    if (this.dead) return;
    if (this.blocking) amount = Math.round(amount * 0.3);
    this.hp -= amount;
    this.events.onDamaged(cause);
    if (this.hp <= 0) this.die(cause);
  }

  die(cause: string) {
    if (this.dead) return;
    this.dead = true;
    this.events.onToast("");
    const ev = new CustomEvent("player-death", { detail: cause });
    window.dispatchEvent(ev);
  }
}
