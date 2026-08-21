// Deterministic seeded RNG. Every generated fact in the world flows from one of these,
// keyed by (worldSeed, namespace) so any region/civ/creature regenerates identically.

export function hashString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export class RNG {
  private s: number;
  constructor(seed: number | string) {
    this.s = (typeof seed === "string" ? hashString(seed) : seed >>> 0) || 1;
  }
  /** mulberry32 */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }
  int(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1));
  }
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }
  pickN<T>(arr: readonly T[], n: number): T[] {
    const pool = [...arr];
    const out: T[] = [];
    while (out.length < n && pool.length > 0) {
      out.push(pool.splice(Math.floor(this.next() * pool.length), 1)[0]);
    }
    return out;
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  /** Weighted pick from [item, weight] pairs. */
  weighted<T>(pairs: readonly (readonly [T, number])[]): T {
    let total = 0;
    for (const [, w] of pairs) total += w;
    let r = this.next() * total;
    for (const [item, w] of pairs) {
      if (w <= 0) continue;
      r -= w;
      if (r <= 0) return item;
    }
    return pairs[pairs.length - 1][0];
  }
  fork(ns: string): RNG {
    return new RNG(hashString(ns) ^ this.s);
  }
}

export function rngFor(worldSeed: string, ns: string): RNG {
  return new RNG(hashString(worldSeed + "::" + ns));
}
