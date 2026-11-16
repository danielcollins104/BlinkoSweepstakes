// ============================================================================
// PROCEDURAL WEB AUDIO SYNTHESIZER FOR BLINKO
// ============================================================================
class BlinkoSoundEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
  }

  _ensureCtx() {
    if (this.muted || typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return null;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  setMuted(muted) {
    this.muted = Boolean(muted);
  }

  playButtonClick(freq = 520) {
    const ctx = this._ensureCtx();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, now);
    osc.frequency.exponentialRampToValueAtTime(freq * 1.15, now + 0.04);
    gain.gain.setValueAtTime(0.08, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.055);
  }

  playDropLaunch() {
    const ctx = this._ensureCtx();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(280, now);
    osc.frequency.exponentialRampToValueAtTime(590, now + 0.09);
    gain.gain.setValueAtTime(0.11, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.11);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.12);
  }

  playPegBounce(rowRatio = 0.5, isBumper = false) {
    const ctx = this._ensureCtx();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = isBumper ? 'square' : 'sine';
    const baseFreq = isBumper ? 440 : 480 + rowRatio * 420;
    osc.frequency.setValueAtTime(baseFreq, now);
    osc.frequency.exponentialRampToValueAtTime(isBumper ? 880 : baseFreq * 0.72, now + (isBumper ? 0.11 : 0.045));
    gain.gain.setValueAtTime(isBumper ? 0.09 : 0.045, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + (isBumper ? 0.12 : 0.05));
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + (isBumper ? 0.13 : 0.055));
  }

  playBucketLand(multiplier = 1) {
    const ctx = this._ensureCtx();
    if (!ctx) return;
    const now = ctx.currentTime;
    const notes =
      multiplier >= 25
        ? [523.25, 659.25, 783.99, 1046.5, 1318.5]
        : multiplier >= 2
        ? [523.25, 659.25, 783.99]
        : multiplier >= 1
        ? [440, 523.25]
        : [220, 175];

    notes.forEach((freq, idx) => {
      const t = now + idx * 0.045;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = multiplier >= 10 ? 'triangle' : 'sine';
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(multiplier >= 10 ? 0.12 : 0.07, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.17);
    });
  }

  dispose() {
    if (this.ctx && typeof this.ctx.close === 'function') {
      this.ctx.close().catch(() => {});
      this.ctx = null;
    }
  }
}

export const soundEngine = new BlinkoSoundEngine();
