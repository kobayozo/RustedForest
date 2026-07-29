import * as THREE from 'three';

// 攻撃が当たったことを視覚的にはっきり伝えるためのエフェクト集。
// 1) 被弾したキャラクターのマテリアルを一瞬白く発光させる(ヒットフラッシュ)
// 2) 命中位置に小さな火花パーティクルを飛び散らせる

const FLASH_DURATION = 0.13;
const FLASH_COLOR = new THREE.Color(0xffffff);
const FLASH_BOOST = 1.8;

export class HitFlash {
  constructor(root) {
    this.entries = [];
    root.traverse((obj) => {
      if (!obj.isMesh || !obj.material) return;
      const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const material of materials) {
        if (!material.emissive) continue;
        this.entries.push({
          material,
          originalEmissive: material.emissive.clone(),
          originalIntensity: material.emissiveIntensity ?? 1,
        });
      }
    });
    this.timer = 0;
    this.active = false;
  }

  trigger() {
    this.timer = FLASH_DURATION;
    this.active = true;
  }

  update(dt) {
    if (!this.active) return;
    this.timer -= dt;
    const t = Math.max(0, this.timer / FLASH_DURATION); // 1→0

    if (this.timer <= 0) {
      this.active = false;
      for (const entry of this.entries) {
        entry.material.emissive.copy(entry.originalEmissive);
        entry.material.emissiveIntensity = entry.originalIntensity;
      }
      return;
    }

    for (const entry of this.entries) {
      entry.material.emissive.copy(entry.originalEmissive).lerp(FLASH_COLOR, t);
      entry.material.emissiveIntensity = entry.originalIntensity + t * FLASH_BOOST;
    }
  }
}

const SPARK_COUNT = 9;
const SPARK_LIFE = 0.32;
const SPARK_GRAVITY = 5;
const activeSparks = [];

export function spawnHitSpark(scene, position) {
  const group = new THREE.Group();
  group.position.copy(position);

  const geometry = new THREE.SphereGeometry(0.035, 4, 4);
  const particles = [];
  for (let i = 0; i < SPARK_COUNT; i += 1) {
    const material = new THREE.MeshBasicMaterial({
      color: i % 3 === 0 ? 0xfff6cf : 0xffb347,
      transparent: true,
      opacity: 1,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geometry, material);
    const dir = new THREE.Vector3(Math.random() * 2 - 1, Math.random() * 0.8 + 0.15, Math.random() * 2 - 1).normalize();
    const speed = 1.8 + Math.random() * 2.2;
    mesh.position.set(0, 0, 0);
    group.add(mesh);
    particles.push({ mesh, material, velocity: dir.multiplyScalar(speed) });
  }

  scene.add(group);
  activeSparks.push({ group, geometry, particles, life: 0 });
}

export function updateHitSparks(dt) {
  for (let i = activeSparks.length - 1; i >= 0; i -= 1) {
    const spark = activeSparks[i];
    spark.life += dt;
    const t = spark.life / SPARK_LIFE;

    if (t >= 1) {
      spark.group.parent?.remove(spark.group);
      spark.geometry.dispose();
      for (const p of spark.particles) p.material.dispose();
      activeSparks.splice(i, 1);
      continue;
    }

    for (const p of spark.particles) {
      p.mesh.position.addScaledVector(p.velocity, dt);
      p.velocity.y -= SPARK_GRAVITY * dt;
      p.material.opacity = 1 - t;
    }
  }
}
