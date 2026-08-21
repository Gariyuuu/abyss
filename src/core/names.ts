// Phonology-driven naming. Each culture rolls its own phoneme inventory and word shape,
// so a Tharnic fortress and a Tharnic king sound related, and a neighboring culture that
// descended from Tharn shares consonants but drifts its vowels.

import { RNG } from "./rng";

export interface Phonology {
  onsets: string[];
  vowels: string[];
  codas: string[];
  minSyl: number;
  maxSyl: number;
  apostropheChance: number;
  doubleVowelChance: number;
}

const ONSET_SETS = [
  ["th", "k", "kr", "v", "dr", "n", "m", "r", "kh", "z"],
  ["s", "sh", "t", "ts", "m", "n", "h", "y", "r", "k"],
  ["b", "g", "gr", "d", "br", "m", "ul", "or", "n", "v"],
  ["f", "fl", "l", "s", "w", "th", "el", "ir", "n", "c"],
  ["q", "x", "z", "zh", "j", "g", "d", "k", "t", "r"],
  ["p", "pl", "m", "mb", "n", "nd", "t", "k", "w", "s"],
  ["h", "hr", "sk", "st", "v", "vr", "g", "d", "o", "a"],
];
const VOWEL_SETS = [
  ["a", "e", "o", "u"],
  ["a", "i", "u", "ai"],
  ["e", "i", "y", "ei"],
  ["o", "u", "au", "a"],
  ["a", "o", "ia", "e"],
  ["u", "e", "uo", "i"],
];
const CODA_SETS = [
  ["n", "r", "l", "th", "s", ""],
  ["k", "n", "m", "", "", ""],
  ["sh", "l", "x", "n", "", ""],
  ["nd", "rk", "m", "r", "", ""],
  ["t", "s", "n", "", "", ""],
];

export function makePhonology(rng: RNG): Phonology {
  return {
    onsets: rng.pick(ONSET_SETS),
    vowels: rng.pick(VOWEL_SETS),
    codas: rng.pick(CODA_SETS),
    minSyl: rng.int(1, 2),
    maxSyl: rng.int(2, 3) + 1,
    apostropheChance: rng.chance(0.3) ? 0.18 : 0,
    doubleVowelChance: rng.chance(0.3) ? 0.15 : 0,
  };
}

/** A phonology that drifted from a parent culture: same consonants, shifted vowels. */
export function driftPhonology(parent: Phonology, rng: RNG): Phonology {
  return {
    ...parent,
    vowels: rng.pick(VOWEL_SETS),
    codas: rng.chance(0.5) ? rng.pick(CODA_SETS) : parent.codas,
    apostropheChance: rng.chance(0.5) ? parent.apostropheChance : 0,
  };
}

export function word(ph: Phonology, rng: RNG, sylOverride?: number): string {
  const syls = sylOverride ?? rng.int(ph.minSyl, ph.maxSyl);
  let out = "";
  for (let i = 0; i < syls; i++) {
    if (i > 0 && rng.chance(ph.apostropheChance)) out += "'";
    out += rng.pick(ph.onsets);
    let v = rng.pick(ph.vowels);
    if (rng.chance(ph.doubleVowelChance)) v += v[0];
    out += v;
    if (i === syls - 1 || rng.chance(0.35)) out += rng.pick(ph.codas);
  }
  out = out.replace(/(.)\1\1+/g, "$1$1");
  return out.charAt(0).toUpperCase() + out.slice(1);
}

export function personName(ph: Phonology, rng: RNG): string {
  return word(ph, rng);
}

export function placeName(ph: Phonology, rng: RNG): string {
  return word(ph, rng, rng.int(2, 3));
}

const REGION_EPITHETS: Record<string, string[]> = {
  fortress: ["the Last Rampart", "the Iron Silence", "the Broken Watch", "the Sealed Gate"],
  mine: ["the Hollowed Vein", "the Deep Delving", "the Echoing Shafts", "the Glittering Wound"],
  fungal: ["the Pale Garden", "the Breathing Dark", "the Sporefall", "the Luminous Rot"],
  ocean: ["the Sea That Never Saw the Sun", "the Black Tide", "the Drowned Quiet", "the Still Abyssal Water"],
  city: ["the Empty Streets", "the City That Forgot Itself", "the Thousand Doors", "the Unlit Capital"],
  temple: ["the Buried Prayer", "the House of the Deep God", "the Silent Sanctum", "the Kneeling Stones"],
  crystal: ["the Singing Geode", "the Glass Winter", "the Light That Grows", "the Prism Deep"],
  volcanic: ["the Burning Floor", "the Forge of the World", "the Red Breath", "the Melting Dark"],
  cavern: ["the Great Hollow", "the Vault of Echoes", "the Endless Ceiling", "the First Emptiness"],
  necropolis: ["the Sleeping Million", "the Quiet Kingdom", "the Marble Rest", "the Long Memory"],
  vertical: ["the Hanging City", "the Shaft of a Thousand Homes", "the Falling District", "the Climb"],
};

export function regionEpithet(kind: string, rng: RNG): string {
  const list = REGION_EPITHETS[kind] ?? REGION_EPITHETS.cavern;
  return rng.pick(list);
}
