// Mixamo剣盾アニメの実クリップ長(walk=1.083秒、run=0.7秒)を基準に、
// 1ループ=左右2歩として算出
const WALK_STRIDE_HZ = 2 / 1.083;
const RUN_STRIDE_HZ = 2 / 0.7;

// 正確な足の接地フレームは(外部glTFアニメーションのため)把握できないので、
// 移動状態から歩幅相当の間隔を計算し、その周期で足音を鳴らす簡易実装
export class FootstepPlayer {
  constructor(audio, soundNames) {
    this.audio = audio;
    this.soundNames = soundNames;
    this.phase = 0;
  }

  update(dt, state) {
    if (state !== 'walk' && state !== 'run' && state !== 'guardWalk') {
      this.phase = 0;
      return;
    }
    const hz = state === 'run' ? RUN_STRIDE_HZ : WALK_STRIDE_HZ;
    this.phase += dt * hz;
    if (this.phase >= 1) {
      this.phase -= 1;
      const volume = state === 'run' ? 0.55 : state === 'guardWalk' ? 0.28 : 0.35;
      this.audio.playRandom(this.soundNames, {
        volume,
        pitchVariance: 0.12,
      });
    }
  }
}
