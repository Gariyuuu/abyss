// Terrain: a seeded heightfield floor, cavern ceiling, water (seas + rivers that
// visibly enter and exit the map, matching the History's river records), and the
// glow-flora of the region's ecosystem.

import * as THREE from "three";
import { RNG, rngFor, hashString } from "../core/rng";
import { Region } from "../gen/regions";

export interface TerrainData {
  group: THREE.Group;
  heightAt: (x: number, z: number) => number;
  waterLevel: number | null;
  riverPath: ((t: number) => { x: number; z: number }) | null;
  size: number;
}

function makeNoise(seed: string) {
  const base = hashString(seed);
  const grid = (ix: number, iz: number) => {
    let h = (base ^ Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263)) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const smooth = (t: number) => t * t * (3 - 2 * t);
  const value = (x: number, z: number) => {
    const ix = Math.floor(x), iz = Math.floor(z);
    const fx = smooth(x - ix), fz = smooth(z - iz);
    const a = grid(ix, iz), b = grid(ix + 1, iz), c = grid(ix, iz + 1), d = grid(ix + 1, iz + 1);
    return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
  };
  return (x: number, z: number, octaves = 4) => {
    let amp = 1, freq = 1, sum = 0, norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += value(x * freq, z * freq) * amp;
      norm += amp;
      amp *= 0.5; freq *= 2.1;
    }
    return sum / norm;
  };
}

export function buildTerrain(region: Region): TerrainData {
  const group = new THREE.Group();
  const size = region.size;
  const half = size / 2;
  const noise = makeNoise(region.history.seed + ":terr:" + region.depth);
  const rng = rngFor(region.history.seed, "terrshape:" + region.depth);

  const rough =
    region.kind === "cavern" ? 14 : region.kind === "volcanic" ? 10 :
    region.kind === "crystal" ? 8 : region.kind === "ocean" ? 9 :
    region.kind === "city" || region.kind === "fortress" || region.kind === "temple" ? 2.5 : 6;

  // Ocean: one side of the map drops below water. River: a winding channel.
  const oceanDir = rng.chance(0.5) ? 1 : -1;
  const hasOcean = region.kind === "ocean";
  const river = region.rivers.length > 0 && !hasOcean ? region.rivers[0] : null;
  const rPhase = rng.range(0, Math.PI * 2), rAmp = rng.range(30, 80), rFreq = rng.range(0.008, 0.016);
  const riverCurve = (z: number) => Math.sin(z * rFreq * Math.PI * 2 + rPhase) * rAmp;

  const heightAt = (x: number, z: number): number => {
    const cx = Math.max(-half, Math.min(half, x));
    const cz = Math.max(-half, Math.min(half, z));
    let h = (noise(cx / 60 + 100, cz / 60 + 100) - 0.5) * 2 * rough;
    // Bowl the edges up into cavern walls.
    const edge = Math.max(Math.abs(cx), Math.abs(cz)) / half;
    if (edge > 0.82) h += Math.pow((edge - 0.82) / 0.18, 2) * 55;
    if (hasOcean) {
      const t = (cx * oceanDir + half) / size; // 0 shore side .. 1 sea side
      if (t > 0.45) h -= (t - 0.45) * 40;
    }
    if (river) {
      const d = Math.abs(cx - riverCurve(cz));
      if (d < 16) h -= (1 - d / 16) * 7.5;
    }
    return h;
  };

  const seg = 96;
  const geo = new THREE.PlaneGeometry(size, size, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const gc = new THREE.Color(region.groundColor);
  const fc = new THREE.Color(region.floraColor);
  const tint = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const h = heightAt(x, z);
    pos.setY(i, h);
    const n = noise(x / 25 + 7, z / 25 + 7);
    tint.copy(gc).multiplyScalar(0.75 + n * 0.5);
    if (n > 0.62 && region.kind !== "volcanic") tint.lerp(fc, (n - 0.62) * 0.9); // flora carpets
    colors[i * 3] = tint.r; colors[i * 3 + 1] = tint.g; colors[i * 3 + 2] = tint.b;
  }
  geo.computeVertexNormals();
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const ground = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0.02 }),
  );
  ground.receiveShadow = true;
  ground.name = "ground";
  group.add(ground);

  // Water.
  let waterLevel: number | null = null;
  if (hasOcean) {
    waterLevel = -3.5;
  } else if (river) {
    waterLevel = -3.2;
  }
  if (waterLevel !== null) {
    const wgeo = new THREE.PlaneGeometry(size, size);
    wgeo.rotateX(-Math.PI / 2);
    const water = new THREE.Mesh(
      wgeo,
      new THREE.MeshStandardMaterial({
        color: hasOcean ? 0x0d2233 : 0x14303a, transparent: true, opacity: 0.82,
        roughness: 0.15, metalness: 0.4, emissive: 0x06121a, emissiveIntensity: 0.6,
      }),
    );
    water.position.y = waterLevel;
    water.name = "water";
    group.add(water);
  }

  // Ceiling with stalactites (skipped visually for very tall shafts).
  const ceilH = region.ceilingHeight;
  const cgeo = new THREE.PlaneGeometry(size * 1.05, size * 1.05, 48, 48);
  cgeo.rotateX(Math.PI / 2);
  const cpos = cgeo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < cpos.count; i++) {
    const x = cpos.getX(i), z = cpos.getZ(i);
    cpos.setY(i, ceilH + (noise(x / 40 - 50, z / 40 - 50) - 0.5) * ceilH * 0.4);
  }
  cgeo.computeVertexNormals();
  const ceiling = new THREE.Mesh(
    cgeo,
    new THREE.MeshStandardMaterial({ color: new THREE.Color(region.groundColor).multiplyScalar(0.55), roughness: 1 }),
  );
  group.add(ceiling);

  const stalMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(region.groundColor).multiplyScalar(0.7), roughness: 1 });
  const stalGeo = new THREE.ConeGeometry(1, 1, 5);
  const stalCount = region.kind === "cavern" ? 90 : 40;
  const stal = new THREE.InstancedMesh(stalGeo, stalMat, stalCount);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3();
  q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI);
  for (let i = 0; i < stalCount; i++) {
    const x = rng.range(-half * 0.9, half * 0.9), z = rng.range(-half * 0.9, half * 0.9);
    const len = rng.range(3, ceilH * 0.35), r = len * rng.range(0.12, 0.22);
    p.set(x, ceilH * 0.85 - len / 2 + rng.range(-4, 4), z);
    sc.set(r, len, r);
    m.compose(p, q, sc);
    stal.setMatrixAt(i, m);
  }
  group.add(stal);

  // Glow flora (glowcaps / crystals / vents) — the region's actual named flora.
  addGlowFlora(group, region, heightAt, rng);

  // Lava channels for volcanic regions: an emissive plane low in the bowl.
  if (region.kind === "volcanic") {
    const lgeo = new THREE.PlaneGeometry(size * 0.5, size * 0.5);
    lgeo.rotateX(-Math.PI / 2);
    const lava = new THREE.Mesh(
      lgeo,
      new THREE.MeshStandardMaterial({
        color: 0x331008, emissive: 0xff3a08, emissiveIntensity: 1.4, roughness: 0.9,
      }),
    );
    lava.position.y = -6.2;
    group.add(lava);
    const glow = new THREE.PointLight(0xff4a12, 120, 120, 1.6);
    glow.position.set(0, 2, 0);
    group.add(glow);
  }

  return {
    group, heightAt, waterLevel,
    riverPath: river ? (t: number) => ({ x: riverCurve(-half + t * size), z: -half + t * size }) : null,
    size,
  };
}

function addGlowFlora(
  group: THREE.Group, region: Region,
  heightAt: (x: number, z: number) => number, rng: RNG,
) {
  const half = region.size / 2;
  const count =
    region.kind === "fungal" ? 160 : region.kind === "crystal" ? 120 :
    region.kind === "volcanic" ? 60 : 60;

  let geo: THREE.BufferGeometry;
  let emissive: number = region.floraColor;
  if (region.kind === "crystal") {
    geo = new THREE.OctahedronGeometry(1, 0);
  } else if (region.kind === "volcanic") {
    geo = new THREE.CylinderGeometry(0.15, 0.5, 1, 5);
    emissive = 0xff5a22;
  } else {
    // mushroom: stem+cap merged approximation via cone
    geo = new THREE.ConeGeometry(0.9, 1, 7);
  }
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(region.floraColor).multiplyScalar(0.6),
    emissive, emissiveIntensity: region.kind === "crystal" ? 0.9 : 0.65,
    roughness: 0.7,
  });
  const inst = new THREE.InstancedMesh(geo, mat, count);
  inst.name = "flora";
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3();
  const e = new THREE.Euler();
  for (let i = 0; i < count; i++) {
    const x = rng.range(-half * 0.85, half * 0.85), z = rng.range(-half * 0.85, half * 0.85);
    const y = heightAt(x, z);
    if (y < -3) { // don't grow under water
      inst.setMatrixAt(i, m.makeScale(0, 0, 0));
      continue;
    }
    const s = region.kind === "crystal" ? rng.range(0.8, 4.5) : rng.range(0.5, region.kind === "fungal" ? 6 : 2);
    e.set(0, rng.range(0, Math.PI * 2), 0);
    q.setFromEuler(e);
    p.set(x, y + s * 0.45, z);
    sc.set(s * 0.5, s, s * 0.5);
    m.compose(p, q, sc);
    inst.setMatrixAt(i, m);
  }
  group.add(inst);

  // A few real point lights among the flora so glow actually lights the ground.
  const lightCount = Math.min(6, Math.floor(count / 25));
  for (let i = 0; i < lightCount; i++) {
    const x = rng.range(-half * 0.7, half * 0.7), z = rng.range(-half * 0.7, half * 0.7);
    const y = heightAt(x, z);
    if (y < -3) continue;
    const l = new THREE.PointLight(emissive, region.kind === "crystal" ? 40 : 25, 38, 1.8);
    l.position.set(x, y + 3, z);
    group.add(l);
  }
}
