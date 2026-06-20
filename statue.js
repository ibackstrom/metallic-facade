/*
 * Metallic Statue — a real 3D GLTF model that looks like white marble and turns
 * to silver chrome under the cursor, matching the look of
 * https://week.wild.plus/athens-26
 *
 * Default  : white matte "marble" (keeps the model's normal map for relief).
 * On hover : a soft circular region around the cursor becomes polished silver,
 *            reflecting an environment map — exactly like the original reveal.
 *
 * Built with Three.js. Usage:
 *   new MetallicStatue(container, { model: 'model/scene.gltf' });
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const DEFAULTS = {
  model: 'model/scene.gltf',
  marbleColor: 0xeae8e1,    // off-white marble
  chromeRoughness: 0.16,    // silver isn't a perfect mirror
  envIntensity: 1.35,       // brightness of the silver reflections
  revealRadius: 0.42,       // reveal size, as a fraction of the canvas
  autoRotateSpeed: 0.0,     // static, like the original (set >0 to spin)
  fadeSpeed: 7,             // how fast the reveal fades in/out
  background: 0xdddcd7,     // the original's light beige
};

export default class MetallicStatue {
  constructor(container, options = {}) {
    this.cfg = Object.assign({}, DEFAULTS, options);
    this.container = container;
    this._clock = new THREE.Clock();
    this.targetHover = 0;

    // Shared uniforms, injected into every material's shader.
    this.uReveal = { value: 0 };                              // 0..1 smoothed hover
    this.uCursorPx = { value: new THREE.Vector2(-1e5, -1e5) };// device-pixel cursor
    this.uResolution = { value: new THREE.Vector2(1, 1) };
    this.uRadiusPx = { value: 300 };

    this._initRenderer();
    this._initScene();
    this._loadModel();
    this._bindEvents();
    this._resize();

    this._loop = this._loop.bind(this);
    this.renderer.setAnimationLoop(this._loop);
  }

  _initRenderer() {
    const r = new THREE.WebGLRenderer({ antialias: true });
    r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    r.setSize(this.container.clientWidth, this.container.clientHeight);
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.0;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.domElement.style.display = 'block';
    this.container.appendChild(r.domElement);
    this.renderer = r;
  }

  _initScene() {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(this.cfg.background);

    const aspect = this.container.clientWidth / this.container.clientHeight;
    const camera = new THREE.PerspectiveCamera(40, aspect, 0.01, 100);
    camera.position.set(0, 0, 4);

    // Environment map gives the silver something bright to reflect.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

    // Soft, even lighting for the matte marble look.
    scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(1, 3, 2);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 0.8);
    fill.position.set(-2, 0.5, 1);
    scene.add(fill);

    const controls = new OrbitControls(camera, this.renderer.domElement);
    controls.enableDamping = true;
    controls.enablePan = false;
    controls.minDistance = 1.5;
    controls.maxDistance = 8;

    this.scene = scene;
    this.camera = camera;
    this.controls = controls;
  }

  // Inject a cursor-driven "reveal" into a MeshStandardMaterial so the area near
  // the cursor becomes metallic (low roughness, full metalness) while the rest
  // stays matte marble.
  _patchMaterial(mat) {
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uReveal = this.uReveal;
      shader.uniforms.uCursorPx = this.uCursorPx;
      shader.uniforms.uRadiusPx = this.uRadiusPx;
      shader.uniforms.uChromeRoughness = { value: this.cfg.chromeRoughness };

      shader.fragmentShader =
        'uniform float uReveal;\nuniform vec2 uCursorPx;\nuniform float uRadiusPx;\nuniform float uChromeRoughness;\n'
        + shader.fragmentShader;

      // roughnessmap_fragment runs before metalnessmap_fragment, so the locals
      // declared here are visible to the metalness patch below.
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
         float _dist  = distance(gl_FragCoord.xy, uCursorPx);
         float _fall  = 1.0 - smoothstep(uRadiusPx * 0.35, uRadiusPx, _dist);
         float _metal = clamp(uReveal * _fall, 0.0, 1.0);
         roughnessFactor = mix(roughnessFactor, uChromeRoughness, _metal);`
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <metalnessmap_fragment>',
        `#include <metalnessmap_fragment>
         metalnessFactor = mix(metalnessFactor, 1.0, _metal);`
      );
    };
    mat.needsUpdate = true;
  }

  _loadModel() {
    new GLTFLoader().load(this.cfg.model, (gltf) => {
      const root = gltf.scene;

      root.traverse((o) => {
        if (!o.isMesh) return;
        const mat = o.material;
        // White marble base: drop the colour + packed metal/rough maps, keep the
        // normal map so the carved relief still catches the light.
        mat.map = null;
        mat.metalnessMap = null;
        mat.roughnessMap = null;
        mat.aoMap = null;
        mat.color = new THREE.Color(this.cfg.marbleColor);
        mat.metalness = 1.0;          // gated by the reveal in the shader
        mat.roughness = 0.95;         // matte by default
        mat.envMapIntensity = this.cfg.envIntensity;
        this._patchMaterial(mat);
      });

      // Center + frame the model.
      const box = new THREE.Box3().setFromObject(root);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      root.position.sub(center);

      const maxDim = Math.max(size.x, size.y, size.z);
      const fov = this.camera.fov * Math.PI / 180;
      const dist = (maxDim / 2) / Math.tan(fov / 2) * 1.4;
      this.camera.position.set(0, size.y * 0.05, dist);
      this.camera.near = dist / 100;
      this.camera.far = dist * 100;
      this.camera.updateProjectionMatrix();
      this.controls.update();

      this.pivot = new THREE.Group();
      this.pivot.add(root);
      this.scene.add(this.pivot);
      this.container.classList.add('loaded');
    },
    undefined,
    (err) => console.error('Failed to load model:', err));
  }

  _bindEvents() {
    const el = this.renderer.domElement;
    const setCursor = (e) => {
      const rect = el.getBoundingClientRect();
      const dpr = this.renderer.getPixelRatio();
      const x = (e.clientX - rect.left) * dpr;
      // gl_FragCoord origin is bottom-left, so flip Y.
      const y = (rect.height - (e.clientY - rect.top)) * dpr;
      this.uCursorPx.value.set(x, y);
    };
    el.addEventListener('pointermove', setCursor);
    el.addEventListener('pointerenter', (e) => { setCursor(e); this.targetHover = 1; });
    el.addEventListener('pointerleave', () => { this.targetHover = 0; });
    el.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') { setCursor(e); this.targetHover = this.targetHover ? 0 : 1; }
    });
    window.addEventListener('resize', () => this._resize());
  }

  _resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    const dpr = this.renderer.getPixelRatio();
    this.uResolution.value.set(w * dpr, h * dpr);
    this.uRadiusPx.value = Math.min(w, h) * dpr * this.cfg.revealRadius;
  }

  _loop() {
    const dt = Math.min(this._clock.getDelta(), 0.1);
    const k = 1 - Math.exp(-this.cfg.fadeSpeed * dt);
    this.uReveal.value += (this.targetHover - this.uReveal.value) * k;

    if (this.pivot && this.cfg.autoRotateSpeed) {
      this.pivot.rotation.y += this.cfg.autoRotateSpeed * dt;
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}

window.MetallicStatue = MetallicStatue;
