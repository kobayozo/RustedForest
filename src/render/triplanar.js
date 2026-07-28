import * as THREE from 'three';

// KenneyのモデルはトリムシートUV(細長く引き伸ばされたUV)を前提にしており、
// 通常のmap貼り付けでは実写テクスチャが縞状に歪んでしまう。
// ワールド座標・法線から3方向に投影してブレンドするトライプラナーマッピングで、
// メッシュのUVに依存せずテクスチャを綺麗に貼る
export function createTriplanarMaterial({ map, roughnessMap, scale = 0.5, ...rest }) {
  const material = new THREE.MeshStandardMaterial({ roughness: 1, ...rest });

  material.onBeforeCompile = (shader) => {
    shader.uniforms.triplanarMap = { value: map };
    shader.uniforms.triplanarRoughnessMap = { value: roughnessMap || null };
    shader.uniforms.triplanarScale = { value: scale };

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vTriplanarWorldPosition;
        varying vec3 vTriplanarWorldNormal;`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vTriplanarWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
        vTriplanarWorldNormal = normalize(mat3(modelMatrix) * normal);`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vTriplanarWorldPosition;
        varying vec3 vTriplanarWorldNormal;
        uniform sampler2D triplanarMap;
        uniform sampler2D triplanarRoughnessMap;
        uniform float triplanarScale;

        vec4 triplanarSample(sampler2D tex, vec3 worldPos, vec3 worldNormal) {
          vec3 blend = abs(worldNormal);
          blend = blend / (blend.x + blend.y + blend.z + 0.0001);
          vec4 xTex = texture2D(tex, worldPos.yz * triplanarScale);
          vec4 yTex = texture2D(tex, worldPos.xz * triplanarScale);
          vec4 zTex = texture2D(tex, worldPos.xy * triplanarScale);
          return xTex * blend.x + yTex * blend.y + zTex * blend.z;
        }`
      )
      .replace(
        '#include <map_fragment>',
        `vec4 sampledDiffuseColor = triplanarSample(triplanarMap, vTriplanarWorldPosition, vTriplanarWorldNormal);
        diffuseColor *= sampledDiffuseColor;`
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `float roughnessFactor = roughness;
        #ifdef USE_ROUGHNESSMAP
        vec4 texelRoughness = triplanarSample(triplanarRoughnessMap, vTriplanarWorldPosition, vTriplanarWorldNormal);
        roughnessFactor *= texelRoughness.g;
        #endif`
      );
  };

  if (roughnessMap) material.roughnessMap = roughnessMap; // USE_ROUGHNESSMAPマクロを有効化させるためだけに設定
  material.needsUpdate = true;
  return material;
}
