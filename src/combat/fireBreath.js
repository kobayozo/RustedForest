import * as THREE from 'three';

/**
 * ドラゴン息吹き。頭ボーンのワールド位置から前方へ噴出する（ルート空間で描画して確実に見えるようにする）。
 * テクスチャ: OpenGameArt flame particle + torch fire sheet
 */
const FLAME_URL = '/textures/fx/flame_particle.png';
const SHEET_URL = '/textures/fx/fire_sheet.png';
const SHEET_COLS = 5;
const SHEET_ROWS = 7;
const SHEET_FRAMES = 32;

let shared = null;

function loadShared() {
  if (shared) return shared;
  const loader = new THREE.TextureLoader();
  const flame = loader.load(FLAME_URL);
  flame.colorSpace = THREE.SRGBColorSpace;
  const sheet = loader.load(SHEET_URL);
  sheet.colorSpace = THREE.SRGBColorSpace;
  sheet.wrapS = THREE.ClampToEdgeWrapping;
  sheet.wrapT = THREE.ClampToEdgeWrapping;
  sheet.repeat.set(1 / SHEET_COLS, 1 / SHEET_ROWS);
  shared = { flame, sheet };
  return shared;
}

function setSheetFrame(tex, frame) {
  const f = ((frame % SHEET_FRAMES) + SHEET_FRAMES) % SHEET_FRAMES;
  const col = f % SHEET_COLS;
  const row = Math.floor(f / SHEET_COLS);
  tex.offset.set(col / SHEET_COLS, 1 - (row + 1) / SHEET_ROWS);
}

/**
 * @param {THREE.Object3D} root ドラゴンのルート（ワールド同期される Group）
 * @param {THREE.Bone|null} headBone
 * @param {{ duration?: number, intensity?: number, mode?: 'cone'|'radial', getForward?: () => THREE.Vector3 }} opts
 */
export function createFireBreath(root, headBone, opts = {}) {
  const { flame, sheet } = loadShared();
  const duration = opts.duration ?? 1.4;
  const intensity = opts.intensity ?? 1;
  const radial = opts.mode === 'radial';
  const getForward =
    opts.getForward ||
    (() => new THREE.Vector3(0, 0, -1));

  const group = new THREE.Group();
  group.name = 'fireBreath';
  root.add(group);

  const _head = new THREE.Vector3();
  const _fwd = new THREE.Vector3();
  const _right = new THREE.Vector3();
  const _up = new THREE.Vector3(0, 1, 0);
  const _tmp = new THREE.Vector3();

  // コアの炎コーン（非テクスチャでも必ず見える）
  const coreMat = new THREE.MeshBasicMaterial({
    color: 0xff6600,
    transparent: true,
    opacity: 0.75,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const core = new THREE.Mesh(new THREE.ConeGeometry(0.55, 3.2, 10, 1, true), coreMat);
  core.rotation.x = Math.PI / 2;
  group.add(core);

  const outerMat = new THREE.MeshBasicMaterial({
    color: 0xff2200,
    transparent: true,
    opacity: 0.4,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const outer = new THREE.Mesh(new THREE.ConeGeometry(1.1, 4.5, 10, 1, true), outerMat);
  outer.rotation.x = Math.PI / 2;
  group.add(outer);

  // スプライト噴流
  const jets = [];
  for (let i = 0; i < 14; i++) {
    const tex = sheet.clone();
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.repeat.set(1 / SHEET_COLS, 1 / SHEET_ROWS);
    const mat = new THREE.SpriteMaterial({
      map: tex,
      color: 0xffaa66,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      opacity: 0.95,
    });
    const spr = new THREE.Sprite(mat);
    const s = (1.2 + Math.random() * 1.4) * intensity;
    spr.scale.set(s, s, 1);
    group.add(spr);
    jets.push({
      spr,
      mat,
      frame: Math.floor(Math.random() * SHEET_FRAMES),
      dist: 0.4 + Math.random() * 0.8,
      speed: 5 + Math.random() * 6,
      side: (Math.random() - 0.5) * 1.2,
      lift: (Math.random() - 0.2) * 0.8,
      age: Math.random() * 0.2,
    });
  }

  // パーティクル（radial は水平放射）
  const count = radial ? 220 : 160;
  const positions = new Float32Array(count * 3);
  const ages = new Float32Array(count);
  const vel = [];
  for (let i = 0; i < count; i++) {
    ages[i] = Math.random();
    if (radial) {
      const ang = Math.random() * Math.PI * 2;
      const spd = 4 + Math.random() * 9;
      vel.push({
        x: Math.cos(ang) * spd,
        y: 0.4 + Math.random() * 2.2,
        z: Math.sin(ang) * spd,
      });
    } else {
      vel.push({
        x: (Math.random() - 0.5) * 2,
        y: Math.random() * 1.5,
        z: 4 + Math.random() * 8,
      });
    }
  }

  // 放射用リング
  let ring = null;
  let ringMat = null;
  if (radial) {
    core.visible = false;
    outer.visible = false;
    ringMat = new THREE.MeshBasicMaterial({
      color: 0xff4400,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    ring = new THREE.Mesh(new THREE.TorusGeometry(1.2, 0.35, 8, 28), ringMat);
    ring.rotation.x = Math.PI / 2;
    group.add(ring);
  }

  // 放射ジェットの初期角度
  if (radial) {
    for (let i = 0; i < jets.length; i++) {
      jets[i].ang = (i / jets.length) * Math.PI * 2 + Math.random() * 0.2;
      jets[i].dist = 0.5 + Math.random() * 1.2;
      jets[i].speed = 6 + Math.random() * 7;
      jets[i].lift = 0.3 + Math.random() * 1.4;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const pointsMat = new THREE.PointsMaterial({
    map: flame,
    color: 0xff8844,
    size: 1.4 * intensity,
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
  });
  const points = new THREE.Points(geo, pointsMat);
  points.frustumCulled = false;
  group.add(points);

  const light = new THREE.PointLight(0xff5511, 6 * intensity, 22, 2);
  group.add(light);

  let life = 0;
  let dead = false;

  function syncOrigin() {
    if (headBone) {
      headBone.getWorldPosition(_head);
      root.worldToLocal(_head);
    } else {
      _head.set(0, 3.2, -1.5);
    }
    // ワールド前方 → ルートローカル
    _fwd.copy(getForward());
    if (_fwd.lengthSq() < 1e-8) _fwd.set(0, 0, -1);
    else _fwd.normalize();
    const e = new THREE.Matrix4().copy(root.matrixWorld).invert();
    _fwd.transformDirection(e);
    if (_fwd.lengthSq() < 1e-8) _fwd.set(0, 0, -1);
    _fwd.normalize();
    _right.set(0, 1, 0).cross(_fwd);
    if (_right.lengthSq() < 1e-8) _right.set(1, 0, 0);
    else _right.normalize();
    _up.copy(_fwd).cross(_right).normalize();
  }

  return {
    get alive() {
      return !dead;
    },
    update(dt) {
      if (dead) return;
      life += dt;
      const u = life / duration;
      if (u >= 1) {
        this.dispose();
        return;
      }
      const fade = u < 0.1 ? u / 0.1 : u > 0.75 ? (1 - u) / 0.25 : 1;

      syncOrigin();

      if (radial) {
        if (ring) {
          const r = 1.5 + u * 7.5;
          ring.position.copy(_head);
          ring.position.y -= 0.4;
          ring.scale.set(r, r, 1);
          ringMat.opacity = 0.5 * fade * (1 - u * 0.5);
        }
        for (const j of jets) {
          j.age += dt;
          j.dist += j.speed * dt;
          if (j.dist > 11) {
            j.dist = 0.4 + Math.random() * 0.6;
            j.age = 0;
            j.ang = Math.random() * Math.PI * 2;
          }
          _tmp.set(
            _head.x + Math.cos(j.ang) * j.dist,
            _head.y + j.lift * (0.3 + j.dist * 0.08),
            _head.z + Math.sin(j.ang) * j.dist,
          );
          j.spr.position.copy(_tmp);
          const s = (1.2 + j.dist * 0.4) * intensity * fade;
          j.spr.scale.set(s, s * 1.15, 1);
          j.mat.opacity = 0.95 * fade * (1 - Math.min(1, j.dist / 11));
          j.frame += dt * 22;
          setSheetFrame(j.mat.map, Math.floor(j.frame));
        }
        const pos = points.geometry.attributes.position;
        for (let i = 0; i < count; i++) {
          ages[i] += dt * (0.55 + Math.random() * 0.7);
          if (ages[i] >= 1) {
            ages[i] = 0;
            const ang = Math.random() * Math.PI * 2;
            const spd = 4 + Math.random() * 10;
            vel[i].x = Math.cos(ang) * spd;
            vel[i].y = 0.5 + Math.random() * 2.5;
            vel[i].z = Math.sin(ang) * spd;
          }
          const a = ages[i];
          _tmp.set(
            _head.x + vel[i].x * a,
            _head.y + vel[i].y * a + a * a * 1.5,
            _head.z + vel[i].z * a,
          );
          pos.setXYZ(i, _tmp.x, _tmp.y, _tmp.z);
        }
        pos.needsUpdate = true;
        pointsMat.opacity = 0.95 * fade;
        pointsMat.size = (1.3 + fade * 0.8) * intensity;
        light.position.copy(_head);
        light.intensity = (5 + fade * 8) * intensity;
        light.distance = 28;
        return;
      }

      // コアを口元〜前方へ
      const coreLen = 2.8 + fade * 2.5;
      core.position.copy(_head).addScaledVector(_fwd, coreLen * 0.45);
      core.scale.set(1.1 * intensity * fade, coreLen / 3.2, 1.1 * intensity * fade);
      core.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), _fwd);
      coreMat.opacity = 0.55 * fade;

      outer.position.copy(_head).addScaledVector(_fwd, coreLen * 0.55);
      outer.scale.set(1.4 * intensity * fade, (coreLen + 1.2) / 4.5, 1.4 * intensity * fade);
      outer.quaternion.copy(core.quaternion);
      outerMat.opacity = 0.35 * fade;

      for (const j of jets) {
        j.age += dt;
        j.dist += j.speed * dt;
        if (j.dist > 9) {
          j.dist = 0.3 + Math.random() * 0.5;
          j.age = 0;
        }
        _tmp
          .copy(_head)
          .addScaledVector(_fwd, j.dist)
          .addScaledVector(_right, j.side * (0.3 + j.dist * 0.18))
          .addScaledVector(_up, j.lift * (0.2 + j.dist * 0.12));
        j.spr.position.copy(_tmp);
        const s = (1.0 + j.dist * 0.35) * intensity * fade;
        j.spr.scale.set(s, s * 1.2, 1);
        j.mat.opacity = 0.9 * fade * (1 - Math.min(1, j.dist / 9));
        j.frame += dt * 20;
        setSheetFrame(j.mat.map, Math.floor(j.frame));
      }

      const pos = points.geometry.attributes.position;
      for (let i = 0; i < count; i++) {
        ages[i] += dt * (0.6 + Math.random() * 0.8);
        if (ages[i] >= 1) {
          ages[i] = 0;
          vel[i].x = (Math.random() - 0.5) * 2.2;
          vel[i].y = Math.random() * 1.8;
          vel[i].z = 3.5 + Math.random() * 9;
        }
        const a = ages[i];
        _tmp
          .copy(_head)
          .addScaledVector(_fwd, vel[i].z * a)
          .addScaledVector(_right, vel[i].x * a)
          .addScaledVector(_up, vel[i].y * a + a * a * 1.2);
        pos.setXYZ(i, _tmp.x, _tmp.y, _tmp.z);
      }
      pos.needsUpdate = true;
      pointsMat.opacity = 0.9 * fade;
      pointsMat.size = (1.1 + fade * 0.6) * intensity;

      light.position.copy(_head).addScaledVector(_fwd, 2.5);
      light.intensity = (3 + fade * 5) * intensity;
    },
    dispose() {
      if (dead) return;
      dead = true;
      if (group.parent) group.parent.remove(group);
      core.geometry.dispose();
      coreMat.dispose();
      outer.geometry.dispose();
      outerMat.dispose();
      if (ring) {
        ring.geometry.dispose();
        ringMat.dispose();
      }
      for (const j of jets) {
        j.mat.map?.dispose?.();
        j.mat.dispose();
      }
      geo.dispose();
      pointsMat.dispose();
    },
  };
}
