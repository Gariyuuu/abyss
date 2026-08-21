// ABYSS: The Infinite Below — bootstrap and game loop.
// Order of truth: seed → History (macro simulation) → Region (derived record)
// → terrain/populate (rendered evidence) → Ledger (what the player changed).

import * as THREE from "three";
import { History } from "./gen/history";
import { Region, generateRegion } from "./gen/regions";
import { buildTerrain, TerrainData } from "./world/terrain";
import { populate, PopulatedRegion, Interactable } from "./world/populate";
import { Player } from "./player/player";
import { Inventory, startingPack, surfaceResupply, ITEMS } from "./player/inventory";
import { Creature } from "./ai/creature-ai";
import { Species } from "./gen/creatures";
import { Ledger, CodexState, saveGame, loadGame, clearSave, SaveData } from "./sim/ledger";
import { UI } from "./ui/ui";
import { rngFor } from "./core/rng";

const canvasHost = document.getElementById("app")!;

class Game {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  history!: History;
  ledger = new Ledger();
  codex: CodexState = { docsRead: [], docsMeta: [], speciesSeen: {}, civsMet: [], regionsVisited: [] };
  inventory!: Inventory;
  player!: Player;
  ui!: UI;
  seed = "";
  gameTime = 8; // hours
  depth = 1;
  campDepth = 1;

  region: Region | null = null;
  terrain: TerrainData | null = null;
  populated: PopulatedRegion | null = null;
  creatures: Creature[] = [];
  visitedRegions = new Map<number, Region>();
  campfires: THREE.Vector3[] = [];
  regionGroup: THREE.Group | null = null;
  ambient!: THREE.AmbientLight;
  hemi!: THREE.HemisphereLight;
  running = false;
  private last = performance.now();

  constructor() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    canvasHost.insertBefore(this.renderer.domElement, canvasHost.firstChild);
    this.camera = new THREE.PerspectiveCamera(68, innerWidth / innerHeight, 0.1, 600);
    this.ambient = new THREE.AmbientLight(0xffffff, 0.1);
    this.hemi = new THREE.HemisphereLight(0x334455, 0x110d0a, 0.15);
    this.scene.add(this.ambient, this.hemi);
    addEventListener("resize", () => {
      this.camera.aspect = innerWidth / innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(innerWidth, innerHeight);
    });
  }

  // ------------------------------------------------------------------ boot ----

  newGame(seed: string) {
    clearSave();
    this.seed = seed;
    this.history = new History(seed);
    this.inventory = startingPack();
    this.gameTime = 8;
    this.depth = 1;
    this.campDepth = 1;
    this.ledger = new Ledger();
    this.codex = { docsRead: [], docsMeta: [], speciesSeen: {}, civsMet: [], regionsVisited: [] };
    this.startCommon();
    this.ui.toast("The rope ends here. Below is nobody's map.", true);
  }

  continueGame(save: SaveData) {
    this.seed = save.seed;
    this.history = new History(save.seed);
    this.inventory = new Inventory();
    this.inventory.items = { ...save.inventory };
    this.gameTime = save.gameTime;
    this.depth = save.depth;
    this.campDepth = save.campDepth;
    this.ledger = new Ledger();
    this.ledger.flags = save.ledgerFlags;
    this.ledger.dynamicEvents = save.dynamicEvents;
    this.codex = save.codex;
    this.startCommon();
    const p = this.player;
    p.hp = save.hp; p.stamina = save.stamina; p.mana = save.mana;
    p.hunger = save.hunger; p.thirst = save.thirst; p.torchFuel = save.torchFuel;
    p.injury = save.injury;
    this.ui.toast("You wake where you slept. The Abyss did not.", true);
    for (const n of this.ledger.takeNews()) this.ui.toast("◆ " + n, true);
  }

  private startCommon() {
    this.player = new Player(this.camera, {
      heightAt: (x, z) => this.terrain ? this.terrain.heightAt(x, z) : 0,
      get waterLevel() { return null as number | null; },
      colliders: [],
      creatures: [],
    }, {
      onToast: (m) => m && this.ui.toast(m),
      onDamaged: () => this.ui.flashDamage(),
      onArrowFired: () => this.inventory.remove("arrow", 1),
      onManaSpent: (c) => { if (this.player.mana < c) return false; this.player.mana -= c; return true; },
    });
    // Re-bind world query live (region changes swap these).
    const self = this;
    (this.player as unknown as { world: unknown }).world = {
      heightAt: (x: number, z: number) => self.terrain ? self.terrain.heightAt(x, z) : 0,
      get waterLevel() { return self.terrain ? self.terrain.waterLevel : null; },
      get colliders() { return self.populated ? self.populated.colliders : []; },
      get creatures() { return self.creatures; },
    };
    this.scene.add(this.player.group);
    this.player.attachInput(this.renderer.domElement);

    this.ui = new UI(
      () => this.player,
      () => this.inventory,
      () => this.region,
      () => this.codex,
      () => this.history,
      () => this.ledger,
      () => [...this.visitedRegions.values()],
      () => this.nearCampfire(),
    );
    this.bindKeys();
    this.loadRegion(this.depth, true);
    this.running = true;
    document.getElementById("title-screen")!.style.display = "none";
    this.renderer.domElement.addEventListener("click", () => {
      if (!this.ui.activePanel && !this.player.dead) {
        try {
          const p = this.renderer.domElement.requestPointerLock() as unknown as Promise<void> | undefined;
          p?.catch?.(() => {});
        } catch { /* pointer lock unavailable (iframe/headless) — mouse-look off */ }
      }
    });
    window.addEventListener("player-death", ((e: CustomEvent) => this.onDeath(e.detail)) as EventListener);
    this.loop();
  }

  private bindKeys() {
    window.addEventListener("keydown", (e) => {
      if (!this.running) return;
      if (e.code === "KeyI") this.ui.toggleInventory();
      if (e.code === "KeyJ") this.ui.toggleCodex();
      if (e.code === "KeyC") this.tryCamp();
      if (e.code === "KeyE") {
        if (this.ui.activePanel === "panel-doc") this.ui.closeAll();
        else if (!this.ui.activePanel) this.interact();
      }
      if (e.code === "Escape") this.ui.closeAll();
    });
  }

  // ---------------------------------------------------------------- regions ----

  loadRegion(depth: number, announce = true) {
    if (this.regionGroup) {
      this.scene.remove(this.regionGroup);
      this.regionGroup.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
      });
    }
    this.depth = depth;
    const region = this.visitedRegions.get(depth) ?? generateRegion(this.history, depth);
    this.visitedRegions.set(depth, region);
    if (!this.codex.regionsVisited.includes(depth)) this.codex.regionsVisited.push(depth);
    this.region = region;
    this.terrain = buildTerrain(region);
    this.populated = populate(region, this.terrain, this.ledger);

    this.regionGroup = new THREE.Group();
    this.regionGroup.add(this.terrain.group, this.populated.group);
    this.scene.add(this.regionGroup);

    // Atmosphere.
    this.scene.fog = new THREE.FogExp2(region.fogColor, 0.011 + Math.min(0.02, depth * 0.0004));
    this.scene.background = new THREE.Color(region.fogColor);
    this.ambient.intensity = region.ambientLight * 1.1;
    this.hemi.intensity = region.ambientLight * 0.8;

    // Creatures.
    this.creatures = [];
    const cb = {
      onPlayerHit: (dmg: number, by: string) => this.player.damage(dmg, `the ${by}`),
      onObserve: (id: string, amt: number) => {
        const before = this.codex.speciesSeen[id] ?? 0;
        this.codex.speciesSeen[id] = before + amt;
        const lvlB = Math.floor(before >= 6 ? 3 : before >= 3 ? 2 : before >= 1 ? 1 : 0);
        const after = this.codex.speciesSeen[id];
        const lvlA = Math.floor(after >= 6 ? 3 : after >= 3 ? 2 : after >= 1 ? 1 : 0);
        if (lvlA > lvlB) {
          const sp = region.species.find((s) => s.id === id);
          if (sp) this.ui.toast(`bestiary: the ${sp.name} — ${["sighted", "now observed", "now studied", "now understood"][lvlA]}`, true);
        }
      },
      onDeath: (c: Creature) => this.onCreatureDeath(c),
    };
    for (const sp of this.populated.spawns) {
      const c = new Creature(sp.id, sp.species, sp.pos, (x, z) => this.terrain!.heightAt(x, z), cb);
      this.creatures.push(c);
      this.regionGroup.add(c.mesh);
      if (!(sp.species.id in this.codex.speciesSeen)) this.codex.speciesSeen[sp.species.id] = 0.1;
    }
    // The legend, if it is at this depth and still alive.
    const legend = region.legends[0];
    if (legend && !this.ledger.has(`legend-slain:${legend.id}`)) {
      const lr = rngFor(this.seed, "legendspawn:" + depth);
      const sp: Species = {
        id: legend.id, name: `${legend.name}, ${legend.title}`, localName: null,
        plan: {
          size: 4.2, elongation: 2.6, legs: 6, eyes: 0, glow: true, glowColor: 0x88ffff,
          armor: 0.7, color: 0x223030, locomotion: "walker",
        },
        diet: "predator", habitat: "wherever it is going", foodDesc: "everything; that is the problem",
        preyIds: [], predatorIds: [],
        behavior: "it does not stalk. It walks toward you as if you had an appointment",
        reproduction: "none observed; perhaps it is the last", weakness: "aether-light sears it",
        weaknessKind: "light", hp: 900, damage: 34, speed: 3.1, aggro: 1, fleesLight: false,
      };
      const pos = new THREE.Vector3(lr.range(-60, 60), 0, lr.range(-60, 60));
      pos.y = this.terrain.heightAt(pos.x, pos.z);
      const c = new Creature("legend", sp, pos, (x, z) => this.terrain!.heightAt(x, z), cb);
      this.creatures.push(c);
      this.regionGroup.add(c.mesh);
      this.ui.toast(`Something here has emptied the food web. The locals call it ${sp.name}.`, true);
    }

    // Settlement fires count as camps; forget player fires from other floors.
    this.campfires = [];
    for (const i of this.populated.interactables) {
      if (i.kind === "npc") this.campfires.push(i.pos.clone());
    }

    // Place player facing into the region (away from the up-gate).
    this.player.group.position.copy(this.populated.spawnPoint);
    this.player.velocity.set(0, 0, 0);
    this.player.yaw = Math.PI;

    this.ui.setRegionPlate(region);
    if (announce) {
      this.ui.showTransition(depth, region.name, region.epithet, region.purpose);
      if (region.rivers.length) {
        const rv = region.rivers[0];
        const seenBefore = rv.depths.some((d) => d < depth && this.codex.regionsVisited.includes(d));
        if (seenBefore) this.ui.toast(`This water is ${rv.name} again — the same river you met above. It goes deeper still.`, true);
      }
    }
    // World moved while you traveled.
    this.ledger.propagate(this.gameTime, this.history);
    for (const n of this.ledger.takeNews()) this.ui.toast("◆ " + n, true);
    this.save();
  }

  private onCreatureDeath(c: Creature) {
    this.ledger.set(`slain:${this.depth}:${c.id}`, this.gameTime);
    this.inventory.add("meat", 1);
    this.inventory.add("bone", 2);
    this.ui.toast(`the ${c.species.name} is dead — meat and bone taken`);
    this.codex.speciesSeen[c.species.id] = (this.codex.speciesSeen[c.species.id] ?? 0) + 2;
    if (c.id === "legend" && this.region) {
      const legend = this.region.legends[0];
      if (legend) {
        this.ledger.set(`legend-slain:${legend.id}`, this.gameTime);
        this.ledger.addEvent(this.gameTime, this.depth,
          `${legend.name}, ${legend.title}, is dead at depth ${this.depth} — by a climber from the surface. The species it suppressed will bloom; the cultures that prayed against it must find something else to fear.`);
        this.ui.toast(`You have killed ${legend.name}. The Abyss will reorganize around this.`, true);
      }
    }
    if (c.species.diet === "predator" && c.id !== "legend") {
      const alive = this.creatures.some((x) => x !== c && x.species.id === c.species.id && x.state !== "dead");
      if (!alive) this.ledger.set(`predator-gone:${this.depth}`, this.gameTime, c.species.id);
    }
  }

  // ------------------------------------------------------------- interaction ----

  private nearestInteractable(): Interactable | null {
    if (!this.populated) return null;
    const p = this.player.group.position;
    let best: Interactable | null = null;
    let bd = Infinity;
    for (const i of this.populated.interactables) {
      const d = i.pos.distanceTo(p);
      if (d < i.radius + 0.8 && d < bd) { bd = d; best = i; }
    }
    return best;
  }

  private canDrink(): boolean {
    if (!this.terrain || this.terrain.waterLevel === null) return false;
    const p = this.player.group.position;
    return p.y < this.terrain.waterLevel + 1.5;
  }

  private interact() {
    const it = this.nearestInteractable();
    if (!it) {
      if (this.canDrink()) {
        this.player.thirst = 100;
        this.ui.toast("you drink — the water is mineral and very cold");
      }
      return;
    }
    switch (it.kind) {
      case "doc": {
        const doc = it.doc!;
        this.ui.showDoc(doc);
        if (!this.codex.docsRead.includes(doc.id)) {
          this.codex.docsRead.push(doc.id);
          this.codex.docsMeta.push({ id: doc.id, title: doc.title, body: doc.body, source: doc.source, depth: this.depth });
          if (doc.civId && !this.codex.civsMet.includes(doc.civId)) {
            this.codex.civsMet.push(doc.civId);
            const civ = this.history.civById(doc.civId);
            if (civ) this.ui.toast(`codex: the ${civ.demonym} enter your reconstruction`, true);
          }
        }
        break;
      }
      case "npc": {
        this.ui.showNpc(it.npcText!.name, it.npcText!.lines);
        const civId = this.region?.settlement?.civId;
        if (civId && !this.codex.civsMet.includes(civId)) {
          this.codex.civsMet.push(civId);
          this.ui.toast("codex: a living people enters your reconstruction", true);
        }
        break;
      }
      case "resource": {
        if (this.inventory.add(it.resource!, 1)) {
          this.ledger.set(`harvested:${this.depth}:${it.id.split(":")[2]}`, this.gameTime);
          it.object?.parent?.remove(it.object);
          this.populated!.interactables = this.populated!.interactables.filter((x) => x !== it);
          this.ui.toast(`+1 ${it.resource}`);
        } else this.ui.toast("pack too heavy — drop or use something first");
        break;
      }
      case "chest":
      case "camp-remnant": {
        for (const l of it.loot ?? []) {
          if (this.inventory.add(l.item, l.qty)) this.ui.toast(`+${l.qty} ${l.item}`);
          else this.ui.toast(`pack too heavy for the ${l.item}`);
        }
        this.ledger.set(`looted:${it.id}`, this.gameTime);
        this.populated!.interactables = this.populated!.interactables.filter((x) => x !== it);
        break;
      }
      case "seal": {
        this.ledger.set(`seal-open:${this.depth}`, this.gameTime);
        if (this.region && this.region.legends.length)
          this.ledger.set(`legend-freed:${this.depth}`, this.gameTime);
        it.object?.parent?.remove(it.object);
        this.populated!.interactables = this.populated!.interactables.filter((x) => x !== it);
        this.populated!.colliders = this.populated!.colliders.filter(
          (c) => Math.abs((c.min.x + c.max.x) / 2 - it.pos.x) > 4 || Math.abs((c.min.z + c.max.z) / 2 - it.pos.z) > 4,
        );
        this.ui.toast("The poured stone cracks and falls inward. Air moves through that has not moved in centuries.", true);
        this.ui.toast("Whatever was closed is now open. This will propagate.");
        break;
      }
      case "gate-down": {
        this.confirmDescent();
        break;
      }
      case "gate-up": {
        if (this.depth <= 1) this.surfaceCamp();
        else this.loadRegion(this.depth - 1);
        break;
      }
    }
  }

  private confirmDescent() {
    const inv = this.inventory;
    const p = this.player;
    const worries: string[] = [];
    const food = ["rations", "old rations", "spore-bread", "blindfish"].reduce((s, n) => s + inv.count(n), 0);
    const water = ["waterskin", "fresh water", "cistern water"].reduce((s, n) => s + inv.count(n), 0);
    const oil = inv.count("torch oil");
    if (food < 2) worries.push(`food for ${food} meals`);
    if (water < 2) worries.push(`${water} skins of water`);
    if (oil < 2 && p.torchFuel < 50) worries.push(`${oil} flasks of oil`);
    if (p.hp < 50) worries.push("open wounds");
    if (p.injury) worries.push("a wrenched leg");
    this.ui.showCamp({
      title: `The stair to depth ${this.depth + 1}`,
      sub: worries.length
        ? `You are carrying: ${worries.join(", ")}. People who descend like this feed the ecosystem.`
        : "Your pack is in order. The air rising from below is older than your language.",
      actions: [
        { label: "Descend", desc: "commit to the deeper floor", fn: () => { this.ui.closeAll(); this.loadRegion(this.depth + 1); } },
        { label: "Stay", desc: "prepare a little longer", fn: () => this.ui.closeAll() },
      ],
    });
  }

  private surfaceCamp() {
    this.ui.showCamp({
      title: "The surface camp",
      sub: "Rope, canvas, other people's voices. The last place on the map.",
      actions: [
        {
          label: "Resupply the expedition", desc: "standard kit: rations, water, oil, arrows, bandages",
          fn: () => {
            const gave = surfaceResupply(this.inventory);
            this.ui.toast(gave.length ? "resupplied: " + gave.join(", ") : "your pack is already full-kitted");
          },
        },
        {
          label: "Sleep in a real bed", desc: "full recovery; the world below keeps moving",
          fn: () => { this.rest(true); },
        },
        {
          label: "Sell artifacts", desc: "surface collectors pay in supplies (artifacts convert to rations+oil)",
          fn: () => {
            let sold = 0;
            for (const [n, q] of Object.entries({ ...this.inventory.items })) {
              if (ITEMS[n]?.type === "artifact" || n.includes("(")) {
                this.inventory.remove(n, q); sold += q;
              }
            }
            if (sold) {
              this.inventory.add("rations", sold);
              this.inventory.add("torch oil", sold);
              this.ui.toast(`sold ${sold} artifact${sold > 1 ? "s" : ""} — the buyers ask no questions you could answer`);
            } else this.ui.toast("nothing here the collectors want");
          },
        },
        { label: "Back to the pit", desc: "the only direction that matters", fn: () => this.ui.closeAll() },
      ],
    });
    this.campDepth = 1;
    this.save();
  }

  private nearCampfire(): boolean {
    const p = this.player.group.position;
    return this.campfires.some((c) => c.distanceTo(p) < 7);
  }

  private tryCamp() {
    if (this.ui.activePanel) return;
    if (!this.inventory.count("camp kit")) { this.ui.toast("no camp kit — you cannot rest safely here"); return; }
    const pos = this.player.group.position.clone();
    if (!this.campfires.some((c) => c.distanceTo(pos) < 6)) {
      const { campfireProp } = awaitStructures();
      const fire = campfireProp(true);
      fire.position.copy(pos).add(new THREE.Vector3(1.2, 0, 0));
      fire.position.y = this.terrain!.heightAt(fire.position.x, fire.position.z);
      this.regionGroup!.add(fire);
      this.campfires.push(fire.position.clone());
    }
    this.campDepth = this.depth;
    this.ui.showCamp({
      title: `Camp at depth ${this.depth}`,
      sub: "The fire makes a small room out of the dark. Everything outside it is still there.",
      actions: [
        {
          label: "Rest until mended", desc: "8 hours; heals, restores, eats 1 meal + 1 water; the world propagates",
          fn: () => this.rest(false),
        },
        { label: "Cook and craft", desc: "open the pack with the fire lit", fn: () => { this.ui.toggleInventory(); } },
        { label: "Break camp", desc: "back into the dark", fn: () => this.ui.closeAll() },
      ],
    });
  }

  private rest(surface: boolean) {
    const p = this.player;
    const ate = this.inventory.remove("rations", 1) || this.inventory.remove("spore-bread", 1) || this.inventory.remove("old rations", 1) || this.inventory.remove("blindfish", 1);
    const drank = this.inventory.remove("waterskin", 1) || this.inventory.remove("fresh water", 1) || this.inventory.remove("cistern water", 1);
    this.gameTime += 8;
    p.hp = surface ? p.maxHp : Math.min(p.maxHp, p.hp + (ate ? 55 : 25));
    p.stamina = 100;
    p.mana = p.maxMana;
    p.hunger = ate ? 100 : Math.max(10, p.hunger - 15);
    p.thirst = drank ? 100 : Math.max(5, p.thirst - 20);
    if (p.injury && (surface || Math.random() < 0.5)) { p.injury = null; this.ui.toast("the leg has knit well enough"); }
    if (!ate && !surface) this.ui.toast("you slept hungry — the healing is shallow");
    this.ledger.propagate(this.gameTime, this.history);
    const news = this.ledger.takeNews();
    this.ui.closeAll();
    this.ui.toast(surface ? "You slept above the pit. You dreamed of it anyway." : "The fire holds. You wake in the same dark, mended.");
    for (const n of news) this.ui.toast("◆ " + n, true);
    this.save();
  }

  private onDeath(cause: string) {
    document.exitPointerLock?.();
    const el = document.getElementById("death-screen")!;
    el.style.display = "flex";
    document.getElementById("death-cause")!.textContent = `Taken by ${cause}, at depth ${this.depth}.`;
    document.getElementById("btn-respawn")!.onclick = () => {
      el.style.display = "none";
      // The fall costs half of every consumable stack.
      for (const [n, q] of Object.entries({ ...this.inventory.items })) {
        if (ITEMS[n]?.type !== "tool") this.inventory.remove(n, Math.floor(q / 2));
      }
      const p = this.player;
      p.dead = false;
      p.hp = p.maxHp * 0.6; p.stamina = 60; p.hunger = Math.max(30, p.hunger); p.thirst = Math.max(30, p.thirst);
      this.gameTime += 16;
      this.loadRegion(this.campDepth);
      this.ui.toast("You wake at your last camp, lighter by half your supplies. The Abyss kept the rest.", true);
    };
  }

  // ------------------------------------------------------------------ save ----

  save() {
    const p = this.player;
    saveGame({
      seed: this.seed, gameTime: this.gameTime, depth: this.depth, campDepth: this.campDepth,
      hp: p.hp, stamina: p.stamina, mana: p.mana, hunger: p.hunger, thirst: p.thirst,
      torchFuel: p.torchFuel, injury: p.injury,
      inventory: { ...this.inventory.items },
      equipped: { weapon: p.weapon, armor: null },
      ledgerFlags: this.ledger.flags, dynamicEvents: this.ledger.dynamicEvents,
      codex: this.codex,
    });
  }

  // ------------------------------------------------------------------ loop ----

  private loop = () => {
    requestAnimationFrame(this.loop);
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    if (!this.running) return;

    if (!this.ui.activePanel && !this.player.dead) {
      this.gameTime += dt / 40; // ~40 real seconds per game-hour
      this.player.update(dt);
      const torch = this.player.torchOn;
      for (const c of this.creatures) {
        c.update(dt, this.player.group.position, torch, this.player.blocking);
      }
      // Interaction prompt.
      const it = this.nearestInteractable();
      this.ui.prompt(it ? it.prompt : this.canDrink() ? "drink from the dark water" : null);
      this.ui.setLockHint(document.pointerLockElement !== this.renderer.domElement);
    } else {
      this.ui.setLockHint(false);
      this.ui.prompt(null);
    }
    this.ui.setWeapon(this.player.weapon);
    this.ui.updateHUD();
    this.renderer.render(this.scene, this.camera);
  };
}

// Structures import indirection (campfire only needed lazily in main).
import { campfireProp } from "./world/structures";
function awaitStructures() { return { campfireProp }; }

// ---------------------------------------------------------------- title ----

const game = new Game();
// Dev hook for automated smoke-driving; harmless in play.
(window as unknown as { __abyss: Game }).__abyss = game;
const saved = loadGame();
if (saved) {
  const btn = document.getElementById("btn-continue")!;
  btn.style.display = "inline-block";
  btn.onclick = () => game.continueGame(saved);
}
document.getElementById("btn-descend")!.onclick = () => {
  const input = (document.getElementById("seed-input") as HTMLInputElement).value.trim();
  const seed = input || `abyss-${Math.floor(Math.random() * 1e9).toString(36)}`;
  game.newGame(seed);
};
