// Production verifier. Deliberately fast — it proves the deployed bundle is the
// one we just built and that a real world boots and plays, not that HTTP is 200.
// Full expedition validation is `npm run validate:deep`, run locally.
//
//   npm run verify:live [url]

import { chromium } from "/Users/gariyuu/Projects/careeratlas/node_modules/playwright/index.mjs";
import { readFileSync } from "node:fs";

const TARGET = process.argv[2] || "https://abyss-black-sigma.vercel.app";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const here = dirname(fileURLToPath(import.meta.url));
const expectedBuild = JSON.parse(readFileSync(join(here, "../package.json"), "utf8")).version;

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
  if (!ok) failures++;
};

const errors = [];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

const t0 = Date.now();
const resp = await page.goto(TARGET, { waitUntil: "networkidle" });
check("site responds", resp?.status() === 200, `HTTP ${resp?.status()}`);

// Deployment identity: the served bundle must carry this build's marker.
const identity = await page.evaluate(() => ({
  build: window.__ABYSS_BUILD__ ?? null,
  title: document.title,
}));
check("serves the expected build", identity.build === expectedBuild,
  `served ${identity.build ?? "none"}, expected ${expectedBuild}`);

// Boot a real world and enter play.
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: "networkidle" });
await page.fill("#seed-input", "verify-live");
await page.click("#btn-descend");
await page.waitForTimeout(3000);

const state = await page.evaluate(() => {
  const g = window.__abyss;
  if (!g) return null;
  const r = g.region;
  return {
    running: g.running,
    depth: g.depth,
    region: r?.name,
    purpose: (r?.purpose ?? "").slice(0, 60),
    species: r?.species.length ?? 0,
    docs: r?.docs.length ?? 0,
    interactables: g.populated?.interactables.length ?? 0,
    creatures: g.creatures.length,
    canvas: !!document.querySelector("canvas"),
    audio: g.audio.started,
    civs: r?.builderCiv ? 1 : 0,
  };
});
check("world generates and play begins", !!state?.running && !!state?.canvas, JSON.stringify(state));
check("region carries a generated history", (state?.docs ?? 0) > 0 && (state?.species ?? 0) >= 3,
  `${state?.docs} documents, ${state?.species} species`);
check("region is populated and interactive", (state?.interactables ?? 0) > 5,
  `${state?.interactables} interactables`);

// Chronicle/codex renders from that history.
const codex = await page.evaluate(async () => {
  const g = window.__abyss;
  const it = g.populated.interactables.find((i) => i.kind === "doc");
  if (it) { g.player.group.position.copy(it.pos); g.interact(); }
  const docTitle = document.getElementById("doc-title")?.textContent ?? "";
  g.ui.closeAll();
  g.ui.toggleCodex();
  await new Promise((r) => setTimeout(r, 300));
  const body = document.getElementById("codex-body")?.textContent ?? "";
  g.ui.closeAll();
  return { docTitle, codexLength: body.length };
});
check("a document reads and enters the codex",
  codex.docTitle.length > 0 && codex.codexLength > 50, `"${codex.docTitle}"`);

// Descend one floor for real.
const descended = await page.evaluate(async () => {
  const g = window.__abyss;
  const before = g.depth;
  g.loadRegion(before + 1);
  await new Promise((r) => setTimeout(r, 900));
  return { from: before, to: g.depth, region: g.region.name, ambience: g.audio.ambienceKind };
});
check("descends into a second region", descended.to === descended.from + 1,
  `depth ${descended.from} -> ${descended.to} (${descended.region})`);

check("no runtime errors", errors.length === 0, errors.slice(0, 3).join(" | "));

console.log(`\n${failures ? "LIVE VERIFY FAILED" : "LIVE VERIFY PASSED"} in ${((Date.now() - t0) / 1000).toFixed(1)}s — ${TARGET}`);
await browser.close();
process.exit(failures ? 1 : 0);
