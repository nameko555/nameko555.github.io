export class SoundManager {
  constructor(warnEl) {
    this.warnEl = warnEl;
    this.ctx = null;
    this.unlocked = false;
    this.failed = false;
  }

  async unlock() {
    if (this.unlocked || this.failed) return;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) throw new Error('AudioContext unavailable');
      this.ctx = new Ctx();
      await this.ctx.resume();
      this.unlocked = true;
      this.warnEl?.classList.remove('on');
    } catch (e) {
      this.failed = true;
      this.warnEl?.classList.add('on');
    }
  }

  /**
   * Very small SE: oscillator beep
   */
  beep({ enabled, volume, type }) {
    if (!enabled) return;
    if (!this.unlocked || !this.ctx) return;

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    const freq = type === 'ok' ? 880 : type === 'bad' ? 180 : 520;
    const dur = type === 'ok' ? 0.08 : type === 'bad' ? 0.12 : 0.06;

    osc.frequency.setValueAtTime(freq, now);
    osc.type = 'sine';

    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(Math.max(0, Math.min(1, volume)) * 0.12, now + 0.01);
    gain.gain.linearRampToValueAtTime(0, now + dur);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(now);
    osc.stop(now + dur + 0.02);
  }
}
