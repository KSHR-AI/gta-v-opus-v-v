// All sound is synthesized with WebAudio — no audio files needed.
const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12);

export const STATIONS = [
  { name: 'Radio Off' },
  { name: 'VELVET FM 97.3 — Synthwave', bpm: 100, style: 'synth' },
  { name: 'PULSE 101 — Club Techno', bpm: 126, style: 'techno' },
  { name: 'LOWRIDER 88.1 — Boom Bap', bpm: 88, style: 'hiphop' },
];

export class AudioSystem {
  constructor(game) {
    this.game = game;
    this.ctx = null;
    this.station = 1;
  }

  init() {
    if (this.ctx) { this.ctx.resume(); return; }
    const ctx = (this.ctx = new (window.AudioContext || window.webkitAudioContext)());
    this.master = ctx.createGain(); this.master.gain.value = 0.8; this.master.connect(ctx.destination);
    const comp = ctx.createDynamicsCompressor();
    comp.connect(this.master);
    this.sfx = ctx.createGain(); this.sfx.gain.value = 0.9; this.sfx.connect(comp);
    this.music = ctx.createGain(); this.music.gain.value = 0; this.music.connect(comp);
    this.musicLP = ctx.createBiquadFilter(); this.musicLP.type = 'lowpass'; this.musicLP.frequency.value = 18000; this.musicLP.connect(this.music);
    // noise buffer
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.setupEngine();
    this.setupSiren();
    this.setupAmbience();
    this.nextNoteTime = ctx.currentTime + 0.1;
    this.step = 0;
    setInterval(() => this.schedule(), 25);
  }

  vol(pos, maxDist = 120) {
    if (!pos) return 1;
    const c = this.game.camera.position;
    const d = Math.hypot(pos.x - c.x, pos.y - c.y, pos.z - c.z);
    return Math.max(0, 1 - d / maxDist) ** 1.5;
  }

  noiseSrc() {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    s.loopStart = Math.random();
    return s;
  }

  env(node, t, a, peak, dec, sustain = 0.0001) {
    node.gain.setValueAtTime(0.0001, t);
    node.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
    node.gain.exponentialRampToValueAtTime(Math.max(0.0001, sustain), t + a + dec);
  }

  burst({ pos, maxDist = 150, freq = 1000, q = 0.7, type = 'bandpass', gain = 1, dur = 0.2, attack = 0.002, dest }) {
    if (!this.ctx) return;
    const v = this.vol(pos, maxDist) * gain;
    if (v < 0.01) return;
    const t = this.ctx.currentTime;
    const n = this.noiseSrc();
    const f = this.ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = this.ctx.createGain();
    this.env(g, t, attack, v, dur);
    n.connect(f).connect(g).connect(dest || this.sfx);
    n.start(t, Math.random()); n.stop(t + attack + dur + 0.05);
  }

  tone({ pos, maxDist = 100, freq = 440, to, type = 'sine', gain = 0.3, dur = 0.2, attack = 0.005, when = 0, dest }) {
    if (!this.ctx) return;
    const v = this.vol(pos, maxDist) * gain;
    if (v < 0.005) return;
    const t = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = this.ctx.createGain();
    this.env(g, t, attack, v, dur);
    o.connect(g).connect(dest || this.sfx);
    o.start(t); o.stop(t + attack + dur + 0.05);
  }

  // --- one-shots ---
  shot(kind, pos, player = false) {
    const big = kind === 'shotgun' || kind === 'rocket';
    this.burst({ pos, maxDist: 260, freq: kind === 'smg' ? 1800 : 1200, q: 0.5, gain: (player ? 0.9 : 0.7) * (big ? 1.2 : 1), dur: big ? 0.35 : 0.16 });
    this.tone({ pos, maxDist: 260, freq: big ? 120 : 180, to: 40, type: 'sine', gain: big ? 0.9 : 0.6, dur: 0.15 });
  }
  explosion(pos) {
    this.burst({ pos, maxDist: 500, freq: 300, type: 'lowpass', q: 0.5, gain: 1.6, dur: 1.6, attack: 0.005 });
    this.tone({ pos, maxDist: 500, freq: 90, to: 25, gain: 1.2, dur: 1.2 });
  }
  crash(pos, s = 1) {
    this.burst({ pos, maxDist: 120, freq: 900, q: 0.4, gain: 0.5 + s, dur: 0.25 + s * 0.3 });
    this.burst({ pos, maxDist: 120, freq: 4000, q: 2, gain: 0.3 * s, dur: 0.4 });
  }
  thud(pos, s = 1) { this.tone({ pos, freq: 110, to: 45, gain: 0.6 * s, dur: 0.2 }); this.burst({ pos, freq: 400, type: 'lowpass', gain: 0.4 * s, dur: 0.12 }); }
  honk(pos) { for (const f of [392, 494]) this.tone({ pos, freq: f, type: 'square', gain: 0.12, dur: 0.5, attack: 0.01 }); }
  door(pos) { this.burst({ pos: pos || null, freq: 600, type: 'lowpass', gain: 0.4, dur: 0.08 }); this.tone({ pos: pos || null, freq: 140, to: 80, gain: 0.25, dur: 0.08 }); }
  click() { this.tone({ freq: 2200, type: 'square', gain: 0.08, dur: 0.02 }); }
  reload() { this.tone({ freq: 1400, type: 'square', gain: 0.06, dur: 0.03 }); this.tone({ freq: 900, type: 'square', gain: 0.06, dur: 0.04, when: 0.5 }); }
  punch() { this.burst({ freq: 300, type: 'lowpass', gain: 0.8, dur: 0.08 }); }
  swing() { this.burst({ freq: 1500, q: 1, gain: 0.15, dur: 0.12, attack: 0.04 }); }
  scream(pos) {
    if (!this.ctx || Math.random() > 0.3) return;
    const base = 600 + Math.random() * 500;
    this.tone({ pos, maxDist: 60, freq: base, to: base * 0.6, type: 'sawtooth', gain: 0.05, dur: 0.6, attack: 0.05 });
  }
  pickup() { [0, 4, 7, 12].forEach((n, i) => this.tone({ freq: NOTE(76 + n), type: 'square', gain: 0.07, dur: 0.08, when: i * 0.05 })); }
  cash() { [0, 7, 12].forEach((n, i) => this.tone({ freq: NOTE(84 + n), type: 'triangle', gain: 0.15, dur: 0.12, when: i * 0.06 })); }
  wantedUp() { this.tone({ freq: 880, type: 'square', gain: 0.07, dur: 0.12 }); this.tone({ freq: 660, type: 'square', gain: 0.07, dur: 0.15, when: 0.13 }); }
  jingle(success = true) {
    const seq = success ? [0, 4, 7, 12, 16, 19, 24] : [12, 11, 10, 9, 5];
    seq.forEach((n, i) => this.tone({ freq: NOTE(64 + n), type: 'triangle', gain: 0.2, dur: success ? 0.25 : 0.3, when: i * (success ? 0.09 : 0.18) }));
  }
  checkpoint() { this.tone({ freq: 1200, type: 'sine', gain: 0.2, dur: 0.15 }); this.tone({ freq: 1800, type: 'sine', gain: 0.2, dur: 0.2, when: 0.08 }); }

  // --- continuous ---
  setupEngine() {
    const ctx = this.ctx;
    this.engGain = ctx.createGain(); this.engGain.gain.value = 0;
    this.engLP = ctx.createBiquadFilter(); this.engLP.type = 'lowpass'; this.engLP.frequency.value = 800;
    this.engO1 = ctx.createOscillator(); this.engO1.type = 'sawtooth';
    this.engO2 = ctx.createOscillator(); this.engO2.type = 'square';
    const g2 = ctx.createGain(); g2.gain.value = 0.4;
    this.engO1.connect(this.engLP); this.engO2.connect(g2).connect(this.engLP);
    this.engLP.connect(this.engGain).connect(this.sfx);
    this.engO1.start(); this.engO2.start();
    this.skidGain = ctx.createGain(); this.skidGain.gain.value = 0;
    const sk = this.noiseSrc(); const skf = ctx.createBiquadFilter(); skf.type = 'bandpass'; skf.frequency.value = 2500; skf.Q.value = 3;
    sk.connect(skf).connect(this.skidGain).connect(this.sfx); sk.start();
  }

  setupSiren() {
    const ctx = this.ctx;
    this.sirenGain = ctx.createGain(); this.sirenGain.gain.value = 0;
    this.sirenOsc = ctx.createOscillator(); this.sirenOsc.type = 'square';
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.35;
    const lfoG = ctx.createGain(); lfoG.gain.value = 380;
    this.sirenOsc.frequency.value = 1000;
    lfo.connect(lfoG).connect(this.sirenOsc.frequency);
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 2200;
    this.sirenOsc.connect(f).connect(this.sirenGain).connect(this.sfx);
    this.sirenOsc.start(); lfo.start();
    this.hornGain = ctx.createGain(); this.hornGain.gain.value = 0;
    for (const fr of [370, 466]) { const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = fr; o.connect(this.hornGain); o.start(); }
    const hf = ctx.createBiquadFilter(); hf.type = 'lowpass'; hf.frequency.value = 1800;
    this.hornGain.disconnect(); this.hornGain.connect(hf).connect(this.sfx);
  }

  setupAmbience() {
    const ctx = this.ctx;
    const n = this.noiseSrc();
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 400;
    this.ambGain = ctx.createGain(); this.ambGain.gain.value = 0.05;
    n.connect(f).connect(this.ambGain).connect(this.sfx); n.start();
    this.waveGain = ctx.createGain(); this.waveGain.gain.value = 0;
    const n2 = this.noiseSrc(); const f2 = ctx.createBiquadFilter(); f2.type = 'bandpass'; f2.frequency.value = 600; f2.Q.value = 0.4;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.12; const lg = ctx.createGain(); lg.gain.value = 0.04;
    lfo.connect(lg).connect(this.waveGain.gain); lfo.start();
    n2.connect(f2).connect(this.waveGain).connect(this.sfx); n2.start();
  }

  update(dt) {
    if (!this.ctx) return;
    const g = this.game, t = this.ctx.currentTime;
    const v = g.player.vehicle;
    if (v && !v.destroyed) {
      const sp = Math.abs(v.forwardSpeed);
      const gearSpan = 11;
      const gear = Math.min(5, Math.floor(sp / gearSpan));
      const rpm = gear >= 5 ? sp / (gearSpan * 6) : (sp - gear * gearSpan) / gearSpan;
      const throttle = g.input.down('KeyW') ? 1 : 0.4;
      const base = 38 + rpm * 70 + gear * 6;
      this.engO1.frequency.setTargetAtTime(base, t, 0.05);
      this.engO2.frequency.setTargetAtTime(base * 0.5, t, 0.05);
      this.engLP.frequency.setTargetAtTime(400 + rpm * 1200 * throttle + 300, t, 0.05);
      this.engGain.gain.setTargetAtTime(0.13 + throttle * 0.07, t, 0.1);
      const fx = Math.sin(v.heading), fz = Math.cos(v.heading);
      const side = Math.abs(v.vel.x * -fz + v.vel.y * fx);
      this.skidGain.gain.setTargetAtTime(v.grounded && side > 4 ? Math.min(0.25, (side - 4) * 0.04) : 0, t, 0.05);
      this.hornGain.gain.setTargetAtTime(v.horn ? 0.08 : 0, t, 0.02);
    } else {
      this.engGain.gain.setTargetAtTime(0, t, 0.1);
      this.skidGain.gain.setTargetAtTime(0, t, 0.05);
      this.hornGain.gain.setTargetAtTime(0, t, 0.02);
    }
    // siren: closest vehicle with siren on
    let best = 0;
    for (const veh of g.vehicles) if (veh.sirenOn && !veh.destroyed) best = Math.max(best, this.vol(veh.pos, 180));
    this.sirenGain.gain.setTargetAtTime(best * 0.07, t, 0.1);
    // ambience: louder in downtown, waves near the coast
    const p = g.player.worldPos;
    const coast = Math.max(0, 1 - Math.min(Math.abs(Math.abs(p.x) - 380), Math.abs(p.z - 440), Math.abs(p.z + 370)) / 80);
    this.waveGain.gain.setTargetAtTime(0.02 + coast * 0.06, t, 0.5);
    // music
    const st = STATIONS[this.station];
    const on = v && st.bpm && !g.paused;
    this.music.gain.setTargetAtTime(on ? 0.32 : 0, t, 0.3);
    this.musicLP.frequency.setTargetAtTime(g.paused ? 600 : 18000, t, 0.2);
  }

  nextStation() {
    this.station = (this.station + 1) % STATIONS.length;
    return STATIONS[this.station].name;
  }

  // --- procedural radio ---
  schedule() {
    const ctx = this.ctx;
    const st = STATIONS[this.station];
    if (!st.bpm || !this.game.player?.vehicle) { this.nextNoteTime = ctx.currentTime + 0.05; return; }
    const sixteenth = 60 / st.bpm / 4;
    while (this.nextNoteTime < ctx.currentTime + 0.12) {
      this.playStep(st, this.step, this.nextNoteTime, sixteenth);
      this.nextNoteTime += sixteenth;
      this.step = (this.step + 1) % 256;
    }
  }

  drum(kind, t, gain = 1) {
    const ctx = this.ctx, out = this.musicLP;
    if (kind === 'kick') {
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
      g.gain.setValueAtTime(0.9 * gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
      o.connect(g).connect(out); o.start(t); o.stop(t + 0.32);
    } else {
      const n = this.noiseSrc(); const f = ctx.createBiquadFilter(); const g = ctx.createGain();
      f.type = kind === 'hat' ? 'highpass' : 'bandpass';
      f.frequency.value = kind === 'hat' ? 7000 : 1800;
      const dur = kind === 'hat' ? 0.04 : kind === 'openhat' ? 0.18 : 0.16;
      g.gain.setValueAtTime((kind === 'snare' ? 0.45 : 0.15) * gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      n.connect(f).connect(g).connect(out); n.start(t, Math.random()); n.stop(t + dur + 0.02);
    }
  }

  synth(freq, t, dur, { type = 'sawtooth', gain = 0.1, cutoff = 2000, res = 1, attack = 0.005, sweep } = {}) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = type; o.frequency.value = freq;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(cutoff, t); f.Q.value = res;
    if (sweep) f.frequency.exponentialRampToValueAtTime(sweep, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f).connect(g).connect(this.musicLP); o.start(t); o.stop(t + dur + 0.02);
  }

  playStep(st, step, t, s16) {
    const bar = Math.floor(step / 16), s = step % 16;
    if (st.style === 'synth') {
      const prog = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]]; // Am F C G
      const chord = prog[bar % 4];
      if (s % 4 === 0) this.drum('kick', t);
      if (s === 4 || s === 12) this.drum('snare', t);
      if (s % 2 === 0) this.drum('hat', t, 0.7);
      if (s % 2 === 0) this.synth(NOTE(chord[0] - 24), t, s16 * 1.8, { gain: 0.16, cutoff: 500, res: 4 });
      if (s === 0) for (const n of chord) this.synth(NOTE(n), t, s16 * 15, { gain: 0.035, cutoff: 1400, attack: 0.3 });
      const arp = [0, 1, 2, 1, 2, 0, 2, 1];
      if (bar % 8 >= 2) this.synth(NOTE(chord[arp[s % 8]] + 12), t, s16 * 0.9, { type: 'square', gain: 0.035, cutoff: 3000 });
    } else if (st.style === 'techno') {
      const roots = [45, 45, 43, 48];
      const r = roots[Math.floor(bar / 2) % 4];
      if (s % 4 === 0) this.drum('kick', t, 1.1);
      if (s % 4 === 2) this.drum('openhat', t);
      if (s === 4 || s === 12) this.drum('snare', t, 0.5);
      if (s % 4 === 2 || s % 8 === 7) this.synth(NOTE(r - 12), t, s16 * 1.2, { gain: 0.15, cutoff: 300 + ((step * 37) % 900), res: 8, sweep: 200 });
      const acid = [0, 0, 12, 0, 3, 0, 15, 7];
      if (bar % 4 >= 1 && s % 2 === 1) this.synth(NOTE(r + acid[(s >> 1) % 8]), t, s16 * 0.8, { gain: 0.05, cutoff: 600 + Math.sin(step / 20) * 500 + 500, res: 12 });
    } else if (st.style === 'hiphop') {
      const roots = [50, 50, 46, 48];
      const r = roots[bar % 4];
      if (s === 0 || s === 7 || s === 10) this.drum('kick', t, 1.1);
      if (s === 4 || s === 12) this.drum('snare', t, 1.1);
      if (s % 2 === 0) this.drum('hat', t, s % 4 === 0 ? 1 : 0.6);
      if (s === 0 || s === 10) this.synth(NOTE(r - 24), t, s16 * 5, { type: 'sine', gain: 0.35, cutoff: 400 });
      if (s === 0 || s === 8) for (const n of [r, r + 3, r + 7, r + 10]) this.synth(NOTE(n), t, s16 * 6, { type: 'triangle', gain: 0.03, cutoff: 1800, attack: 0.02 });
    }
  }
}
