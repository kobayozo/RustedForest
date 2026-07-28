import * as THREE from 'three';
import { CHARACTER_CLIPS } from './characterModel.js';

const FADE_TIME = 0.2;

// ボディ側・装備側それぞれのミキサーで同じクリップをクロスフェード再生し、
// 見た目上は1体のキャラクターとして同期して動かす
export class CharacterAnimator {
  constructor(mixers, clips) {
    this.mixers = mixers;
    this.clips = clips;
    this.actionsByMixer = mixers.map((mixer) => {
      const actions = {};
      for (const [state, clipName] of Object.entries(CHARACTER_CLIPS)) {
        const clip = clips[clipName];
        if (clip) actions[state] = mixer.clipAction(clip);
      }
      return actions;
    });
    this.currentState = null;
  }

  getClipDuration(state) {
    const clipName = CHARACTER_CLIPS[state];
    return this.clips[clipName]?.duration ?? 1;
  }

  setState(state) {
    if (state === this.currentState) return;
    for (const actions of this.actionsByMixer) {
      const next = actions[state] ?? actions.idle;
      const prev = this.currentState ? actions[this.currentState] : null;
      if (!next) continue;

      next.reset().play();
      if (prev && prev !== next) {
        prev.crossFadeTo(next, FADE_TIME, true);
      } else {
        next.fadeIn(FADE_TIME);
      }
    }
    this.currentState = state;
  }

  // trigger系(attack/hit/dead)はsetState()の"同じstateなら何もしない"ガードを
  // 迂回してforce-restartする必要がある(コンボの2撃目以降や、走行中の被弾など)。
  // その際、直前まで再生していた他のアクション(例: run/walk)をfadeIn()だけでは
  // 止められず、weight=1のまま裏で再生され続けて以後ずっとポーズに混ざり込む
  // (=「攻撃/被弾後もずっと走り続けて見える」原因)。stop()で確実に止めてから
  // 対象のアクションだけを再生する
  _forceState(key, { timeScale = 1, fadeIn = 0.05, loopOnce = false } = {}) {
    for (const actions of this.actionsByMixer) {
      const action = actions[key];
      if (!action) continue;
      for (const [otherKey, otherAction] of Object.entries(actions)) {
        if (otherKey !== key) otherAction.stop();
      }
      action.timeScale = timeScale;
      action.reset();
      if (loopOnce) {
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
      }
      action.play();
      action.fadeIn(fadeIn);
    }
    this.currentState = key;
  }

  // コンボの2撃目以降は「state=attack」のまま同じクリップを再度頭から
  // 再生し直したいので、speedMultiplierで段ごとの勢いを変えられるようにする
  triggerAttack(speedMultiplier = 1) {
    this._forceState('attack', { timeScale: speedMultiplier });
  }

  triggerHit() {
    this._forceState('hit');
  }

  triggerDeath() {
    this._forceState('dead', { fadeIn: 0.15, loopOnce: true });
  }

  update(dt) {
    for (const mixer of this.mixers) mixer.update(dt);
  }
}
