// Dice on wood, synthesised: no sound files to license or ship. A short filtered noise click plus a low knock,
// scaled by how hard the die hit. M mutes; the choice is kept per browser.

const KEY = 'rproll.muted';

export class Sound {
  constructor() {
    this.ctx = null;
    try {
      this.muted = localStorage.getItem(KEY) === '1';
    } catch {
      this.muted = false;
    }
  }

  // Browsers only start audio after the user did something on the page; call this on every key or click.
  wake() {
    if (this.muted) return;
    try {
      if (!this.ctx) {
        this.ctx = new AudioContext();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.32;
        this.master.connect(this.ctx.destination);
        const len = Math.floor(this.ctx.sampleRate * 0.12);
        this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = this.noise.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2;
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
    } catch {
      this.ctx = null;
    }
  }

  toggle() {
    this.muted = !this.muted;
    try {
      localStorage.setItem(KEY, this.muted ? '1' : '0');
    } catch { /* no storage, the choice lasts this session */ }
    if (!this.muted) this.wake();
    return this.muted;
  }

  hit(strength, wall, when = 0) {
    if (this.muted || !this.ctx || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime + when;
    const s = Math.max(0.08, Math.min(1, strength));

    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.85 + Math.random() * 0.3;
    const band = this.ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = wall ? 2600 : 1700 + Math.random() * 500;
    band.Q.value = 1.4;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.9 * s, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    src.connect(band).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + 0.12);

    const knock = this.ctx.createOscillator();
    knock.type = 'sine';
    knock.frequency.setValueAtTime(wall ? 260 : 170, t);
    knock.frequency.exponentialRampToValueAtTime(90, t + 0.06);
    const kg = this.ctx.createGain();
    kg.gain.setValueAtTime(0.5 * s, t);
    kg.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
    knock.connect(kg).connect(this.master);
    knock.start(t);
    knock.stop(t + 0.08);
  }

  // A soft two-note bell for a natural 20, a dull low one for a natural 1.
  flourish(high) {
    if (this.muted || !this.ctx || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime;
    const notes = high ? [784, 1175] : [196, 147];
    notes.forEach((f, i) => {
      const o = this.ctx.createOscillator();
      o.type = high ? 'triangle' : 'sine';
      o.frequency.value = f;
      const g = this.ctx.createGain();
      const start = t + i * 0.11;
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(0.35, start + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, start + (high ? 1.1 : 0.7));
      o.connect(g).connect(this.master);
      o.start(start);
      o.stop(start + 1.2);
    });
  }
}
