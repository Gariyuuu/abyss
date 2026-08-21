// Procedural audio. Everything here is synthesized at runtime — no asset files,
// nothing to download, and the ambient bed is parameterized by region kind so a
// volcanic floor rumbles, a crystal floor rings, and an ocean floor washes.
//
// Browsers block audio until a user gesture, so the context starts suspended
// and resumes on the first click (the title screen's Descend button).

export type AmbienceKind =
  | "fortress" | "mine" | "fungal" | "ocean" | "city" | "temple"
  | "crystal" | "volcanic" | "cavern" | "necropolis" | "vertical";

interface AmbienceSpec {
  droneHz: number;
  droneGain: number;
  noiseType: "brown" | "pink";
  noiseGain: number;
  filterHz: number;
  dripRate: number;    // average seconds between drips (0 = none)
  shimmer: boolean;    // faint ringing partials (crystal)
}

const AMBIENCE: Record<AmbienceKind, AmbienceSpec> = {
  cavern:     { droneHz: 42, droneGain: 0.05, noiseType: "brown", noiseGain: 0.012, filterHz: 320, dripRate: 5, shimmer: false },
  mine:       { droneHz: 38, droneGain: 0.055, noiseType: "brown", noiseGain: 0.010, filterHz: 260, dripRate: 7, shimmer: false },
  fungal:     { droneHz: 55, droneGain: 0.04, noiseType: "pink",  noiseGain: 0.016, filterHz: 480, dripRate: 3.5, shimmer: false },
  ocean:      { droneHz: 34, droneGain: 0.06, noiseType: "brown", noiseGain: 0.032, filterHz: 520, dripRate: 2.5, shimmer: false },
  crystal:    { droneHz: 62, droneGain: 0.035, noiseType: "pink", noiseGain: 0.008, filterHz: 900, dripRate: 9, shimmer: true },
  volcanic:   { droneHz: 28, droneGain: 0.085, noiseType: "brown", noiseGain: 0.030, filterHz: 180, dripRate: 0, shimmer: false },
  city:       { droneHz: 46, droneGain: 0.04, noiseType: "brown", noiseGain: 0.010, filterHz: 300, dripRate: 6, shimmer: false },
  fortress:   { droneHz: 40, droneGain: 0.045, noiseType: "brown", noiseGain: 0.009, filterHz: 280, dripRate: 8, shimmer: false },
  temple:     { droneHz: 50, droneGain: 0.042, noiseType: "pink",  noiseGain: 0.007, filterHz: 620, dripRate: 10, shimmer: true },
  necropolis: { droneHz: 36, droneGain: 0.05, noiseType: "brown", noiseGain: 0.008, filterHz: 240, dripRate: 11, shimmer: false },
  vertical:   { droneHz: 44, droneGain: 0.04, noiseType: "pink",  noiseGain: 0.026, filterHz: 700, dripRate: 4, shimmer: false },
};

function noiseBuffer(ctx: AudioContext, kind: "brown" | "pink"): AudioBuffer {
  const len = ctx.sampleRate * 3;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  if (kind === "brown") {
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      d[i] = last * 3.5;
    }
  } else {
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + white * 0.0990460;
      b1 = 0.96300 * b1 + white * 0.2965164;
      b2 = 0.57000 * b2 + white * 1.0526913;
      d[i] = (b0 + b1 + b2 + white * 0.1848) * 0.22;
    }
  }
  return buf;
}

export class Audio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private ambientBus: GainNode | null = null;
  private nodes: AudioNode[] = [];
  private dripTimer: number | null = null;
  private current: AmbienceKind | null = null;
  muted = false;

  /** Safe to call repeatedly; only the first call after a gesture does work. */
  start() {
    if (this.ctx) { void this.ctx.resume(); return; }
    try {
      this.ctx = new AudioContext();
    } catch { return; }
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.85;
    this.master.connect(this.ctx.destination);
    this.ambientBus = this.ctx.createGain();
    this.ambientBus.gain.value = 1;
    this.ambientBus.connect(this.master);
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(m ? 0 : 0.85, this.ctx.currentTime, 0.05);
    }
  }

  /** Swap the ambient bed. Cross-fades by tearing down and rebuilding. */
  setAmbience(kind: AmbienceKind, depth: number) {
    this.start();
    if (!this.ctx || !this.ambientBus) return;
    if (this.current === kind) return;
    this.current = kind;
    this.teardownAmbience();

    const ctx = this.ctx;
    const spec = AMBIENCE[kind] ?? AMBIENCE.cavern;
    // Deeper floors sit lower and heavier.
    const depthShift = Math.max(0.72, 1 - depth * 0.004);

    const fade = ctx.createGain();
    fade.gain.value = 0;
    fade.gain.setTargetAtTime(1, ctx.currentTime, 1.4);
    fade.connect(this.ambientBus);
    this.nodes.push(fade);

    // Drone: two detuned oscillators for a slow beat.
    for (const detune of [0, 7]) {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = spec.droneHz * depthShift;
      osc.detune.value = detune;
      const g = ctx.createGain();
      g.gain.value = spec.droneGain;
      osc.connect(g); g.connect(fade);
      osc.start();
      this.nodes.push(osc, g);
    }

    // Filtered noise bed.
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx, spec.noiseType);
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = spec.filterHz;
    const ng = ctx.createGain();
    ng.gain.value = spec.noiseGain;
    src.connect(lp); lp.connect(ng); ng.connect(fade);
    src.start();
    this.nodes.push(src, lp, ng);

    // Slow LFO on the noise so the bed breathes.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = spec.noiseGain * 0.55;
    lfo.connect(lfoGain); lfoGain.connect(ng.gain);
    lfo.start();
    this.nodes.push(lfo, lfoGain);

    if (spec.shimmer) {
      for (const hz of [880, 1320, 1760]) {
        const o = ctx.createOscillator();
        o.type = "sine";
        o.frequency.value = hz;
        const g = ctx.createGain();
        g.gain.value = 0.0025;
        const trem = ctx.createOscillator();
        trem.frequency.value = 0.11 + Math.random() * 0.1;
        const tg = ctx.createGain();
        tg.gain.value = 0.0025;
        trem.connect(tg); tg.connect(g.gain);
        o.connect(g); g.connect(fade);
        o.start(); trem.start();
        this.nodes.push(o, g, trem, tg);
      }
    }

    if (spec.dripRate > 0) this.scheduleDrip(spec.dripRate);
  }

  private scheduleDrip(rate: number) {
    if (this.dripTimer !== null) window.clearTimeout(this.dripTimer);
    const next = (rate * 0.5 + Math.random() * rate) * 1000;
    this.dripTimer = window.setTimeout(() => {
      this.drip();
      this.scheduleDrip(rate);
    }, next);
  }

  private drip() {
    if (!this.ctx || !this.ambientBus) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = "sine";
    const f = 620 + Math.random() * 900;
    osc.frequency.setValueAtTime(f, t);
    osc.frequency.exponentialRampToValueAtTime(f * 0.42, t + 0.13);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.05 + Math.random() * 0.04, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
    // A little space, so the drip sounds like it's across the cavern.
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.random() * 1.6 - 0.8;
    osc.connect(g); g.connect(pan); pan.connect(this.ambientBus);
    osc.start(t); osc.stop(t + 0.4);
  }

  private teardownAmbience() {
    for (const n of this.nodes) {
      try {
        if ("stop" in n && typeof (n as OscillatorNode).stop === "function") (n as OscillatorNode).stop();
        n.disconnect();
      } catch { /* already stopped */ }
    }
    this.nodes = [];
    if (this.dripTimer !== null) { window.clearTimeout(this.dripTimer); this.dripTimer = null; }
  }

  // ------------------------------------------------------------------ sfx ----

  private env(dur: number, peak: number): { g: GainNode; t: number } | null {
    if (!this.ctx || !this.master) return null;
    const t = this.ctx.currentTime;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    g.connect(this.master);
    return { g, t };
  }

  swing() {
    const e = this.env(0.22, 0.09);
    if (!e || !this.ctx) return;
    const src = this.ctx.createBufferSource();
    src.buffer = noiseBuffer(this.ctx, "pink");
    const bp = this.ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.setValueAtTime(1800, e.t);
    bp.frequency.exponentialRampToValueAtTime(500, e.t + 0.2);
    bp.Q.value = 1.4;
    src.connect(bp); bp.connect(e.g);
    src.start(e.t); src.stop(e.t + 0.25);
  }

  hit(heavy = false) {
    const e = this.env(heavy ? 0.35 : 0.2, heavy ? 0.24 : 0.15);
    if (!e || !this.ctx) return;
    const osc = this.ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(heavy ? 150 : 240, e.t);
    osc.frequency.exponentialRampToValueAtTime(heavy ? 45 : 70, e.t + 0.18);
    const src = this.ctx.createBufferSource();
    src.buffer = noiseBuffer(this.ctx, "brown");
    const ng = this.ctx.createGain();
    ng.gain.value = 0.5;
    osc.connect(e.g); src.connect(ng); ng.connect(e.g);
    osc.start(e.t); osc.stop(e.t + 0.4);
    src.start(e.t); src.stop(e.t + 0.12);
  }

  bow() {
    const e = this.env(0.18, 0.1);
    if (!e || !this.ctx) return;
    const osc = this.ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(320, e.t);
    osc.frequency.exponentialRampToValueAtTime(90, e.t + 0.14);
    const lp = this.ctx.createBiquadFilter();
    lp.type = "lowpass"; lp.frequency.value = 1400;
    osc.connect(lp); lp.connect(e.g);
    osc.start(e.t); osc.stop(e.t + 0.2);
  }

  aether() {
    const e = this.env(0.5, 0.075);
    if (!e || !this.ctx) return;
    for (const [mult, type] of [[1, "sine"], [1.5, "sine"], [2.02, "triangle"]] as const) {
      const osc = this.ctx.createOscillator();
      osc.type = type;
      osc.frequency.setValueAtTime(220 * mult, e.t);
      osc.frequency.exponentialRampToValueAtTime(880 * mult, e.t + 0.42);
      osc.connect(e.g);
      osc.start(e.t); osc.stop(e.t + 0.5);
    }
  }

  pickup() {
    const e = this.env(0.26, 0.07);
    if (!e || !this.ctx) return;
    for (const [i, hz] of [523.25, 783.99].entries()) {
      const osc = this.ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = hz;
      const g = this.ctx.createGain();
      g.gain.value = 1;
      osc.connect(g); g.connect(e.g);
      osc.start(e.t + i * 0.055); osc.stop(e.t + 0.3);
    }
  }

  discovery() {
    const e = this.env(1.5, 0.06);
    if (!e || !this.ctx) return;
    // A low open fifth — "you found something old".
    for (const hz of [130.81, 196.0, 392.0]) {
      const osc = this.ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = hz;
      const g = this.ctx.createGain();
      g.gain.value = hz > 300 ? 0.35 : 1;
      osc.connect(g); g.connect(e.g);
      osc.start(e.t); osc.stop(e.t + 1.6);
    }
  }

  descend() {
    const e = this.env(2.4, 0.11);
    if (!e || !this.ctx) return;
    const osc = this.ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(120, e.t);
    osc.frequency.exponentialRampToValueAtTime(34, e.t + 2.2);
    const sub = this.ctx.createOscillator();
    sub.type = "triangle";
    sub.frequency.setValueAtTime(60, e.t);
    sub.frequency.exponentialRampToValueAtTime(21, e.t + 2.2);
    const sg = this.ctx.createGain();
    sg.gain.value = 0.55;
    osc.connect(e.g); sub.connect(sg); sg.connect(e.g);
    osc.start(e.t); osc.stop(e.t + 2.5);
    sub.start(e.t); sub.stop(e.t + 2.5);
  }

  hurt() {
    const e = this.env(0.45, 0.2);
    if (!e || !this.ctx) return;
    const osc = this.ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(180, e.t);
    osc.frequency.exponentialRampToValueAtTime(52, e.t + 0.4);
    const lp = this.ctx.createBiquadFilter();
    lp.type = "lowpass"; lp.frequency.value = 700;
    osc.connect(lp); lp.connect(e.g);
    osc.start(e.t); osc.stop(e.t + 0.5);
  }

  death() {
    const e = this.env(3.4, 0.16);
    if (!e || !this.ctx) return;
    for (const hz of [98, 116.54, 146.83]) {
      const osc = this.ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(hz, e.t);
      osc.frequency.exponentialRampToValueAtTime(hz * 0.5, e.t + 3.2);
      osc.connect(e.g);
      osc.start(e.t); osc.stop(e.t + 3.5);
    }
  }
}
