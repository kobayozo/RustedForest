const WALK_STRIDE_HZ = 2.2;
const RUN_STRIDE_HZ = 3.6;

// 正確な足の接地フレームは(外部glTFアニメーションのため)把握できないので、
// 移動状態から歩幅相当の間隔を計算し、その周期で足音を鳴らす簡易実装
export class FootstepPlayer {
  constructor(audio, soundNames) {
    this.audio = audio;
    this.soundNames = soundNames;
    this.phase = 0;
  }

  update(dt, state) {
    if (state !== 'walk' && state !== 'run') {
      this.phase = 0;
      return;
    }
    const hz = state === 'run' ? RUN_STRIDE_HZ : WALK_STRIDE_HZ;
    this.phase += dt * hz;
    if (this.phase >= 1) {
      this.phase -= 1;
      this.audio.playRandom(this.soundNames, {
        volume: state === 'run' ? 0.55 : 0.35,
        pitchVariance: 0.12,
      });
    }
  }
}
