const STAMINA_MAX = 100;
const PLAYER_HP_MAX = 100;
const ENEMY_HP_MAX = 100;

// エルデンリング風: 左上に細い長めの赤HP + 緑スタミナ
export function createPlayerVitals(hud) {
  const wrap = document.createElement('div');
  wrap.id = 'player-vitals';
  Object.assign(wrap.style, {
    position: 'absolute',
    left: '28px',
    top: '28px',
    width: '340px',
    pointerEvents: 'none',
    zIndex: '10',
  });

  const makeBar = (id, height, fillColor, width = '100%') => {
    const row = document.createElement('div');
    Object.assign(row.style, {
      position: 'relative',
      width,
      height: `${height}px`,
      marginBottom: '7px',
      background: 'rgba(8, 6, 4, 0.72)',
      border: '1px solid rgba(196, 168, 110, 0.55)',
      boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.55), 0 1px 3px rgba(0,0,0,0.55)',
      overflow: 'hidden',
    });

    // ダメージ遅れのゴースト(エルデンリングの白/橙残像)
    const ghost = document.createElement('div');
    Object.assign(ghost.style, {
      position: 'absolute',
      left: '0',
      top: '0',
      width: '100%',
      height: '100%',
      background: 'rgba(230, 200, 140, 0.75)',
      transition: 'width 0.55s ease-out',
    });
    row.appendChild(ghost);

    const fill = document.createElement('div');
    fill.id = id;
    Object.assign(fill.style, {
      position: 'absolute',
      left: '0',
      top: '0',
      width: '100%',
      height: '100%',
      background: fillColor,
      transition: 'width 0.12s linear',
    });
    row.appendChild(fill);
    return { row, fill, ghost };
  };

  const hp = makeBar('player-hp-fill', 9, 'linear-gradient(180deg, #c43a3a 0%, #7a1518 100%)');
  const stam = makeBar(
    'player-stam-fill',
    7,
    'linear-gradient(180deg, #c9c85a 0%, #6e8a2e 55%, #4a6a1a 100%)',
    '92%',
  );

  wrap.appendChild(hp.row);
  wrap.appendChild(stam.row);
  hud.appendChild(wrap);

  let ghostHp = PLAYER_HP_MAX;

  return {
    update(currentHp, stamina) {
      const hpPct = (Math.max(0, currentHp) / PLAYER_HP_MAX) * 100;
      const stPct = (Math.max(0, stamina) / STAMINA_MAX) * 100;
      hp.fill.style.width = `${hpPct}%`;
      stam.fill.style.width = `${stPct}%`;
      stam.ghost.style.width = `${stPct}%`;

      // HPが減ったときだけゴーストを遅れて追従させる
      if (currentHp < ghostHp - 0.01) {
        // すぐには下げず、次フレーム以降の transition で追う
        requestAnimationFrame(() => {
          ghostHp = currentHp;
          hp.ghost.style.width = `${hpPct}%`;
        });
      } else {
        ghostHp = currentHp;
        hp.ghost.style.width = `${hpPct}%`;
      }
    },
  };
}

// 後方互換: 旧APIを使う呼び出しがあっても動くようにする
export function createStaminaBar(hud) {
  return { update() {} };
}

export function createHealthBar(hud) {
  return { update() {} };
}

// 敵のHPバー。エルデンリング風に画面上部中央。索敵/ロック時のみ表示
export function createEnemyHealthBar(hud) {
  const wrap = document.createElement('div');
  wrap.id = 'enemy-health-bar-wrap';
  Object.assign(wrap.style, {
    position: 'absolute',
    left: '50%',
    top: '18px',
    transform: 'translateX(-50%)',
    width: '420px',
    opacity: '0',
    transition: 'opacity 0.35s ease',
    textAlign: 'center',
    pointerEvents: 'none',
  });

  const label = document.createElement('div');
  Object.assign(label.style, {
    color: '#e8dcc0',
    fontFamily: '"Palatino Linotype", "Book Antiqua", Palatino, serif',
    fontSize: '15px',
    letterSpacing: '3px',
    textShadow: '0 1px 4px rgba(0,0,0,0.95)',
    marginBottom: '6px',
  });
  wrap.appendChild(label);

  const bar = document.createElement('div');
  Object.assign(bar.style, {
    width: '100%',
    height: '8px',
    background: 'rgba(8, 6, 4, 0.72)',
    border: '1px solid rgba(196, 168, 110, 0.5)',
    boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.5)',
    overflow: 'hidden',
  });

  const fill = document.createElement('div');
  Object.assign(fill.style, {
    width: '100%',
    height: '100%',
    background: 'linear-gradient(180deg, #d94a4a, #7a1010)',
    transition: 'width 0.15s ease-out',
  });
  bar.appendChild(fill);
  wrap.appendChild(bar);
  hud.appendChild(wrap);

  return {
    update(hp, visible, name, maxHp = ENEMY_HP_MAX) {
      wrap.style.opacity = visible ? '1' : '0';
      if (!visible) return;
      const cap = Math.max(1, maxHp || ENEMY_HP_MAX);
      fill.style.width = `${(Math.max(0, hp) / cap) * 100}%`;
      if (name) label.textContent = name;
    },
  };
}

// エルデンリング風のロックオン二重丸。ワールド座標をスクリーンへ投影して追従する
export function createLockOnMarker(hud) {
  const marker = document.createElement('div');
  marker.id = 'lock-on-marker';
  Object.assign(marker.style, {
    position: 'absolute',
    left: '0',
    top: '0',
    width: '28px',
    height: '28px',
    marginLeft: '-14px',
    marginTop: '-14px',
    pointerEvents: 'none',
    opacity: '0',
    transition: 'opacity 0.12s ease',
    zIndex: '5',
  });

  const ring = (size, border) => {
    const el = document.createElement('div');
    Object.assign(el.style, {
      position: 'absolute',
      left: '50%',
      top: '50%',
      width: `${size}px`,
      height: `${size}px`,
      marginLeft: `${-size / 2}px`,
      marginTop: `${-size / 2}px`,
      borderRadius: '50%',
      border,
      boxSizing: 'border-box',
    });
    return el;
  };

  marker.appendChild(ring(28, '1.5px solid rgba(255, 255, 255, 0.95)'));
  marker.appendChild(ring(16, '2px solid rgba(255, 255, 255, 0.9)'));
  hud.appendChild(marker);

  return {
    update(camera, worldPos) {
      if (!worldPos) {
        marker.style.opacity = '0';
        return;
      }
      const v = worldPos.clone().project(camera);
      if (v.z > 1 || v.z < -1 || v.x < -1.2 || v.x > 1.2 || v.y < -1.2 || v.y > 1.2) {
        marker.style.opacity = '0';
        return;
      }
      const x = (v.x * 0.5 + 0.5) * window.innerWidth;
      const y = (-v.y * 0.5 + 0.5) * window.innerHeight;
      marker.style.transform = `translate(${x}px, ${y}px)`;
      marker.style.opacity = '1';
    },
    hide() {
      marker.style.opacity = '0';
    },
  };
}

export function createGameOverScreen(hud) {
  const overlay = document.createElement('div');
  overlay.id = 'game-over-overlay';
  Object.assign(overlay.style, {
    position: 'absolute',
    inset: '0',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(0, 0, 0, 0)',
    opacity: '0',
    pointerEvents: 'none',
    transition: 'opacity 1.4s ease, background 1.4s ease',
  });

  const title = document.createElement('div');
  title.textContent = 'YOU DIED';
  Object.assign(title.style, {
    color: '#8a1414',
    fontFamily: 'serif',
    fontSize: '64px',
    letterSpacing: '12px',
    textShadow: '0 0 24px rgba(0, 0, 0, 0.9)',
    marginBottom: '28px',
  });
  overlay.appendChild(title);

  const prompt = document.createElement('div');
  prompt.textContent = 'Rキーでリスポーン';
  Object.assign(prompt.style, {
    color: '#e8d8b0',
    fontFamily: 'serif',
    fontSize: '20px',
    letterSpacing: '4px',
    textShadow: '0 1px 4px rgba(0, 0, 0, 0.9)',
  });
  overlay.appendChild(prompt);

  hud.appendChild(overlay);

  return {
    show() {
      overlay.style.background = 'rgba(0, 0, 0, 0.7)';
      overlay.style.opacity = '1';
      overlay.style.pointerEvents = 'auto';
    },
    hide() {
      overlay.style.background = 'rgba(0, 0, 0, 0)';
      overlay.style.opacity = '0';
      overlay.style.pointerEvents = 'none';
    },
  };
}

// ボス撃破演出(エルデンリング風 GREAT ENEMY FELLED)
export function createBossFelledScreen(hud) {
  const overlay = document.createElement('div');
  overlay.id = 'boss-felled-overlay';
  Object.assign(overlay.style, {
    position: 'absolute',
    inset: '0',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(0, 0, 0, 0)',
    opacity: '0',
    pointerEvents: 'none',
    transition: 'opacity 0.8s ease, background 1.2s ease',
    zIndex: '20',
  });

  const line = document.createElement('div');
  Object.assign(line.style, {
    width: '0%',
    maxWidth: '520px',
    height: '1px',
    background: 'linear-gradient(90deg, transparent, rgba(212,175,95,0.95), transparent)',
    marginBottom: '18px',
    transition: 'width 1.1s ease',
  });
  overlay.appendChild(line);

  const title = document.createElement('div');
  title.textContent = 'GREAT ENEMY FELLED';
  Object.assign(title.style, {
    color: '#e8d4a8',
    fontFamily: '"Palatino Linotype", "Book Antiqua", Palatino, serif',
    fontSize: '42px',
    letterSpacing: '8px',
    textShadow: '0 2px 18px rgba(0,0,0,0.95), 0 0 40px rgba(180,140,60,0.35)',
    transform: 'scale(0.92)',
    transition: 'transform 1.2s ease',
  });
  overlay.appendChild(title);

  const line2 = document.createElement('div');
  Object.assign(line2.style, {
    width: '0%',
    maxWidth: '520px',
    height: '1px',
    background: 'linear-gradient(90deg, transparent, rgba(212,175,95,0.95), transparent)',
    marginTop: '18px',
    transition: 'width 1.1s ease',
  });
  overlay.appendChild(line2);

  const sub = document.createElement('div');
  sub.textContent = '';
  Object.assign(sub.style, {
    marginTop: '28px',
    color: 'rgba(232, 216, 176, 0.75)',
    fontFamily: 'serif',
    fontSize: '16px',
    letterSpacing: '3px',
    opacity: '0',
    transition: 'opacity 1s ease 0.8s',
  });
  overlay.appendChild(sub);

  hud.appendChild(overlay);

  let hideTimer = null;

  return {
    show(enemyName = 'ドラゴン') {
      if (hideTimer) clearTimeout(hideTimer);
      sub.textContent = enemyName;
      overlay.style.background = 'rgba(0, 0, 0, 0.45)';
      overlay.style.opacity = '1';
      // 次フレームで線を伸ばしタイトルを拡大
      requestAnimationFrame(() => {
        line.style.width = '100%';
        line2.style.width = '100%';
        title.style.transform = 'scale(1)';
        sub.style.opacity = '1';
      });
      hideTimer = setTimeout(() => this.hide(), 5200);
    },
    hide() {
      overlay.style.opacity = '0';
      overlay.style.background = 'rgba(0, 0, 0, 0)';
      line.style.width = '0%';
      line2.style.width = '0%';
      title.style.transform = 'scale(0.92)';
      sub.style.opacity = '0';
    },
  };
}
