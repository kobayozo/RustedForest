import * as THREE from 'three';
import { CHARACTER_CLIPS } from './characterModel.js';

const FADE_TIME = 0.2;
const ATTACK_RESTART_FADE = 0.08;

export class CharacterAnimator {
  constructor(mixers, clips, swordRig = null) {
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
    this.swordRig = swordRig;
    this.swordLocation = swordRig?.alwaysInHand ? 'hand' : 'sheath';
  }

  _equipSword(location) {
    if (!this.swordRig || this.swordRig.alwaysInHand) return;
    if (this.swordLocation === location) return;
    const { sword, hipBone, handBone, sheathTransform, handTransform } = this.swordRig;
    if (location === 'hand' && handBone) {
      hipBone?.remove(sword);
      handBone.add(sword);
      sword.position.copy(handTransform.position);
      sword.rotation.copy(handTransform.rotation);
    } else if (hipBone) {
      handBone?.remove(sword);
      hipBone.add(sword);
      sword.position.copy(sheathTransform.position);
      sword.rotation.copy(sheathTransform.rotation);
    }
    this.swordLocation = location;
  }

  getClipDuration(state) {
    const clipName = CHARACTER_CLIPS[state];
    return this.clips[clipName]?.duration ?? 1;
  }

  _isAttackState(state) {
    return (
      state === 'attack' ||
      state === 'attack2' ||
      state === 'attack3' ||
      state === 'heavyAttack' ||
      state === 'jumpAttack' ||
      state === 'kick'
    );
  }

  setState(state) {
    if (state === this.currentState) return;
    if (this._isAttackState(this.currentState) && !this._isAttackState(state)) {
      this._equipSword('sheath');
    }
    for (const actions of this.actionsByMixer) {
      const next = actions[state] ?? actions.idle;
      const prev = this.currentState ? actions[this.currentState] : null;
      if (!next) continue;

      next.timeScale = state === 'idle' ? 0.45 : 1;
      next.reset().play();
      if (prev && prev !== next) {
        prev.crossFadeTo(next, FADE_TIME, true);
      } else {
        next.fadeIn(FADE_TIME);
      }
    }
    this.currentState = state;
  }

  _forceState(key, { timeScale = 1, fadeIn = 0.05, loopOnce = false, softRestart = false } = {}) {
    for (const actions of this.actionsByMixer) {
      const action = actions[key];
      if (!action) continue;
      const prev = this.currentState ? actions[this.currentState] : null;

      action.timeScale = timeScale;
      action.reset();
      if (loopOnce) {
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
      } else {
        action.setLoop(THREE.LoopRepeat, Infinity);
        action.clampWhenFinished = false;
      }
      action.play();

      // 同じ攻撃クリップのコンボ接続: 短くクロスフェードしてつなぐ
      if (softRestart && prev === action) {
        action.fadeIn(fadeIn);
      } else if (softRestart && prev && prev !== action) {
        prev.crossFadeTo(action, fadeIn, false);
      } else {
        for (const [otherKey, otherAction] of Object.entries(actions)) {
          if (otherKey !== key) otherAction.stop();
        }
        action.fadeIn(fadeIn);
      }
    }
    this.currentState = key;
  }

  // 1段目: attack / 2段目: attack2(しゃがみ) / 3段目: attack3(旧ジャンプ切り)
  triggerAttack(speedMultiplier = 1, { comboStage = 0, comboContinue = false } = {}) {
    this._equipSword('hand');
    const actions = this.actionsByMixer[0] || {};
    let key = 'attack';
    if (comboStage === 1 && actions.attack2) key = 'attack2';
    else if (comboStage >= 2 && actions.attack3) key = 'attack3';
    this._forceState(key, {
      timeScale: speedMultiplier,
      fadeIn: comboContinue ? ATTACK_RESTART_FADE : 0.06,
      loopOnce: true,
      softRestart: comboContinue,
    });
  }

  triggerHeavyAttack(speedMultiplier = 1) {
    this._equipSword('hand');
    this._forceState('heavyAttack', { timeScale: speedMultiplier, loopOnce: true });
  }

  triggerJumpAttack(speedMultiplier = 1) {
    this._equipSword('hand');
    this._forceState('jumpAttack', { timeScale: speedMultiplier, loopOnce: true, fadeIn: 0.08 });
  }

  triggerKick(speedMultiplier = 1) {
    this._equipSword('hand');
    this._forceState('kick', { timeScale: speedMultiplier, loopOnce: true, fadeIn: 0.06 });
  }

  triggerRoll() {
    this._equipSword('hand');
    this._forceState('roll', { fadeIn: 0.05, loopOnce: true });
  }

  triggerHit() {
    this._equipSword('sheath');
    this._forceState('hit', { fadeIn: 0.08, loopOnce: true });
  }

  triggerDeath() {
    this._equipSword('sheath');
    this._forceState('dead', { fadeIn: 0.15, loopOnce: true });
  }

  update(dt) {
    for (const mixer of this.mixers) mixer.update(dt);
  }
}
