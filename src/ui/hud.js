const STAMINA_MAX = 100;
const PLAYER_HP_MAX = 100;
const ENEMY_HP_MAX = 100;

export function createStaminaBar(hud) {
  const bar = document.createElement('div');
  bar.id = 'stamina-bar';
  Object.assign(bar.style, {
    position: 'absolute',
    left: '20px',
    bottom: '20px',
    width: '200px',
    height: '14px',
    background: 'rgba(0, 0, 0, 0.45)',
    border: '1px solid rgba(255, 255, 255, 0.6)',
    borderRadius: '4px',
    overflow: 'hidden',
  });

  const fill = document.createElement('div');
  Object.assign(fill.style, {
    width: '100%',
    height: '100%',
    background: '#e8d44d',
    transition: 'width 0.08s linear',
  });
  bar.appendChild(fill);
  hud.appendChild(bar);

  return {
    update(stamina) {
      fill.style.width = `${(Math.max(0, stamina) / STAMINA_MAX) * 100}%`;
    },
  };
}

// プレイヤーのHPバー。スタミナバーの真上に配置し、赤系の色で区別する
export function createHealthBar(hud) {
  const bar = document.createElement('div');
  bar.id = 'health-bar';
  Object.assign(bar.style, {
    position: 'absolute',
    left: '20px',
    bottom: '40px',
    width: '200px',
    height: '18px',
    background: 'rgba(0, 0, 0, 0.45)',
    border: '1px solid rgba(255, 255, 255, 0.6)',
    borderRadius: '4px',
    overflow: 'hidden',
  });

  const fill = document.createElement('div');
  Object.assign(fill.style, {
    width: '100%',
    height: '100%',
    background: 'linear-gradient(#c9333a, #8f1f24)',
    // ダメージ時は即座に減り、回復はない前提のため急な変化でも違和感が少ない
    transition: 'width 0.15s ease-out',
  });
  bar.appendChild(fill);
  hud.appendChild(bar);

  return {
    update(hp) {
      fill.style.width = `${(Math.max(0, hp) / PLAYER_HP_MAX) * 100}%`;
    },
  };
}

// 敵のHPバー。エルデンリング風に画面上部中央に表示するボスバー形式。
// バーの直上に名前を表示し、どの敵と対峙しているか分かるようにする
export function createEnemyHealthBar(hud) {
  const wrap = document.createElement('div');
  wrap.id = 'enemy-health-bar-wrap';
  Object.assign(wrap.style, {
    position: 'absolute',
    left: '50%',
    top: '10px',
    transform: 'translateX(-50%)',
    width: '360px',
    opacity: '0',
    transition: 'opacity 0.3s ease',
    textAlign: 'center',
  });

  const label = document.createElement('div');
  Object.assign(label.style, {
    color: '#f0e6d2',
    fontFamily: 'serif',
    fontSize: '15px',
    letterSpacing: '2px',
    textShadow: '0 1px 3px rgba(0,0,0,0.9)',
    marginBottom: '4px',
  });
  wrap.appendChild(label);

  const bar = document.createElement('div');
  Object.assign(bar.style, {
    width: '100%',
    height: '10px',
    background: 'rgba(0, 0, 0, 0.5)',
    border: '1px solid rgba(255, 255, 255, 0.5)',
    borderRadius: '2px',
    overflow: 'hidden',
  });

  const fill = document.createElement('div');
  Object.assign(fill.style, {
    width: '100%',
    height: '100%',
    background: 'linear-gradient(#d94a4a, #7a1010)',
    transition: 'width 0.15s ease-out',
  });
  bar.appendChild(fill);
  wrap.appendChild(bar);
  hud.appendChild(wrap);

  return {
    update(hp, alive, name) {
      wrap.style.opacity = alive ? '1' : '0';
      fill.style.width = `${(Math.max(0, hp) / ENEMY_HP_MAX) * 100}%`;
      if (name) label.textContent = name;
    },
  };
}
