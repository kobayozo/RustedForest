import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

export function createLighting(scene, renderer) {
  scene.background = new THREE.Color(0x8fb8d8);
  scene.fog = new THREE.Fog(0x8fb8d8, 40, 130);

  // 実写テクスチャ導入で地面が暗く沈んだため、光量を底上げする
  const hemi = new THREE.HemisphereLight(0xcfe8ff, 0x3a2f22, 1.1);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xfff2d9, 2.0);
  sun.position.set(30, 45, 20);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -50;
  sun.shadow.camera.right = 50;
  sun.shadow.camera.top = 50;
  sun.shadow.camera.bottom = -50;
  sun.shadow.camera.far = 150;
  scene.add(sun);

  const ambient = new THREE.AmbientLight(0xffffff, 0.25);
  scene.add(ambient);

  // PBR金属(騎士アーマー等)が黒く潰れないよう、簡易室内環境を反射源にする
  let environment = null;
  if (renderer) {
    const pmrem = new THREE.PMREMGenerator(renderer);
    environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = environment;
    pmrem.dispose();
  }

  return { hemi, sun, ambient, environment };
}
