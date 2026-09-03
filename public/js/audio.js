// Everything continuous is synthesized (room tone, fluorescent hum, lamp
// buzz); only three CC0 one-shots are files. Nothing plays before the gate
// click, which is the one user gesture the browser needs.
export class Audio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.buffers = {};
    this.enabled = true;
    this.blipEnabled = true;
    this.flickerLfo = null;
    this.hum = null;
  }
  unlock() {
    if (this.ctx) { this.ctx.resume(); return; }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(this.ctx.destination);
    this.ctx.resume();
    this.loadOneShots();
  }
  async loadOneShots() {
    for (const name of ["tick", "creak", "slam", "click"]) {
      for (const ext of ["ogg", "wav"]) {
        try {
          const res = await fetch(`/assets/sfx/${name}.${ext}`);
          if (!res.ok) continue;
          this.buffers[name] = await this.ctx.decodeAudioData(await res.arrayBuffer());
          break;
        } catch { /* fall through to synthesis */ }
      }
    }
  }
  now() { return this.ctx ? this.ctx.currentTime : 0; }

  startAmbience() {
    if (!this.ctx || this.hum) return;
    const c = this.ctx;
    const bed = c.createGain();
    bed.gain.value = 0.0;
    bed.connect(this.master);
    bed.gain.linearRampToValueAtTime(0.16, c.currentTime + 4);

    // Room tone: brown noise through a low-pass.
    const len = c.sampleRate * 4;
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      d[i] = last * 3.5;
    }
    const noise = c.createBufferSource();
    noise.buffer = buf; noise.loop = true;
    const lp = c.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 420;
    const noiseGain = c.createGain(); noiseGain.gain.value = 0.35;
    noise.connect(lp).connect(noiseGain).connect(bed);
    noise.start();

    // Fluorescent hum: 60 Hz and harmonics, plus a filtered sawtooth buzz.
    const humGain = c.createGain(); humGain.gain.value = 0.05;
    humGain.connect(bed);
    for (const [f, g] of [[60, 1], [120, 0.55], [180, 0.25], [240, 0.12]]) {
      const o = c.createOscillator(); o.type = "sine"; o.frequency.value = f;
      const og = c.createGain(); og.gain.value = g;
      o.connect(og).connect(humGain); o.start();
    }
    const saw = c.createOscillator(); saw.type = "sawtooth"; saw.frequency.value = 120;
    const bp = c.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 2400; bp.Q.value = 6;
    const sawGain = c.createGain(); sawGain.gain.value = 0.012;
    saw.connect(bp).connect(sawGain).connect(bed); saw.start();

    // Clock: a tick every second, from the file if we have it.
    this.hum = { bed, humGain };
    this.tickTimer = setInterval(() => this.play("tick", 0.18, 0.06), 1000);
  }
  setAmbienceLevel(v) {
    if (this.hum) this.hum.bed.gain.setTargetAtTime(v, this.now(), 0.3);
  }

  play(name, gain = 0.5, jitter = 0) {
    if (!this.ctx || !this.enabled) return;
    const c = this.ctx;
    const g = c.createGain();
    g.gain.value = gain;
    g.connect(this.master);
    const buf = this.buffers[name];
    if (buf) {
      const s = c.createBufferSource();
      s.buffer = buf;
      s.playbackRate.value = 1 + (Math.random() * 2 - 1) * jitter;
      s.connect(g);
      s.start();
      return;
    }
    // Synthesized fallbacks so nothing depends on a file being present.
    const t = c.currentTime;
    if (name === "tick" || name === "click") {
      const o = c.createOscillator(); o.type = "square"; o.frequency.value = name === "click" ? 900 : 2200;
      const e = c.createGain(); e.gain.setValueAtTime(0.5, t); e.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
      o.connect(e).connect(g); o.start(t); o.stop(t + 0.04);
    } else if (name === "slam") {
      const n = this.noiseBurst(0.25);
      const lp = c.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.setValueAtTime(900, t); lp.frequency.exponentialRampToValueAtTime(120, t + 0.25);
      const e = c.createGain(); e.gain.setValueAtTime(1, t); e.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
      n.connect(lp).connect(e).connect(g); n.start(t);
    } else if (name === "creak") {
      const o = c.createOscillator(); o.type = "sawtooth";
      o.frequency.setValueAtTime(180, t); o.frequency.exponentialRampToValueAtTime(90, t + 0.35);
      const bp = c.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 800; bp.Q.value = 3;
      const e = c.createGain(); e.gain.setValueAtTime(0.0001, t); e.gain.exponentialRampToValueAtTime(0.25, t + 0.05); e.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
      o.connect(bp).connect(e).connect(g); o.start(t); o.stop(t + 0.45);
    }
  }
  noiseBurst(seconds) {
    const c = this.ctx;
    const buf = c.createBuffer(1, c.sampleRate * seconds, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const s = c.createBufferSource();
    s.buffer = buf;
    return s;
  }
  // Per-letter blip: tiny square wave, pitch jittered, letters only.
  blip() {
    if (!this.ctx || !this.enabled || !this.blipEnabled) return;
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator(); o.type = "square";
    o.frequency.value = 118 * (1 + (Math.random() * 2 - 1) * 0.08);
    const e = c.createGain();
    e.gain.setValueAtTime(0.0001, t);
    e.gain.exponentialRampToValueAtTime(0.06, t + 0.004);
    e.gain.exponentialRampToValueAtTime(0.0001, t + 0.045);
    const lp = c.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 1400;
    o.connect(lp).connect(e).connect(this.master);
    o.start(t); o.stop(t + 0.05);
  }
  lampClick() { this.play("click", 0.6); }
}
