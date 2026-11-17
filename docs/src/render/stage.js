// Renderer, scene, camera and post-processing (HDR render target with MSAA, bloom for
// night lights, then tone mapping in the output pass). The scene spans ~80 km, so the
// depth buffer is logarithmic: a road 30 km away doesn't flicker against its mountainside.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

export const QUALITY = {
  low: { label: 'Low', pixelRatio: 1, shadows: false, shadowSize: 1024, bloom: false, vehicleDetail: 2500 },
  medium: { label: 'Medium', pixelRatio: 1, shadows: true, shadowSize: 2048, bloom: true, vehicleDetail: 5000 },
  high: { label: 'High', pixelRatio: 1.5, shadows: true, shadowSize: 4096, bloom: true, vehicleDetail: 9000 },
};

export class Stage {
  constructor(container) {
    this.container = container;
    const renderer = new THREE.WebGLRenderer({
      antialias: true, powerPreference: 'high-performance', stencil: false, logarithmicDepthBuffer: true,
    });
    renderer.setClearColor(0x0b0f14, 1);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.domElement.setAttribute('aria-label', '3D view of Buncombe County. Drag to orbit, scroll to zoom, right-drag to pan.');
    renderer.domElement.setAttribute('role', 'img');
    container.appendChild(renderer.domElement);
    this.renderer = renderer;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(45, 1, 1, 400000);

    const rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(renderer, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.3, 0.45, 1.0);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.quality = 'high';
    this.settings = QUALITY.high;
    this.onResize = [];
    this.resize();
    new ResizeObserver(() => this.resize()).observe(container);
  }

  setQuality(name) {
    this.quality = QUALITY[name] ? name : 'medium';
    this.settings = QUALITY[this.quality];
    this.renderer.shadowMap.enabled = this.settings.shadows;
    this.resize();
  }

  get pixelRatio() {
    return Math.min(window.devicePixelRatio || 1, this.settings.pixelRatio);
  }

  resize() {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    const pr = this.pixelRatio;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    for (const fn of this.onResize) fn(w, h, pr);
  }

  render() {
    if (this.settings.bloom) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }
}
