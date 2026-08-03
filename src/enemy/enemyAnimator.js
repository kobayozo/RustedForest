import * as THREE from 'three';

const FADE_TIME = 0.28;
const ATTACK_FADE = 0.18;

export class EnemyAnimator {
  // clipMapは{state: clipName}(例: WARRIOR_CLIP_MAP/MINION_CLIP_MAP)。敵の見た目
  // ごとに使う攻撃モーションなどを変えられるよう、固定importではなく引数で受け取る
  constructor(mixer, clips, clipMap, { fadeTime = FADE_TIME } = {}) {
    this.mixer = mixer;
    this.fadeTime = fadeTime;
    this.actions = {};
    for (const [state, clipName] of Object.entries(clipMap)) {
      const clip = clips[clipName];
      if (clip) this.actions[state] = mixer.clipAction(clip);
    }
    this.currentState = null;
  }

  getClipDuration(state) {
    return this.actions[state]?.getClip().duration ?? 1;
  }

  setState(state) {
    if (state === this.currentState) return;
    const next = this.actions[state] ?? this.actions.idle;
    const prev = this.currentState ? this.actions[this.currentState] : null;
    if (!next) return;

    // walk/run 等が同じクリップを使い回している敵(例:ドラゴン)では、
    // ラベルが変わってもアクション実体は同じなので reset() すると
    // 歩行サイクルが毎回0フレームへ巻き戻ってガタつく。ラベルだけ切替える
    if (next === prev) {
      this.currentState = state;
      return;
    }

    // 攻撃系から戻るときもスムーズに
    if (next.loop !== THREE.LoopRepeat) {
      next.setLoop(THREE.LoopRepeat, Infinity);
      next.clampWhenFinished = false;
    }
    next.timeScale = state === 'run' ? 1.55 : state === 'walk' ? 1.1 : 1;
    next.enabled = true;
    next.setEffectiveWeight(1);
    next.play();
    if (prev && prev !== next) {
      prev.crossFadeTo(next, this.fadeTime, false);
    } else {
      next.reset().fadeIn(this.fadeTime);
    }
    this.currentState = state;
  }

  /**
   * 実際の移動速度にアニメ再生速度を追随させる(歩行サイクルと移動距離を一致させ、
   * 足の滑りを防ぐ)。state切替はsetStateに任せ、その後timeScaleだけ毎フレーム上書きする。
   */
  setLocomotionSpeed(state, speedRatio) {
    this.setState(state);
    const action = this.actions[state] ?? this.actions.idle;
    if (action) action.timeScale = Math.max(0.3, Math.min(3.0, speedRatio));
  }

  /**
   * 攻撃/被弾/死亡。他アクションを即 stop せずクロスフェードで繋ぐ（瞬間切替を防ぐ）
   */
  trigger(state, { fade = ATTACK_FADE, loopOnce = true } = {}) {
    const action = this.actions[state];
    if (!action) return;
    const prev = this.currentState ? this.actions[this.currentState] : null;

    action.reset();
    if (loopOnce || state === 'death' || state === 'hit' || state === 'attack' || String(state).startsWith('attack')) {
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
    } else {
      action.setLoop(THREE.LoopRepeat, Infinity);
      action.clampWhenFinished = false;
    }
    action.enabled = true;
    action.setEffectiveWeight(1);
    action.play();

    if (prev && prev !== action) {
      // warping=false でポーズを滑らかに補間
      prev.crossFadeTo(action, fade, false);
    } else {
      action.fadeIn(fade);
    }
    this.currentState = state;
  }

  update(dt) {
    this.mixer.update(dt);
  }
}
