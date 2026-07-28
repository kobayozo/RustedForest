// Web Audio APIでの再生管理。CC0の効果音ファイル(Kenney製)をデコードして保持し、
// 同時再生・ピッチのランダム変化(同じ音の連発感を減らす)に対応する
export class AudioManager {
  constructor() {
    this.context = null;
    this.buffers = new Map();
    this.masterGain = null;
  }

  init() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.context = new Ctx();
    this.masterGain = this.context.createGain();
    this.masterGain.gain.value = 0.7;
    this.masterGain.connect(this.context.destination);

    // ブラウザの自動再生制限のため、最初のクリックでcontextを再開する
    const resume = () => {
      if (this.context.state === 'suspended') this.context.resume();
    };
    window.addEventListener('click', resume, { once: true });
    window.addEventListener('keydown', resume, { once: true });
  }

  async load(name, url) {
    const res = await fetch(url);
    const arrayBuffer = await res.arrayBuffer();
    const audioBuffer = await this.context.decodeAudioData(arrayBuffer);
    this.buffers.set(name, audioBuffer);
  }

  async loadAll(nameToUrl) {
    await Promise.all(Object.entries(nameToUrl).map(([name, url]) => this.load(name, url)));
  }

  play(name, { volume = 1, pitchVariance = 0, pitch = 1 } = {}) {
    const buffer = this.buffers.get(name);
    if (!buffer || !this.context) return;

    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = pitch + (Math.random() * 2 - 1) * pitchVariance;

    const gain = this.context.createGain();
    gain.gain.value = volume;
    source.connect(gain).connect(this.masterGain);
    source.start();
  }

  playRandom(names, opts) {
    const name = names[Math.floor(Math.random() * names.length)];
    this.play(name, opts);
  }
}
