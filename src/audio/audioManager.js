// Web Audio APIでの再生管理。CC0の効果音ファイル(Kenney製)をデコードして保持し、
// 同時再生・ピッチのランダム変化(同じ音の連発感を減らす)に対応する。
// 剣の振り/斬撃はサンプルより「さわやかな風切り」「迫力ある刃」を出しやすい合成音を使う
export class AudioManager {
  constructor() {
    this.context = null;
    this.buffers = new Map();
    this.masterGain = null;
    this.bgmGain = null;
    this._bgmSources = new Map(); // name -> { source, gain }
    this._activeBgm = null;
    // 通常時(探索)BGMの候補。load 後に存在するキーだけ使う
    this._exploreBgmNames = [
      'exploreJourney',
      'exploreFantasy',
      'exploreArcana',
      'exploreAdventure',
      'exploreEternal',
      'exploreLegend',
    ];
    this._lastExploreBgm = null;
    this._combatMode = null;
  }

  init() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.context = new Ctx();
    this.masterGain = this.context.createGain();
    this.masterGain.gain.value = 0.6;
    this.masterGain.connect(this.context.destination);

    this.bgmGain = this.context.createGain();
    this.bgmGain.gain.value = 0.28;
    this.bgmGain.connect(this.masterGain);

    // ブラウザの自動再生制限のため、最初のクリックでcontextを再開する
    const resume = () => {
      if (this.context.state === 'suspended') this.context.resume();
    };
    window.addEventListener('click', resume, { once: true });
    window.addEventListener('keydown', resume, { once: true });
  }

  async load(name, url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Audio load failed: ${name} (${res.status})`);
    const arrayBuffer = await res.arrayBuffer();
    // HTMLエラーページなどを誤ってデコードしない
    const head = new Uint8Array(arrayBuffer, 0, Math.min(16, arrayBuffer.byteLength));
    const ascii = String.fromCharCode(...head);
    if (ascii.startsWith('<!') || ascii.startsWith('<html') || ascii.startsWith('<HTML')) {
      throw new Error(`Audio load got HTML instead of media: ${name}`);
    }
    const audioBuffer = await this.context.decodeAudioData(arrayBuffer);
    this.buffers.set(name, audioBuffer);
  }

  async loadAll(nameToUrl) {
    const results = await Promise.allSettled(
      Object.entries(nameToUrl).map(([name, url]) => this.load(name, url)),
    );
    for (const r of results) {
      if (r.status === 'rejected') {
        console.warn('[audio]', r.reason?.message || r.reason);
      }
    }
  }

  play(name, { volume = 1, pitchVariance = 0, pitch = 1, offset = 0, duration = null } = {}) {
    const buffer = this.buffers.get(name);
    if (!buffer || !this.context) return;

    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = pitch + (Math.random() * 2 - 1) * pitchVariance;

    const gain = this.context.createGain();
    gain.gain.value = volume;
    source.connect(gain).connect(this.masterGain);
    const startOffset = Math.max(0, Math.min(offset, Math.max(0, buffer.duration - 0.05)));
    if (duration != null && duration > 0) {
      source.start(0, startOffset, duration);
    } else {
      source.start(0, startOffset);
    }
  }

  playRandom(names, opts) {
    const name = names[Math.floor(Math.random() * names.length)];
    this.play(name, opts);
  }

  /** 聖杯瓶使用時の回復音（キラキラした高音ベル＋スパークル） */
  playFlaskHeal({ volume = 0.9 } = {}) {
    const ctx = this.context;
    if (!ctx) return;
    const t0 = ctx.currentTime;

    // 明るい上昇アルペジオ（クリスタル寄り）
    const tones = [784, 988, 1175, 1568, 1976]; // G5 B5 D6 G6 B6
    for (let i = 0; i < tones.length; i++) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      const f = tones[i];
      const start = t0 + i * 0.055;
      osc.frequency.setValueAtTime(f, start);
      osc.frequency.exponentialRampToValueAtTime(f * 1.01, start + 0.4);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(volume * (0.2 - i * 0.025), start + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, start + 0.55);
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 600;
      osc.connect(hp).connect(g).connect(this.masterGain);
      osc.start(start);
      osc.stop(start + 0.6);

      // 倍音でキラッとさせる短い三角波
      const shimmer = ctx.createOscillator();
      shimmer.type = 'triangle';
      shimmer.frequency.setValueAtTime(f * 2, start);
      const sg = ctx.createGain();
      sg.gain.setValueAtTime(0.0001, start);
      sg.gain.exponentialRampToValueAtTime(volume * 0.08, start + 0.01);
      sg.gain.exponentialRampToValueAtTime(0.0001, start + 0.22);
      shimmer.connect(sg).connect(this.masterGain);
      shimmer.start(start);
      shimmer.stop(start + 0.25);
    }

    // スパークル（細かい高域ノイズ粒）
    const rate = ctx.sampleRate;
    const sparkDur = 0.55;
    const n = Math.floor(rate * sparkDur);
    const buffer = ctx.createBuffer(1, n, rate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < n; i++) {
      const u = i / n;
      const env = Math.pow(1 - u, 1.8) * (0.35 + 0.65 * Math.sin(u * Math.PI));
      // まばらな粒
      data[i] = Math.random() > 0.86 ? (Math.random() * 2 - 1) * env : 0;
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 5200;
    bp.Q.value = 0.7;
    const ng = ctx.createGain();
    ng.gain.value = volume * 0.55;
    src.connect(bp).connect(ng).connect(this.masterGain);
    src.start(t0);
    src.stop(t0 + sparkDur + 0.02);
  }

  /** ドラゴンの重厚な地響き */
  playDragonStomp({ volume = 0.85 } = {}) {
    const ctx = this.context;
    if (!ctx) return;
    const t0 = ctx.currentTime;
    const dur = 0.55;
    const rate = ctx.sampleRate;
    const n = Math.floor(rate * dur);
    const buffer = ctx.createBuffer(1, n, rate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < n; i++) {
      const env = Math.pow(1 - i / n, 1.8);
      data[i] = (Math.random() * 2 - 1) * env;
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 180;
    lp.Q.value = 0.7;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(volume * 0.9, t0 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(lp).connect(gain).connect(this.masterGain);
    src.start(t0);
    src.stop(t0 + dur + 0.02);

    // 低い正弦で胴体の振動感
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(42, t0);
    osc.frequency.exponentialRampToValueAtTime(28, t0 + dur);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, t0);
    og.gain.exponentialRampToValueAtTime(volume * 0.45, t0 + 0.015);
    og.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(og).connect(this.masterGain);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  /** ドラゴンの咆哮（サンプル優先、無ければ合成） */
  playDragonRoar({ volume = 0.95 } = {}) {
    if (this.buffers.has('dragonRoar')) {
      const buf = this.buffers.get('dragonRoar');
      // 長尺は冒頭〜中盤を切り出し、攻撃タイミングに合わせる
      const maxStart = Math.max(0, (buf?.duration ?? 2) - 1.8);
      const offset = Math.random() * Math.min(0.4, maxStart);
      this.play('dragonRoar', {
        volume: volume * 0.95,
        pitchVariance: 0.03,
        pitch: 0.88 + Math.random() * 0.1,
        offset,
        duration: Math.min(2.2, Math.max(1.2, (buf?.duration ?? 2) - offset)),
      });
      return;
    }
    const ctx = this.context;
    if (!ctx) return;
    const t0 = ctx.currentTime;
    const dur = 1.35;
    const rate = ctx.sampleRate;
    const n = Math.floor(rate * dur);
    const buffer = ctx.createBuffer(1, n, rate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < n; i++) {
      const u = i / n;
      const env = u < 0.12 ? u / 0.12 : u > 0.7 ? (1 - u) / 0.3 : 1;
      data[i] = (Math.random() * 2 - 1) * env;
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 320;
    bp.Q.value = 0.55;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(volume * 0.7, t0 + 0.08);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(bp).connect(gain).connect(this.masterGain);
    src.start(t0);
    src.stop(t0 + dur + 0.02);

    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(95, t0);
    osc.frequency.exponentialRampToValueAtTime(55, t0 + dur * 0.85);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, t0);
    og.gain.exponentialRampToValueAtTime(volume * 0.28, t0 + 0.1);
    og.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 700;
    osc.connect(lp).connect(og).connect(this.masterGain);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  /** 短い唸り（グルグル。サンプル優先） */
  playDragonGrowl({ volume = 0.7 } = {}) {
    if (this.buffers.has('dragonGrowl') || this.buffers.has('dragonSnarl')) {
      const useSnarl = this.buffers.has('dragonSnarl') && Math.random() < 0.4;
      if (useSnarl) {
        this.play('dragonSnarl', { volume: volume * 0.9, pitchVariance: 0.05, pitch: 0.92 });
        return;
      }
      // troll-roars(CC0)は約11秒のパック。頭〜中盤をランダムに短く切って再生
      const buf = this.buffers.get('dragonGrowl');
      const maxStart = Math.max(0, (buf?.duration ?? 2) - 1.4);
      const offset = Math.random() * maxStart;
      this.play('dragonGrowl', {
        volume: volume * 0.9,
        pitchVariance: 0.04,
        pitch: 0.85 + Math.random() * 0.2,
        offset,
        duration: 1.1 + Math.random() * 0.5,
      });
      return;
    }
    const ctx = this.context;
    if (!ctx) return;
    const t0 = ctx.currentTime;
    const dur = 0.55;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(70, t0);
    osc.frequency.exponentialRampToValueAtTime(48, t0 + dur);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 480;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(volume * 0.35, t0 + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(lp).connect(gain).connect(this.masterGain);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);

    const rate = ctx.sampleRate;
    const n = Math.floor(rate * dur);
    const buffer = ctx.createBuffer(1, n, rate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < n; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 1.5);
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const bp = ctx.createBiquadFilter();
    bp.type = 'lowpass';
    bp.frequency.value = 220;
    const ng = ctx.createGain();
    ng.gain.value = volume * 0.4;
    src.connect(bp).connect(ng).connect(this.masterGain);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  // 短く明るいノイズの風切り。knifeSliceより金属感を抑え、さわやかに振る音にする
  playSwordSwing({ heavy = false } = {}) {
    const ctx = this.context;
    if (!ctx) return;
    const t0 = ctx.currentTime;
    const dur = heavy ? 0.22 : 0.14;
    const rate = ctx.sampleRate;
    const n = Math.floor(rate * dur);
    const buffer = ctx.createBuffer(1, n, rate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < n; i++) {
      const env = Math.sin((Math.PI * i) / n);
      data[i] = (Math.random() * 2 - 1) * env;
    }

    const src = ctx.createBufferSource();
    src.buffer = buffer;

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = heavy ? 1400 : 2200;
    bp.Q.value = heavy ? 0.7 : 1.1;

    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = heavy ? 400 : 700;

    const gain = ctx.createGain();
    const peak = heavy ? 0.55 : 0.42;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    src.connect(bp).connect(hp).connect(gain).connect(this.masterGain);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  // 切り傷寄りのヒット音: 肉を裂くウェットなノイズ + 刃の鋭い抜け
  playSwordSlashHit({ heavy = false } = {}) {
    const ctx = this.context;
    if (!ctx) return;
    const t0 = ctx.currentTime;
    const pitchJitter = 1 + (Math.random() * 0.1 - 0.05);

    // ウェットな裂傷ノイズ(バンドが中高域で「ズバッ」)
    {
      const dur = heavy ? 0.32 : 0.22;
      const rate = ctx.sampleRate;
      const n = Math.floor(rate * dur);
      const buffer = ctx.createBuffer(1, n, rate);
      const data = buffer.getChannelData(0);
      let brown = 0;
      for (let i = 0; i < n; i++) {
        const t = i / n;
        // ブラウンノイズ寄りで肉質感、序盤に鋭いアタック
        brown = (brown + (Math.random() * 2 - 1) * 0.08) * 0.97;
        const env = Math.pow(1 - t, 1.15) * (0.35 + 0.65 * Math.exp(-t * 18));
        data[i] = (brown * 3.2 + (Math.random() * 2 - 1) * 0.35) * env;
      }
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime((heavy ? 900 : 1200) * pitchJitter, t0);
      bp.frequency.exponentialRampToValueAtTime(450, t0 + dur * 0.65);
      bp.Q.value = 0.85;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(heavy ? 0.9 : 0.72, t0 + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      src.connect(bp).connect(g).connect(this.masterGain);
      src.start(t0);
      src.stop(t0 + dur + 0.02);
    }

    // 刃の鋭い切れ込み(短い高域スイープ)
    {
      const dur = heavy ? 0.16 : 0.11;
      const rate = ctx.sampleRate;
      const n = Math.floor(rate * dur);
      const buffer = ctx.createBuffer(1, n, rate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < n; i++) {
        const env = Math.pow(1 - i / n, 2.2);
        data[i] = (Math.random() * 2 - 1) * env;
      }
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime((heavy ? 3200 : 4200) * pitchJitter, t0);
      bp.frequency.exponentialRampToValueAtTime(1400, t0 + dur);
      bp.Q.value = 2.2;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(heavy ? 0.55 : 0.42, t0 + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      src.connect(bp).connect(g).connect(this.masterGain);
      src.start(t0);
      src.stop(t0 + dur + 0.02);
    }

    // わずかな低域の食い込み
    {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime((heavy ? 85 : 110) * pitchJitter, t0);
      osc.frequency.exponentialRampToValueAtTime(45, t0 + 0.12);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(heavy ? 0.35 : 0.22, t0 + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.14);
      osc.connect(g).connect(this.masterGain);
      osc.start(t0);
      osc.stop(t0 + 0.16);
    }
  }

  // エルデンリングの中量ロールに近い多層SE:
  // 1) 空気のwhoosh  2) 衣擦れ  3) 軽い鎧の金属  4) 足元の擦れ / 着地
  playEldenRoll() {
    const ctx = this.context;
    if (!ctx) return;
    const t0 = ctx.currentTime;
    const pitchJitter = 1 + (Math.random() * 0.08 - 0.04);

    // --- 1. 空気を切るメインの whoosh (帯域が下がっていくスイープ) ---
    {
      const dur = 0.28;
      const rate = ctx.sampleRate;
      const n = Math.floor(rate * dur);
      const buffer = ctx.createBuffer(1, n, rate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < n; i++) {
        const t = i / n;
        const env = Math.sin(Math.PI * Math.min(1, t * 1.35)) * Math.pow(1 - t, 0.55);
        data[i] = (Math.random() * 2 - 1) * env;
      }
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.playbackRate.value = pitchJitter;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(1600 * pitchJitter, t0);
      bp.frequency.exponentialRampToValueAtTime(380, t0 + dur * 0.85);
      bp.Q.value = 0.75;
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 220;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.72, t0 + 0.018);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      src.connect(bp).connect(hp).connect(g).connect(this.masterGain);
      src.start(t0);
      src.stop(t0 + dur + 0.02);
    }

    // --- 2. 衣擦れ / 布 (サンプルがあれば重ね、無ければ合成ノイズ) ---
    {
      const clothNames = ['kickCloth1', 'cloth2', 'cloth3'].filter((n) => this.buffers.has(n));
      if (clothNames.length > 0) {
        const name = clothNames[Math.floor(Math.random() * clothNames.length)];
        const buffer = this.buffers.get(name);
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        src.playbackRate.value = 0.92 + Math.random() * 0.16;
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = 900;
        bp.Q.value = 0.8;
        const g = ctx.createGain();
        g.gain.value = 0.55;
        src.connect(bp).connect(g).connect(this.masterGain);
        src.start(t0 + 0.02);
      } else {
        const dur = 0.22;
        const rate = ctx.sampleRate;
        const n = Math.floor(rate * dur);
        const buffer = ctx.createBuffer(1, n, rate);
        const data = buffer.getChannelData(0);
        let brown = 0;
        for (let i = 0; i < n; i++) {
          brown = (brown + (Math.random() * 2 - 1) * 0.12) * 0.94;
          data[i] = brown * 4 * Math.pow(1 - i / n, 1.2);
        }
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = 700;
        bp.Q.value = 0.7;
        const g = ctx.createGain();
        g.gain.value = 0.4;
        src.connect(bp).connect(g).connect(this.masterGain);
        src.start(t0 + 0.02);
        src.stop(t0 + dur + 0.04);
      }
    }

    // --- 3. 軽い鎧の金属カチャ (短い高域 + 少し低い響き) ---
    {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(780 * pitchJitter, t0 + 0.03);
      osc.frequency.exponentialRampToValueAtTime(210, t0 + 0.16);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1100;
      bp.Q.value = 3.2;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0 + 0.03);
      g.gain.exponentialRampToValueAtTime(0.18, t0 + 0.038);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.2);
      osc.connect(bp).connect(g).connect(this.masterGain);
      osc.start(t0 + 0.03);
      osc.stop(t0 + 0.22);
    }

    // --- 4a. 踏み出しの足元擦れ ---
    {
      const dur = 0.09;
      const rate = ctx.sampleRate;
      const n = Math.floor(rate * dur);
      const buffer = ctx.createBuffer(1, n, rate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < n; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2.5);
      }
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 650;
      const g = ctx.createGain();
      g.gain.value = 0.38;
      src.connect(lp).connect(g).connect(this.masterGain);
      src.start(t0);
      src.stop(t0 + dur + 0.02);
    }

    // --- 4b. 着地寄りのドスッ (ロール後半) ---
    {
      const landAt = t0 + 0.26;
      if (this.buffers.has('footstep0')) {
        const names = ['footstep0', 'footstep1', 'footstep2', 'footstep3', 'footstep4'].filter((n) =>
          this.buffers.has(n),
        );
        const name = names[Math.floor(Math.random() * names.length)];
        const src = ctx.createBufferSource();
        src.buffer = this.buffers.get(name);
        src.playbackRate.value = 0.85 + Math.random() * 0.1;
        const g = ctx.createGain();
        g.gain.value = 0.42;
        src.connect(g).connect(this.masterGain);
        src.start(landAt);
      } else {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(95, landAt);
        osc.frequency.exponentialRampToValueAtTime(40, landAt + 0.12);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, landAt);
        g.gain.exponentialRampToValueAtTime(0.28, landAt + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, landAt + 0.14);
        osc.connect(g).connect(this.masterGain);
        osc.start(landAt);
        osc.stop(landAt + 0.16);
      }
    }
  }

  // 盾ブロックの金属音(短いクラング + 響き)
  playShieldBlock() {
    const ctx = this.context;
    if (!ctx) return;
    const t0 = ctx.currentTime;
    const pitchJitter = 1 + (Math.random() * 0.08 - 0.04);

    {
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.setValueAtTime(520 * pitchJitter, t0);
      osc.frequency.exponentialRampToValueAtTime(180, t0 + 0.18);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 900;
      bp.Q.value = 2.5;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.45, t0 + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.22);
      osc.connect(bp).connect(g).connect(this.masterGain);
      osc.start(t0);
      osc.stop(t0 + 0.25);
    }

    {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(1400 * pitchJitter, t0);
      osc.frequency.exponentialRampToValueAtTime(420, t0 + 0.28);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.22, t0 + 0.003);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.3);
      osc.connect(g).connect(this.masterGain);
      osc.start(t0);
      osc.stop(t0 + 0.32);
    }

    {
      const dur = 0.08;
      const rate = ctx.sampleRate;
      const n = Math.floor(rate * dur);
      const buffer = ctx.createBuffer(1, n, rate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < n; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3);
      }
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 1800;
      const g = ctx.createGain();
      g.gain.value = 0.35;
      src.connect(hp).connect(g).connect(this.masterGain);
      src.start(t0);
      src.stop(t0 + dur + 0.02);
    }
  }

  // ループBGMを開始。既に同じ曲なら何もしない
  playBgm(name, { volume = 1, fade = 1.2 } = {}) {
    if (!this.context || !this.bgmGain) return;
    if (this._activeBgm === name) return;
    const buffer = this.buffers.get(name);
    if (!buffer) return;

    const prev = this._activeBgm;
    this._activeBgm = name;
    const t0 = this.context.currentTime;

    // 前の曲をフェードアウト
    if (prev) {
      const old = this._bgmSources.get(prev);
      if (old) {
        old.gain.gain.cancelScheduledValues(t0);
        old.gain.gain.setValueAtTime(old.gain.gain.value, t0);
        old.gain.gain.linearRampToValueAtTime(0.0001, t0 + fade);
        const stopAt = t0 + fade + 0.05;
        try {
          old.source.stop(stopAt);
        } catch {
          /* already stopped */
        }
        this._bgmSources.delete(prev);
      }
    }

    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const gain = this.context.createGain();
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.linearRampToValueAtTime(volume, t0 + fade);
    source.connect(gain).connect(this.bgmGain);
    source.start(t0);
    this._bgmSources.set(name, { source, gain });
  }

  stopBgm({ fade = 1.5 } = {}) {
    if (!this.context || !this._activeBgm) return;
    const name = this._activeBgm;
    const old = this._bgmSources.get(name);
    this._activeBgm = null;
    this._combatMode = null;
    if (!old) return;
    const t0 = this.context.currentTime;
    old.gain.gain.cancelScheduledValues(t0);
    old.gain.gain.setValueAtTime(old.gain.gain.value, t0);
    old.gain.gain.linearRampToValueAtTime(0.0001, t0 + fade);
    try {
      old.source.stop(t0 + fade + 0.05);
    } catch {
      /* already stopped */
    }
    this._bgmSources.delete(name);
  }

  /**
   * mode: 'explore' | 'normal'(通常戦闘/FF風) | 'boss'(ドラゴン専用)
   * 探索に入るたび壮大な曲からランダム選曲(すでに探索曲再生中なら維持)
   */
  setCombatMusic(mode) {
    if (mode === this._combatMode && mode !== 'explore') return;
    if (mode === 'boss') {
      this._combatMode = mode;
      this.playBgm('bossBgm', { volume: 0.95, fade: 0.9 });
      return;
    }
    if (mode === 'normal') {
      this._combatMode = mode;
      this.playBgm('battleNormalBgm', { volume: 0.85, fade: 0.9 });
      return;
    }
    // explore
    const alreadyExplore =
      this._combatMode === 'explore' && this._isExploreBgm(this._activeBgm);
    if (alreadyExplore) return;
    this._combatMode = 'explore';
    const name = this._pickExploreBgm();
    this.playBgm(name, { volume: 0.78, fade: 1.4 });
  }

  _isExploreBgm(name) {
    return !!name && this._exploreBgmNames.includes(name);
  }

  _pickExploreBgm() {
    const names = this._exploreBgmNames.filter((n) => this.buffers.has(n));
    if (!names.length) {
      // フォールバック(旧単曲)
      return this.buffers.has('exploreBgm') ? 'exploreBgm' : this._exploreBgmNames[0];
    }
    let pool = names;
    if (names.length > 1 && this._lastExploreBgm) {
      pool = names.filter((n) => n !== this._lastExploreBgm);
      if (!pool.length) pool = names;
    }
    const pick = pool[Math.floor(Math.random() * pool.length)];
    this._lastExploreBgm = pick;
    return pick;
  }

  // ボス撃破ファンファーレ(短い荘厳な和音)
  playBossVictoryFanfare() {
    const ctx = this.context;
    if (!ctx || !this.masterGain) return;
    const t0 = ctx.currentTime;
    const chords = [
      [196, 247, 294, 392], // G minor-ish
      [220, 277, 330, 440], // A
      [246.9, 311, 370, 493], // B
      [261.6, 329.6, 392, 523.3], // C major resolve
    ];
    chords.forEach((freqs, i) => {
      const start = t0 + i * 0.42;
      for (const f of freqs) {
        const osc = ctx.createOscillator();
        osc.type = i === 3 ? 'triangle' : 'sawtooth';
        osc.frequency.value = f;
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 1800;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, start);
        g.gain.exponentialRampToValueAtTime(0.12, start + 0.04);
        g.gain.exponentialRampToValueAtTime(0.0001, start + 0.55);
        osc.connect(filter).connect(g).connect(this.masterGain);
        osc.start(start);
        osc.stop(start + 0.6);
      }
    });
    // 低域の太鼓
    {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(80, t0);
      osc.frequency.exponentialRampToValueAtTime(40, t0 + 0.4);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.45, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.5);
      osc.connect(g).connect(this.masterGain);
      osc.start(t0);
      osc.stop(t0 + 0.55);
    }
  }

  /** 死亡時ジングル（合成。市販ゲーム音源は使わない） */
  playYouDied({ volume = 1 } = {}) {
    const ctx = this.context;
    if (!ctx || !this.masterGain) return;
    const t0 = ctx.currentTime;
    const chord = [110, 130.8, 164.8, 196]; // 暗い A minor-ish
    chord.forEach((f, i) => {
      const osc = ctx.createOscillator();
      osc.type = i < 2 ? 'sine' : 'triangle';
      osc.frequency.setValueAtTime(f, t0);
      osc.frequency.exponentialRampToValueAtTime(f * 0.92, t0 + 2.2);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(volume * (0.22 - i * 0.03), t0 + 0.15);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 2.4);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 900;
      osc.connect(lp).connect(g).connect(this.masterGain);
      osc.start(t0);
      osc.stop(t0 + 2.5);
    });
    // 低い衝撃
    const thump = ctx.createOscillator();
    thump.type = 'sine';
    thump.frequency.setValueAtTime(55, t0);
    thump.frequency.exponentialRampToValueAtTime(28, t0 + 0.8);
    const tg = ctx.createGain();
    tg.gain.setValueAtTime(0.0001, t0);
    tg.gain.exponentialRampToValueAtTime(volume * 0.5, t0 + 0.03);
    tg.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.0);
    thump.connect(tg).connect(this.masterGain);
    thump.start(t0);
    thump.stop(t0 + 1.05);
  }
}
