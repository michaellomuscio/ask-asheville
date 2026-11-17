// Precipitation that follows the camera: rain streaks, or slower, wider snow.

import * as THREE from 'three';

// --- Rain --------------------------------------------------------------------------

const RAIN_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute vec4 aSeed;
uniform float uTime;
uniform vec3 uCenter;
uniform vec3 uBox;
uniform vec3 uVel;
uniform float uStreak;
varying float vFade;
void main() {
  vec3 off = uVel * uTime;
  vec3 p = fract((aSeed.xyz * uBox + off - uCenter) / uBox) * uBox;
  vec3 world = uCenter - uBox * 0.5 + p;
  world -= uVel * uStreak * aSeed.w;
  vec3 rel = world - uCenter;
  vFade = (1.0 - smoothstep(0.25, 0.5, length(rel.xz) / uBox.x)) * smoothstep(-0.5, -0.35, rel.y / uBox.y);
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  #include <logdepthbuf_vertex>
}`;

const RAIN_FRAG = /* glsl */ `
#include <logdepthbuf_pars_fragment>
uniform float uOpacity;
uniform vec3 uColor;
varying float vFade;
void main() {
  #include <logdepthbuf_fragment>
  gl_FragColor = vec4(uColor, uOpacity * vFade);
}`;

export class Rain {
  constructor(count = 9000) {
    const seeds = new Float32Array(count * 2 * 4);
    for (let i = 0; i < count; i++) {
      const x = Math.random();
      const y = Math.random();
      const z = Math.random();
      for (let e = 0; e < 2; e++) {
        const o = (i * 2 + e) * 4;
        seeds[o] = x;
        seeds[o + 1] = y;
        seeds[o + 2] = z;
        seeds[o + 3] = e;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 2 * 3), 3));
    this.uniforms = {
      uTime: { value: 0 },
      uCenter: { value: new THREE.Vector3() },
      uBox: { value: new THREE.Vector3(110, 60, 110) },
      uVel: { value: new THREE.Vector3(1.5, -11, 0.8) },
      uStreak: { value: 0.07 },
      uOpacity: { value: 0 },
      uColor: { value: new THREE.Color(0xaab8c8) },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: RAIN_VERT, fragmentShader: RAIN_FRAG, transparent: true, depthWrite: false,
    });
    this.lines = new THREE.LineSegments(geo, this.material);
    this.lines.frustumCulled = false;
    this.lines.visible = false;
    this.lines.renderOrder = 5;
  }

  update(realTime, camera, rain, wind, night, snow = 0) {
    const amount = Math.max(rain, snow);
    // Only near the ground: precipitation streaks look wrong from high above the county.
    this.lines.visible = amount > 0.02 && camera.position.y - (this.groundAt ? this.groundAt(camera.position.x, camera.position.z) : 0) < 600;
    if (!this.lines.visible) return;
    this.uniforms.uTime.value = realTime;
    this.uniforms.uCenter.value.copy(camera.position);
    if (snow > rain) {
      this.uniforms.uVel.value.set(0.6 + wind * 2, -1.6, 0.4 + wind);
      this.uniforms.uStreak.value = 0.25;
      this.uniforms.uOpacity.value = snow * (0.75 - night * 0.2);
      this.uniforms.uColor.value.setRGB(0.95 - night * 0.3, 0.96 - night * 0.3, 1.0 - night * 0.3);
    } else {
      this.uniforms.uVel.value.set(1 + wind * 4, -11 - rain * 3, 0.6 + wind * 2);
      this.uniforms.uStreak.value = 0.07;
      this.uniforms.uOpacity.value = rain * (0.55 - night * 0.2);
      this.uniforms.uColor.value.setRGB(0.62 - night * 0.3, 0.68 - night * 0.3, 0.76 - night * 0.3);
    }
  }
}
