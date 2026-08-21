// Architecture. Buildings are parameterized by a civilization's ArchStyle, so a
// daughter-culture's ruins visibly rhyme with the parent's (same arch shape and
// motif, drifted palette) — cultural relationships you can read from geometry.

import * as THREE from "three";
import { RNG } from "../core/rng";
import { ArchStyle, Civ } from "../gen/history";

export interface AABB { min: THREE.Vector3; max: THREE.Vector3 }

export interface Built {
  group: THREE.Group;
  colliders: AABB[];
}

function mat(color: number, rough = 0.9): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0.05 });
}

function box(w: number, h: number, d: number, color: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
  m.castShadow = m.receiveShadow = true;
  return m;
}

/** One building in a civ's style; `ruin` 0 = rubble, 1 = intact. */
export function building(style: ArchStyle, rng: RNG, ruin: number): Built {
  const g = new THREE.Group();
  const colliders: AABB[] = [];
  const w = rng.range(5, 11), d = rng.range(5, 11);
  const fullH = rng.range(4, 8);
  const h = Math.max(1.2, fullH * (0.35 + ruin * 0.65) * rng.range(0.8, 1.1));
  const wallT = 0.6;
  const c = style.palette;

  // Four walls, possibly partially collapsed.
  const walls: [number, number, number, number, number][] = [
    [0, -d / 2, w, wallT, 0], [0, d / 2, w, wallT, 0],
    [-w / 2, 0, wallT, d, 1], [w / 2, 0, wallT, d, 1],
  ];
  for (const [x, z, ww, dd] of walls) {
    const wh = Math.max(1, h * rng.range(ruin * 0.7 + 0.3, 1));
    const wall = box(ww, wh, dd, c);
    wall.position.set(x, wh / 2, z);
    g.add(wall);
    colliders.push({
      min: new THREE.Vector3(x - ww / 2, 0, z - dd / 2),
      max: new THREE.Vector3(x + ww / 2, wh, z + dd / 2),
    });
  }
  // Doorway: knock a gap in the front wall with the culture's arch shape hinted by a lintel.
  const doorW = 1.6;
  const door = box(doorW + 0.4, 0.5, wallT + 0.2, style.trim);
  door.position.set(0, Math.min(h, 2.6), -d / 2);
  g.add(door);
  if (style.arch === "pointed") door.rotation.z = 0.0, door.scale.y = 1.6;
  if (style.arch === "trapezoid") door.scale.x = 1.4;

  // Roof if intact enough.
  if (ruin > 0.65 && rng.chance(ruin)) {
    const roof = box(w + 0.6, 0.5, d + 0.6, style.trim);
    roof.position.y = h + 0.25;
    g.add(roof);
  }
  // Columns flanking the door for grander styles.
  if (style.column !== "plain" && rng.chance(0.6)) {
    for (const sx of [-1, 1]) {
      const col = new THREE.Mesh(
        style.column === "spiral"
          ? new THREE.CylinderGeometry(0.32, 0.4, h, 6)
          : new THREE.CylinderGeometry(0.35, 0.35, h, style.column === "fluted" ? 12 : 8),
        mat(style.trim),
      );
      col.position.set(sx * (doorW / 2 + 0.8), h / 2, -d / 2 - 0.8);
      g.add(col);
    }
  }
  // Rubble at the base of ruins.
  if (ruin < 0.6) {
    const n = rng.int(3, 7);
    for (let i = 0; i < n; i++) {
      const r = rng.range(0.4, 1.2);
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(r, 0), mat(c, 1));
      rock.position.set(rng.range(-w / 2, w / 2), r * 0.5, rng.range(-d / 2, d / 2));
      rock.rotation.set(rng.next() * 3, rng.next() * 3, rng.next() * 3);
      g.add(rock);
    }
  }
  return { group: g, colliders };
}

/** Monument: obelisk/stele carrying the civ's motif — interactable inscription anchor. */
export function monument(style: ArchStyle, rng: RNG): Built {
  const g = new THREE.Group();
  const h = rng.range(5, 10);
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.4, h, 4), mat(style.palette));
  shaft.position.y = h / 2 + 0.6;
  shaft.rotation.y = Math.PI / 4;
  g.add(shaft);
  const base = box(3.4, 1.2, 3.4, style.trim);
  base.position.y = 0.6;
  g.add(base);
  const glyph = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.12, 6, 16), mat(style.trim, 0.5));
  glyph.position.y = h * 0.75;
  g.add(glyph);
  return {
    group: g,
    colliders: [{ min: new THREE.Vector3(-1.7, 0, -1.7), max: new THREE.Vector3(1.7, h, 1.7) }],
  };
}

export function graveMarker(style: ArchStyle | null, rng: RNG): THREE.Group {
  const g = new THREE.Group();
  const h = rng.range(0.8, 1.6);
  const stone = box(0.7, h, 0.25, style ? style.palette : 0x777770);
  stone.position.y = h / 2;
  stone.rotation.y = rng.range(-0.3, 0.3);
  stone.rotation.z = rng.range(-0.15, 0.15);
  g.add(stone);
  return g;
}

/** Mural wall: canvas-textured panel; the visual echoes the event type. */
export function muralWall(style: ArchStyle, seedText: string, eventType: string | null): Built {
  const g = new THREE.Group();
  const w = 7, h = 4;
  const canvas = document.createElement("canvas");
  canvas.width = 512; canvas.height = 296;
  const ctx = canvas.getContext("2d")!;
  const base = new THREE.Color(style.palette);
  ctx.fillStyle = `rgb(${(base.r * 200) | 0},${(base.g * 200) | 0},${(base.b * 200) | 0})`;
  ctx.fillRect(0, 0, 512, 296);
  // Simple procedural fresco: bands + figures + motif row, deterministic per seedText.
  let s = 0;
  for (let i = 0; i < seedText.length; i++) s = (s * 31 + seedText.charCodeAt(i)) >>> 0;
  const rnd = () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296);
  if (eventType === "flood") {
    ctx.fillStyle = "rgba(20,40,70,0.85)";
    ctx.fillRect(0, 190, 512, 106);
  }
  if (eventType === "war" || eventType === "burning") {
    ctx.fillStyle = "rgba(140,40,30,0.5)";
    ctx.fillRect(0, 0, 512, 60);
  }
  ctx.fillStyle = "rgba(30,22,16,0.9)";
  const figures = 8 + Math.floor(rnd() * 10);
  for (let i = 0; i < figures; i++) {
    const x = 20 + rnd() * 470, y = 120 + rnd() * 90, fh = 34 + rnd() * 22;
    ctx.fillRect(x - 3, y, 6, fh);               // body
    ctx.beginPath(); ctx.arc(x, y - 6, 7, 0, 7); ctx.fill(); // head
  }
  // Motif frieze along the top.
  ctx.strokeStyle = "rgba(230,215,180,0.8)";
  ctx.lineWidth = 3;
  for (let x = 20; x < 500; x += 40) {
    ctx.beginPath();
    if (style.motif === "spiral") { for (let a = 0; a < 12; a++) { const r = a * 1.1; ctx.lineTo(x + Math.cos(a) * r, 30 + Math.sin(a) * r); } }
    else if (style.motif === "eye") { ctx.ellipse(x, 30, 12, 6, 0, 0, 7); }
    else if (style.motif === "stair") { ctx.moveTo(x - 12, 38); ctx.lineTo(x - 4, 38); ctx.lineTo(x - 4, 30); ctx.lineTo(x + 4, 30); ctx.lineTo(x + 4, 22); ctx.lineTo(x + 12, 22); }
    else if (style.motif === "wave") { ctx.moveTo(x - 12, 30); ctx.quadraticCurveTo(x - 6, 20, x, 30); ctx.quadraticCurveTo(x + 6, 40, x + 12, 30); }
    else if (style.motif === "root") { ctx.moveTo(x, 20); ctx.lineTo(x, 34); ctx.lineTo(x - 8, 42); ctx.moveTo(x, 34); ctx.lineTo(x + 8, 42); }
    else { ctx.moveTo(x, 40); ctx.lineTo(x - 7, 24); ctx.lineTo(x, 30); ctx.lineTo(x + 7, 24); ctx.closePath(); }
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const panel = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, 0.5),
    [mat(style.palette), mat(style.palette), mat(style.palette), mat(style.palette),
     new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 }), mat(style.palette)],
  );
  panel.position.y = h / 2;
  g.add(panel);
  return {
    group: g,
    colliders: [{ min: new THREE.Vector3(-w / 2, 0, -0.25), max: new THREE.Vector3(w / 2, h, 0.25) }],
  };
}

/** The poured-stone seal from a "sealing" event — visibly not part of the original wall. */
export function sealedDoor(rng: RNG): Built {
  const g = new THREE.Group();
  const frame = box(6, 7, 1.2, 0x5a5248);
  frame.position.y = 3.5;
  g.add(frame);
  const pour = new THREE.Mesh(new THREE.BoxGeometry(4.2, 5.6, 1.6), mat(0x8a857c, 1));
  pour.position.y = 2.8;
  // lumpy: poured, not fitted
  pour.scale.set(1, 1, 1);
  g.add(pour);
  for (let i = 0; i < 4; i++) {
    const drip = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.4, rng.range(0.5, 1.4), 5), mat(0x8a857c, 1));
    drip.position.set(rng.range(-1.8, 1.8), rng.range(0.2, 0.8), 0.8);
    g.add(drip);
  }
  return {
    group: g,
    colliders: [{ min: new THREE.Vector3(-3, 0, -0.8), max: new THREE.Vector3(3, 7, 0.8) }],
  };
}

/** Descent/ascent gate: the stair between floors. */
export function stairGate(down: boolean, civ: Civ | null, rng: RNG): Built {
  const g = new THREE.Group();
  const c = civ ? civ.arch.palette : 0x6a655c;
  const trim = civ ? civ.arch.trim : 0x54504a;
  for (const sx of [-1, 1]) {
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.8, 7, 8), mat(c));
    pillar.position.set(sx * 2.6, 3.5, 0);
    pillar.castShadow = true;
    g.add(pillar);
  }
  const lintel = box(6.8, 1, 1.6, trim);
  lintel.position.y = 7;
  g.add(lintel);
  // Dark throat with faint glow — up is warm, down is cold.
  const throat = new THREE.Mesh(
    new THREE.PlaneGeometry(4.4, 6.4),
    new THREE.MeshBasicMaterial({ color: down ? 0x02040a : 0x1a1206 }),
  );
  throat.position.set(0, 3.2, 0);
  g.add(throat);
  const glow = new THREE.PointLight(down ? 0x3355aa : 0xcc8833, 15, 18, 2);
  glow.position.set(0, 3, 1.5);
  g.add(glow);
  // Steps.
  for (let i = 0; i < 4; i++) {
    const step = box(4.4, 0.35, 1, trim);
    step.position.set(0, i * 0.35 + 0.17, 1.2 + i * (down ? 0.7 : -0.0) + 0.0);
    g.add(step);
  }
  return {
    group: g,
    colliders: [
      { min: new THREE.Vector3(-3.2, 0, -0.8), max: new THREE.Vector3(-2, 7, 0.8) },
      { min: new THREE.Vector3(2, 0, -0.8), max: new THREE.Vector3(3.2, 7, 0.8) },
    ],
  };
}

export function skeletonProp(rng: RNG): THREE.Group {
  const g = new THREE.Group();
  const bone = mat(0xd8d0c0, 0.8);
  const rib = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.05, 5, 10, Math.PI), bone.clone());
  for (let i = 0; i < 4; i++) {
    const r = rib.clone();
    r.position.set(0, 0.12, i * 0.16);
    r.rotation.set(0, 0, Math.PI);
    g.add(r);
  }
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), bone.clone());
  skull.position.set(rng.range(-0.2, 0.2), 0.14, -0.35);
  g.add(skull);
  const limb = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.5, 5), bone.clone());
  limb.rotation.z = Math.PI / 2;
  limb.position.set(0.3, 0.05, 0.35);
  g.add(limb);
  g.rotation.y = rng.range(0, Math.PI * 2);
  return g;
}

export function campfireProp(lit: boolean): THREE.Group {
  const g = new THREE.Group();
  const stoneM = mat(0x55504a, 1);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const st = new THREE.Mesh(new THREE.DodecahedronGeometry(0.16, 0), stoneM);
    st.position.set(Math.cos(a) * 0.55, 0.1, Math.sin(a) * 0.55);
    g.add(st);
  }
  for (let i = 0; i < 3; i++) {
    const log = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.8, 5), mat(0x4a3828, 1));
    log.rotation.set(Math.PI / 2.3, (i / 3) * Math.PI * 2, 0);
    log.position.y = 0.15;
    g.add(log);
  }
  if (lit) {
    const flame = new THREE.Mesh(
      new THREE.ConeGeometry(0.25, 0.7, 6),
      new THREE.MeshBasicMaterial({ color: 0xffaa33 }),
    );
    flame.position.y = 0.5;
    flame.name = "flame";
    g.add(flame);
    const light = new THREE.PointLight(0xff9933, 35, 26, 1.8);
    light.position.y = 1.2;
    light.name = "firelight";
    g.add(light);
  }
  return g;
}

export function chestProp(style: ArchStyle | null): THREE.Group {
  const g = new THREE.Group();
  const body = box(0.9, 0.5, 0.55, style ? style.palette : 0x6a5236);
  body.position.y = 0.25;
  g.add(body);
  const lid = box(0.94, 0.18, 0.6, style ? style.trim : 0x54402a);
  lid.position.y = 0.58;
  g.add(lid);
  return g;
}

export function docProp(kind: string): THREE.Group {
  const g = new THREE.Group();
  if (kind === "gravestone") return g; // rendered by graveMarker at call-site
  if (kind === "journal") {
    const book = box(0.36, 0.09, 0.28, 0x7a5a3a);
    book.position.y = 0.05;
    book.rotation.y = 0.6;
    g.add(book);
  } else {
    const tablet = box(0.6, 0.8, 0.12, 0x8a8378);
    tablet.position.y = 0.4;
    tablet.rotation.x = -0.12;
    g.add(tablet);
  }
  return g;
}
