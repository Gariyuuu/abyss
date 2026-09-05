/**
 * Icon set — Lucide geometry, inlined.
 *
 * abyss is a vanilla-TS/three.js build with exactly one runtime dependency, and
 * it stays that way: pulling in a React icon package for six glyphs would be the
 * "large dependency without justification" this pass is meant to avoid. These
 * are the Lucide paths for the six icons the HUD actually uses, on Lucide's own
 * 24x24 grid at its own 2px stroke, so they sit optically with each other.
 *
 * They replace the Unicode glyphs the HUD shipped with (♥ ♦ ✦ ☼ † ➶ ✧). Those
 * rendered as a different typeface on every platform -- ☼ in particular falls
 * back to a serif sun on macOS and a box on some Linux stacks -- and none of
 * them carried a stroke weight related to anything else on screen.
 *
 * Everything uses `currentColor`, so the existing colour rules keep working
 * untouched.
 */

const SVG = (paths: string, stroke = 2) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${stroke}"` +
  ` stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths}</svg>`;

/** lucide `heart` — health */
export const iconHeart = SVG('<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>');

/** lucide `zap` — stamina */
export const iconZap = SVG('<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>');

/** lucide `sparkles` — aether / mana */
export const iconSparkles = SVG('<path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275z"/><path d="M5 3v4"/><path d="M19 17v4"/><path d="M3 5h4"/><path d="M17 19h4"/>');

/** lucide `flame` — torch fuel */
export const iconFlame = SVG('<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5"/>');

/** lucide `sword` — melee slot */
export const iconSword = SVG('<polyline points="14.5 17.5 3 6 3 3 6 3 17.5 14.5"/><line x1="13" x2="19" y1="19" y2="13"/><line x1="16" x2="20" y1="16" y2="20"/><line x1="19" x2="21" y1="21" y2="19"/>');

/** lucide `target` — bow slot */
export const iconTarget = SVG('<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>');

/** lucide `wand-sparkles` — aether slot */
export const iconWand = SVG('<path d="m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72"/><path d="m14 7 3 3"/><path d="M5 6v4"/><path d="M19 14v4"/><path d="M3 8h4"/><path d="M17 16h4"/>');
