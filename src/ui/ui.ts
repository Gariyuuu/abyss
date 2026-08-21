// DOM UI: HUD bars, toasts, and the four panels (document reader, pack, codex,
// camp). The codex is the archaeology heart: it lists events as RECONSTRUCTIONS
// from the sources the player has actually read, showing disagreements side by
// side rather than one canonical answer.

import { Region } from "../gen/regions";
import { Species, speciesFieldSummary } from "../gen/creatures";
import { DocSpec } from "../gen/lore";
import { Player } from "../player/player";
import { Inventory, ITEMS, RECIPES, MAX_WEIGHT, Recipe } from "../player/inventory";
import { Companion, ROLE_INFO } from "../player/companions";
import { Loadout, Gear, Slot } from "../player/equipment";
import { observationLevel } from "../ai/creature-ai";
import { CodexState, Ledger } from "../sim/ledger";
import { History } from "../gen/history";

const $ = (id: string) => document.getElementById(id)!;

export class UI {
  activePanel: string | null = null;
  private codexTab = "regions";
  private invTab = "carry";

  constructor(
    private getPlayer: () => Player,
    private getInventory: () => Inventory,
    private getRegion: () => Region | null,
    private getCodex: () => CodexState,
    private getHistory: () => History,
    private getLedger: () => Ledger,
    private getVisitedRegions: () => Region[],
    private atCamp: () => boolean,
    private getCompanions: () => Companion[],
    private getLoadout: () => Loadout,
    private getCarryBonus: () => number,
  ) {}

  // ------------------------------------------------------------------ HUD ----
  updateHUD() {
    const p = this.getPlayer();
    const set = (id: string, frac: number) => {
      ($(id).firstElementChild as HTMLElement).style.width = `${Math.max(0, Math.min(100, frac * 100))}%`;
    };
    set("bar-hp", p.hp / p.maxHp);
    set("bar-st", p.stamina / 100);
    set("bar-mn", p.mana / p.maxMana);
    set("bar-lt", p.torchFuel / 100);
    $("row-hp").classList.toggle("low", p.hp / p.maxHp < 0.25);
    $("row-lt").classList.toggle("low", p.torchFuel < 20 && p.torchOn);
    const need = (id: string, label: string, v: number) => {
      const el = $(id);
      el.textContent = `${label} ${Math.round(v)}`;
      el.className = v < 15 ? "crit" : v < 40 ? "warn" : "";
    };
    need("need-food", "hunger", p.hunger);
    need("need-water", "thirst", p.thirst);
    const arrows = this.getInventory().count("arrow");
    const ae = $("need-arrows");
    ae.textContent = `arrows ${arrows}`;
    ae.className = arrows === 0 ? "warn" : "";
    const inj = $("injury-tag");
    inj.style.display = p.injury ? "block" : "none";
    inj.textContent = p.injury ? `✚ ${p.injury} — movement impaired` : "";
  }

  setRegionPlate(region: Region) {
    $("hud-depth").textContent = `depth ${region.depth}`;
    $("hud-region").textContent = region.name;
    $("hud-epithet").textContent = region.epithet;
  }

  toast(msg: string, discovery = false) {
    if (!msg) return;
    const stack = $("toast-stack");
    while (stack.children.length >= 4) stack.firstElementChild!.remove();
    const el = document.createElement("div");
    el.className = "toast" + (discovery ? " discovery" : "");
    el.textContent = msg;
    stack.appendChild(el);
    setTimeout(() => el.remove(), 5700);
  }

  prompt(text: string | null) {
    const el = $("prompt");
    if (!text) { el.classList.remove("on"); return; }
    el.innerHTML = `<span class="kbd">E</span>&nbsp; ${text}`;
    el.classList.add("on");
  }

  /** Full-screen region title card shown on floor transitions. */
  showTransition(depth: number, name: string, epithet: string, purpose: string) {
    $("t-depth").textContent = `depth ${depth}`;
    $("t-name").textContent = name;
    $("t-epithet").textContent = epithet;
    $("t-purpose").textContent = purpose.charAt(0).toUpperCase() + purpose.slice(1);
    const el = $("transition");
    el.classList.add("show");
    setTimeout(() => el.classList.remove("show"), 3400);
  }

  flashDamage() {
    const el = $("damage-flash");
    el.classList.add("hit");
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove("hit")));
  }

  setWeapon(weapon: string) {
    for (const [id, w] of [["w-sword", "sword"], ["w-bow", "bow"], ["w-aether", "aether"]]) {
      $(id).classList.toggle("active", w === weapon);
    }
  }

  setLockHint(show: boolean) {
    $("lock-hint").classList.toggle("on", show);
  }

  // ---------------------------------------------------------------- panels ----
  closeAll() {
    for (const id of ["panel-doc", "panel-inv", "panel-codex", "panel-camp"])
      $(id).classList.remove("open");
    this.activePanel = null;
  }

  private open(id: string) {
    this.closeAll();
    $(id).classList.add("open");
    this.activePanel = id;
    document.exitPointerLock?.();
  }

  showDoc(doc: DocSpec, reading?: { speaker: string; text: string } | null) {
    $("doc-title").textContent = doc.title;
    $("doc-sub").textContent = doc.sub;
    $("doc-body").textContent = doc.body;
    const src = $("doc-source");
    src.innerHTML = "";
    const line = document.createElement("div");
    line.textContent = "⌘ " + doc.source;
    src.appendChild(line);
    // A scholar companion's own reading of the same document, biased by their culture.
    if (reading) {
      const box = document.createElement("div");
      box.className = "reading";
      box.innerHTML = `<div class="reading-who">${reading.speaker} reads it over your shoulder</div>` +
        `<div class="reading-text"></div>`;
      (box.querySelector(".reading-text") as HTMLElement).textContent = reading.text;
      src.appendChild(box);
    }
    this.open("panel-doc");
  }

  toggleInventory() {
    if (this.activePanel === "panel-inv") { this.closeAll(); return; }
    this.renderInventory();
    this.open("panel-inv");
  }

  renderInventory() {
    const inv = this.getInventory();
    const p = this.getPlayer();
    const load = this.getLoadout();
    const cap = Math.round((MAX_WEIGHT + this.getCarryBonus() - load.weight()) * 10) / 10;
    const bonus = this.getCarryBonus();
    $("inv-weight").textContent =
      `${inv.weight()} / ${cap} weight` +
      (bonus ? ` (porters carry +${bonus}` + (load.weight() ? `, gear costs ${load.weight()}` : "") + ")"
             : load.weight() ? ` (gear costs ${load.weight()})` : "") +
      " — deeper means carrying your survival on your back";
    const tabs = $("inv-tabs");
    tabs.innerHTML = "";
    for (const [t, label] of [["carry", "Pack"], ["craft", "Craft"], ["gear", "Gear"], ["party", "Company"]]) {
      const b = document.createElement("button");
      b.textContent = label;
      b.className = this.invTab === t ? "active" : "";
      b.onclick = () => { this.invTab = t; this.renderInventory(); };
      tabs.appendChild(b);
    }
    const list = $("inv-list");
    list.innerHTML = "";
    if (this.invTab === "gear") { this.renderGear(list); return; }
    if (this.invTab === "party") { this.renderParty(list); return; }
    if (this.invTab === "carry") {
      const entries = Object.entries(inv.items).sort();
      if (!entries.length) list.innerHTML = `<p class="sub">The pack is empty. That is how people die down here.</p>`;
      for (const [name, qty] of entries) {
        const def = ITEMS[name];
        const row = document.createElement("div");
        row.className = "inv-row";
        row.innerHTML = `<span>${name}<span class="qty">×${qty}</span><br/><span class="qty">${def?.desc ?? "an artifact of the deep"}</span></span>`;
        if (def?.use) {
          const btn = document.createElement("button");
          btn.textContent = def.type === "food" ? "eat" : def.type === "water" ? "drink" : def.type === "light" ? "refuel" : "use";
          btn.onclick = () => {
            if (!inv.remove(name, 1)) return;
            const u = def.use!;
            if (u.hp) p.hp = Math.min(p.maxHp, p.hp + u.hp);
            if (u.hunger) p.hunger = Math.min(100, p.hunger + u.hunger);
            if (u.thirst) p.thirst = Math.min(100, p.thirst + u.thirst);
            if (u.fuel) p.torchFuel = Math.min(100, p.torchFuel + u.fuel);
            if (u.mana) p.mana = Math.min(p.maxMana, p.mana + u.mana);
            if (u.cureInjury) { p.injury = null; this.toast("the splint holds — you can walk properly"); }
            this.renderInventory();
            this.updateHUD();
          };
          row.appendChild(btn);
        }
        list.appendChild(row);
      }
    } else {
      const camping = this.atCamp();
      for (const r of RECIPES) {
        const row = document.createElement("div");
        row.className = "inv-row";
        const needs = r.needs.map(([n, q]) => `${n}×${q}`).join(", ");
        const campNote = r.where === "camp" && !camping ? " (needs a lit camp)" : "";
        row.innerHTML = `<span>${r.out} ×${r.qty}<br/><span class="qty">needs ${needs}${campNote}</span></span>`;
        const btn = document.createElement("button");
        btn.textContent = "craft";
        btn.disabled = !inv.canCraft(r) || (r.where === "camp" && !camping);
        btn.onclick = () => {
          if (this.tryCraft(r)) { this.renderInventory(); this.updateHUD(); }
        };
        row.appendChild(btn);
        list.appendChild(row);
      }
    }
  }

  private renderGear(list: HTMLElement) {
    const load = this.getLoadout();
    const stat = (g: Gear) => [
      g.defense ? `+${g.defense} armor` : null,
      `${g.weight} weight`,
      g.drain !== 1 ? `${g.drain > 1 ? "−" : "+"}${Math.round(Math.abs(1 - g.drain) * 100)}% sprint` : null,
      g.noise !== 1 ? (g.noise > 1 ? "loud" : "quiet") : null,
      g.lightRadius !== 1 ? `${Math.round((g.lightRadius - 1) * 100)}% light reach` : null,
      g.fuelBurn !== 1 ? `${g.fuelBurn > 1 ? "+" : "−"}${Math.round(Math.abs(1 - g.fuelBurn) * 100)}% oil burn` : null,
    ].filter(Boolean).join(" · ");

    const head = document.createElement("p");
    head.className = "sub";
    head.textContent = `Worn: ${load.defense()} armor · sprint ×${load.drain().toFixed(2)} · ` +
      `${load.noise() > 1 ? "loud" : load.noise() < 1 ? "quiet" : "ordinary"} · ` +
      `light ×${load.lightRadius().toFixed(2)} · oil ×${load.fuelBurn().toFixed(2)}`;
    list.appendChild(head);

    for (const slot of ["body", "light", "charm"] as Slot[]) {
      const worn = load.get(slot);
      const row = document.createElement("div");
      row.className = "inv-row";
      row.innerHTML = worn
        ? `<span><b>${slot}</b> — ${worn.name}<span class="equipped-tag">WORN</span><br/>
             <span class="qty">${stat(worn)}</span><br/><span class="qty">${worn.origin}</span></span>`
        : `<span><b>${slot}</b> — <span class="qty">nothing worn</span></span>`;
      if (worn) {
        const btn = document.createElement("button");
        btn.textContent = "remove";
        btn.onclick = () => { load.unequip(slot); this.renderInventory(); };
        row.appendChild(btn);
      }
      list.appendChild(row);
    }

    if (load.stash.length) {
      const h = document.createElement("h2");
      h.textContent = "Carried, not worn";
      list.appendChild(h);
      for (const g of load.stash) {
        const row = document.createElement("div");
        row.className = "inv-row";
        row.innerHTML = `<span>${g.name}<br/><span class="qty">${stat(g)}</span><br/>
          <span class="qty">${g.origin}</span></span>`;
        const btn = document.createElement("button");
        btn.textContent = "wear";
        btn.onclick = () => { load.equip(g); this.renderInventory(); };
        row.appendChild(btn);
        list.appendChild(row);
      }
    }
  }

  private renderParty(list: HTMLElement) {
    const comps = this.getCompanions();
    if (!comps.length) {
      list.innerHTML = `<p class="sub">You are alone. Living settlements keep a hiring fire — ` +
        `a porter carries what you cannot, a warden stands where you would have been hit, ` +
        `a scholar reads every inscription through their own people's history, and a hunter names what is stalking you.</p>`;
      return;
    }
    const history = this.getHistory();
    for (const c of comps) {
      const civ = c.civId ? history.civById(c.civId) : null;
      const row = document.createElement("div");
      row.className = "inv-row";
      const hpPct = Math.max(0, Math.round((c.hp / c.maxHp) * 100));
      row.innerHTML = `<span><b>${c.name}</b> — ${ROLE_INFO[c.role].label}` +
        (c.alive ? `` : ` <span class="equipped-tag" style="color:oklch(60% 0.16 25)">DEAD</span>`) +
        `<br/><span class="qty">${civ ? `of ${civ.name}, ${civ.species}` : "origin unknown"} · ` +
        `hired at depth ${c.hiredAtDepth}${c.alive ? ` · ${hpPct}% condition` : ""}</span>` +
        `<br/><span class="qty">${ROLE_INFO[c.role].blurb}</span>` +
        `<br/><span class="qty">"${c.motive}"</span></span>`;
      list.appendChild(row);
    }
    const note = document.createElement("p");
    note.className = "sub";
    note.textContent = "Everyone at the fire eats when you rest. Hungry hands remember it.";
    list.appendChild(note);
  }

  private tryCraft(r: Recipe): boolean {
    const ok = this.getInventory().craft(r);
    this.toast(ok ? `crafted ${r.out} ×${r.qty}` : "missing materials");
    return ok;
  }

  // ----------------------------------------------------------------- codex ----
  toggleCodex() {
    if (this.activePanel === "panel-codex") { this.closeAll(); return; }
    this.renderCodex();
    this.open("panel-codex");
  }

  renderCodex() {
    const tabs = $("codex-tabs");
    tabs.innerHTML = "";
    for (const [key, label] of [["regions", "Regions"], ["civs", "Peoples"], ["species", "Bestiary"], ["events", "Reconstruction"], ["news", "The World Moves"]] as const) {
      const b = document.createElement("button");
      b.textContent = label;
      b.className = this.codexTab === key ? "active" : "";
      b.onclick = () => { this.codexTab = key; this.renderCodex(); };
      tabs.appendChild(b);
    }
    const body = $("codex-body");
    body.innerHTML = "";
    const codex = this.getCodex();
    const history = this.getHistory();

    if (this.codexTab === "regions") {
      const regions = this.getVisitedRegions();
      if (!regions.length) body.innerHTML = `<p class="sub">Descend, and this page will fill.</p>`;
      for (const r of regions.sort((a, b) => a.depth - b.depth)) {
        const div = document.createElement("div");
        div.innerHTML = `<h2>Depth ${r.depth} — ${r.name}, ${r.epithet}</h2>
          <p><b>Why it exists:</b> ${r.purpose}</p>
          <p><b>Geology:</b> ${r.stratum.formation}.</p>
          <p><b>Who is here now:</b> ${r.inhabitantsDesc}.</p>
          ${r.rivers.length ? `<p><b>Water:</b> ${r.rivers.map((rv) => `${rv.name} (also known at depths ${rv.depths.join(", ")})`).join("; ")}</p>` : ""}
          <p><b>Open questions:</b></p><ul>${r.mysteries.map((m) => `<li>${m}</li>`).join("")}</ul>`;
        body.appendChild(div);
      }
    } else if (this.codexTab === "civs") {
      if (!codex.civsMet.length) body.innerHTML = `<p class="sub">You have met no one and read nothing. The dark is not empty — keep looking.</p>`;
      for (const id of codex.civsMet) {
        const c = history.civById(id);
        if (!c) continue;
        const parent = c.parentCivId ? history.civById(c.parentCivId) : null;
        const div = document.createElement("div");
        div.innerHTML = `<h2>${c.name} (${c.demonym}) — ${c.fate === "extant" ? "living" : c.fate}</h2>
          <div class="grid2">
          <div class="kv"><b>People:</b> ${c.species}</div>
          <div class="kv"><b>Founded:</b> ~${c.foundedYear} years ago${c.fellYear ? `; ended ~${c.fellYear} years ago` : ""}</div>
          <div class="kv"><b>Home depth:</b> ${c.homeDepth} (influence ${c.territory[0]}–${c.territory[1]})</div>
          <div class="kv"><b>Rule:</b> ${c.government}</div>
          <div class="kv"><b>Faith:</b> ${c.religion.deity} — "${c.religion.tenet}"; rite: ${c.religion.rite}</div>
          <div class="kv"><b>Table:</b> ${c.cuisine.join("; ")}</div>
          <div class="kv"><b>Trade:</b> ${c.economy.join(", ")}</div>
          <div class="kv"><b>Dress:</b> ${c.clothing}</div>
          <div class="kv"><b>Arms:</b> ${c.military}</div>
          <div class="kv"><b>Of the surface:</b> they hold it ${c.surfaceBelief.replace("-", ", ")}</div>
          ${parent ? `<div class="kv"><b>Descent:</b> their architecture and speech drift from ${parent.name}, above them — a schism or migration connects the two</div>` : ""}
          </div>
          <p style="margin-top:8px"><b>They tell of:</b> ${c.myth}.</p>`;
        body.appendChild(div);
      }
    } else if (this.codexTab === "species") {
      const seen = Object.entries(codex.speciesSeen);
      if (!seen.length) body.innerHTML = `<p class="sub">No creatures observed yet. Knowledge is earned by watching — or surviving.</p>`;
      const bySpecies = this.speciesIndex();
      for (const [id, obs] of seen) {
        const sp = bySpecies.get(id);
        if (!sp) continue;
        const lvl = observationLevel(obs);
        const unk = `<span class="unknown">unknown — observe longer</span>`;
        const div = document.createElement("div");
        div.innerHTML = `<h2>${sp.name}${lvl >= 2 && sp.localName ? ` — called "${sp.localName}" by the locals` : ""} <span class="qty">(${["sighted", "observed", "studied", "understood"][lvl]})</span></h2>
          <div class="grid2">
          <div class="kv"><b>Form:</b> ${speciesFieldSummary(sp)}</div>
          <div class="kv"><b>Haunts:</b> ${lvl >= 1 ? sp.habitat : unk}</div>
          <div class="kv"><b>Manner:</b> ${lvl >= 1 ? sp.behavior : unk}</div>
          <div class="kv"><b>Feeds:</b> ${lvl >= 2 ? sp.foodDesc : unk}</div>
          <div class="kv"><b>Weakness:</b> ${lvl >= 2 ? sp.weakness : unk}</div>
          <div class="kv"><b>Increase:</b> ${lvl >= 3 ? sp.reproduction : unk}</div>
          </div>`;
        body.appendChild(div);
      }
    } else if (this.codexTab === "events") {
      const docs = codex.docsMeta;
      if (!docs.length) body.innerHTML = `<p class="sub">Read journals, murals, graves. Then compare them here — the sources will not agree.</p>`;
      // Group read documents by the event they describe.
      const byEvent = new Map<string, typeof docs>();
      const loose: typeof docs = [];
      for (const d of docs) {
        const evId = d.id.includes(":doc:") ? d.id.split(":doc:")[0] : null;
        if (evId) {
          if (!byEvent.has(evId)) byEvent.set(evId, []);
          byEvent.get(evId)!.push(d);
        } else loose.push(d);
      }
      for (const [evId, group] of byEvent) {
        const ev = this.findEvent(evId);
        const div = document.createElement("div");
        const header = ev
          ? `<h2>Reconstruction: the ${ev.type} at depth ${ev.depth}</h2>
             <p class="sub">${group.length} source${group.length > 1 ? "s" : ""} recovered${group.length > 1 ? " — note where they disagree on dates, numbers, and blame" : ""}.</p>`
          : `<h2>Reconstruction: an uncertain event</h2>`;
        div.innerHTML = header + group.map((d) =>
          `<p><b>${d.title}</b> <span class="qty">(depth ${d.depth})</span><br/>${d.body.replace(/\n/g, "<br/>")}<br/><i class="qty">${d.source}</i></p>`,
        ).join("");
        body.appendChild(div);
      }
      for (const d of loose) {
        const div = document.createElement("div");
        div.innerHTML = `<h2>${d.title}</h2><p>${d.body.replace(/\n/g, "<br/>")}</p><p><i class="qty">${d.source}</i></p>`;
        body.appendChild(div);
      }
    } else {
      const evs = this.getLedger().dynamicEvents;
      if (!evs.length) body.innerHTML = `<p class="sub">Nothing you have done has echoed yet. It will.</p>`;
      for (const e of [...evs].reverse()) {
        const div = document.createElement("div");
        div.innerHTML = `<p>◆ ${e.text} <span class="qty">(near depth ${e.depth})</span></p>`;
        body.appendChild(div);
      }
    }
  }

  private speciesIndex(): Map<string, Species> {
    const m = new Map<string, Species>();
    for (const r of this.getVisitedRegions()) for (const s of r.species) m.set(s.id, s);
    return m;
  }

  private findEvent(evId: string) {
    return this.getHistory().eventById(evId);
  }

  // ------------------------------------------------------------------ camp ----
  showCamp(opts: {
    title: string; sub: string;
    actions: { label: string; desc: string; fn: () => void }[];
  }) {
    $("camp-title").textContent = opts.title;
    $("camp-sub").textContent = opts.sub;
    const body = $("camp-body");
    body.innerHTML = "";
    for (const a of opts.actions) {
      const row = document.createElement("div");
      row.className = "inv-row";
      row.innerHTML = `<span>${a.label}<br/><span class="qty">${a.desc}</span></span>`;
      const btn = document.createElement("button");
      btn.textContent = "do";
      btn.onclick = () => a.fn();
      row.appendChild(btn);
      body.appendChild(row);
    }
    this.open("panel-camp");
  }

  showNpc(name: string, lines: string[]) {
    $("doc-title").textContent = name;
    $("doc-sub").textContent = "a living voice in the deep";
    $("doc-body").textContent = lines.join("\n\n");
    $("doc-source").textContent = "⌘ Living testimony — as biased as any chronicle, and as human";
    this.open("panel-doc");
  }
}
