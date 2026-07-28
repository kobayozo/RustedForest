import * as THREE from 'three';

const FADE_TIME = 0.25;

export class EnemyAnimator {
  // clipMapは{state: clipName}(例: WARRIOR_CLIP_MAP/MINION_CLIP_MAP)。敵の見た目
  // ごとに使う攻撃モーションなどを変えられるよう、固定importではなく引数で受け取る
  constructor(mixer, clips, clipMap) {
    this.mixer = mixer;
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

    next.reset().play();
    if (prev && prev !== next) {
      prev.crossFadeTo(next, FADE_TIME, true);
    } else {
      next.fadeIn(FADE_TIME);
    }
    this.currentState = state;
  }

  // 攻撃/被弾/死亡は同じstateが連続する可能性があり(例:攻撃→クールダウン→再攻撃の
  // 間に必ずidle/walkを挟むため通常は問題ないが)、被弾は攻撃/移動どのstateからでも
  // 割り込む可能性があるためsetState()のガードを迂回して確実に先頭から再生する。
  // fadeIn()だけでは直前のアクション(例: run)が止まらずweight=1のまま残り続け、
  // 以後ずっとポーズに混ざり込むため、対象以外を明示的にstop()してから再生する
  trigger(state) {
    const action = this.actions[state];
    if (!action) return;
    for (const [otherState, otherAction] of Object.entries(this.actions)) {
      if (otherState !== state) otherAction.stop();
    }
    action.reset();
    if (state === 'death') {
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
    }
    action.play();
    action.fadeIn(0.1);
    this.currentState = state;
  }

  update(dt) {
    this.mixer.update(dt);
  }
}
