# ABYSS: The Infinite Below

A playable third-person 3D generative RPG set in an endless dungeon whose floors are
**derived worlds, not layouts**. Browser-based: Three.js + TypeScript + Vite, no backend,
saves in localStorage.

```bash
npm install
npm run dev      # play at the printed localhost URL
npm test         # headless smoke test of the generative core
npm run build    # typecheck + production build
```

## The order of truth

Nothing in the world is decoration. Generation runs in this order, and each layer may
only cite the layer above it:

1. **`src/gen/history.ts` — the macro-simulation.** The world generates in chapters of
   10 depths: geology (rock, water, heat, age), civilizations (phonology, species,
   religion, government, economy, cuisine, clothing, military, myths, surface-beliefs,
   dynasties, architecture style), rivers that vanish and resurface at recorded deeper
   depths, legendary creatures with migration paths, and a **dated causal event
   timeline** — foundings, wars, plagues, floods, regicides, sealings, heresies,
   collapses — with named actors and canonical casualty figures. Daughter cultures
   inherit their parent's consonants and architectural motifs, drifted.
2. **`src/gen/regions.ts` — why each floor exists.** Archetype is chosen from geology +
   whose territory covers that depth; *purpose* is derived from that civ's actual
   economy/religion/military ("the copper workings that paid for everything else the
   Tharnai built"). Ecosystems are food webs (`gen/creatures.ts`), not spawn tables.
3. **`src/gen/lore.ts` — archaeology.** Every journal, chronicle, mural, gravestone and
   warning is *event + source perspective + deterministic distortion*. Chronicles
   deflate their own losses; enemy accounts reverse the blame; journals get dates wrong
   but feelings right; graves are accurate. The codex's **Reconstruction** tab groups
   the sources you've read per event so you can triangulate what actually happened.
4. **`src/world/` — rendering the record.** Terrain, water (rivers visibly recur across
   floors), culture-styled ruins (parent-civ ruins appear older and more broken, in the
   parent's style), murals whose imagery matches the event type, settlements with NPCs
   who speak from their culture's real facts.
5. **`src/sim/ledger.ts` — the world remembers.** Burned floors stay burned, the dead
   stay dead, looted chests stay empty. Consequences **keep propagating after you
   leave**: break a seal and two civilizations meet; kill a floor's only predator and
   the herds bloom and strip the flora; kill a ruler and succession politics follow you.

## Companions read over your shoulder

Living settlements keep a hiring fire. Everyone there comes from a real generated
culture, and that culture travels with them:

- a **porter** carries +12 pack weight,
- a **warden** physically interposes between you and whatever is charging,
- a **hunter** roughly doubles how fast the bestiary fills in and names weaknesses aloud,
- a **scholar** reads every document you find **through their own people's history**.

The scholar is the one that matters. Standing over the same chronicle, a scholar
whose people traded with its authors says *"their record-keeping was honest by the
standards of the deep"*; one whose people fought them says *"we have their version in
our own archives, and it does not say what this says"*; one reading their **own**
people's account says *"it reads true to me — and you should weigh that, because I am
the last person able to read it coldly."* You get a second source for free, and you
have to weigh its bias too.

Companions eat your food when you rest, and they die permanently. When one does, the
world records it and word travels: the hiring fires get quieter and the price goes up.

## Equipment comes from military traditions

Armor isn't a loot table. Each piece is generated from the *recorded military
tradition* of the culture whose floor you found it on — a people the simulation says
"fought in phalanxes of long spears suited to corridor war" yield corridor-guard
plate: +10 armor, 1.5× sprint stamina drain, and loud. Loud matters, because eyeless
and echo-hunting creatures notice you from further away in it. Lanterns trade light
radius against oil burn; charms follow their culture's actual religious tenet.

## Sound

All audio is synthesized at runtime with WebAudio — no asset files. The ambient bed is
parameterized per region archetype (volcanic rumbles, crystal rings, ocean washes,
caverns drip in stereo), and drops in pitch as you descend. `M` toggles it.

## Playing

WASD/mouse third-person; Shift run, Space jump / hold into a ledge to climb, Q dodge,
LMB attack, RMB block/aim, 1/2/3 sword/bow/aether, T torch, E interact, C camp,
I pack/crafting/gear/company, J codex, M sound. Expeditions are prepared, not teleported: food, water, torch
oil, arrows, a camp kit — the stair down warns you what you're carrying. Creatures are
learned by watching (sighted → observed → studied → understood); their weaknesses
(light, flanks, sound, fire) are mechanically real.

There is no canonical answer to what the Abyss is. The sources disagree on purpose.
