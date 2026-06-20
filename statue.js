/*
 * Metallic Statue — a real 3D GLTF model that turns chrome on hover.
 *
 * Built with Three.js. The model keeps its colour + surface detail (base-color
 * and normal maps), but its metalness / roughness are driven by code:
 *   - not hovered → matte  (metalness 0.0, roughness 0.85)
 *   - hovered     → chrome (metalness 1.0, roughness 0.06)
 * An environment map (RoomEnvironment) gives the metal something to reflect.
 *
 * Usage:
 *   new MetallicStatue(container, { model: 'model/scene.gltf' });
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const DEFAULTS = {
  model: 'model/scene.gltf',
  matteMetalness: 0.0,
  matteRoughness: 0.85,
  chromeMetalness: 1.0,
  chromeRoughness: 0.06,
  envIntensity: 1.0,
  autoRotateSpeed: 0.3,   // radians/sec when idle
  fadeSpeed: 4,           // how fast it morphs matte <-> chrome
  background: 0x111317,
};

export default class MetallicStatue {
  constructor(container, options = {}) {
    this.cfg = Object.assign({}, DEFAULTS, options);
    this.container = container;
    this.materials = [];
    this.hover = 0;        // 0 = matte, 1 = chrome (smoothed)
    this.targetHover = 0;
    this._clock = new THREE.Clock();

    this._initRenderer();
    this._initScene();
    this._loadModel();
    this._bindEvents();

    this._loop = this._loop.bind(this);
    this.renderer.setAnimationLoop(this._loop);
  }

  _initRenderer() {
    const r = new THREE.WebGLRenderer({ antialias: true });
    r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    r.setSize(this.container.clientWidth, this.container.clientHeight);
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.1;
    r.outputColorSpace = THREE.SRGBColorSpace;
    this.container.appendChild(r.domElement);
    r.domElement.style.display = 'block';
    this.renderer = r;
  }

  _initScene() {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(this.cfg.background);

    const aspect = this.container.clientWidth / this.container.clientHeight;
    const camera = new THREE.PerspectiveCamera(40, aspect, 0.01, 100);
    camera.position.set(0, 0, 4);

    // Environment map so the metal has something to reflect.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

    // A couple of lights for the matte (non-reflective) state.
    scene.add(new THREE.AmbientLight(0xffffff, 0.4));
    const key = new THREE.DirectionalLight(0xffffff, 2.0);
    key.position.set(2, 3, 2);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x88aaff, 1.2);
    rim.position.set(-3, 1, -2);
    scene.add(rim);

    const controls = new OrbitControls(camera, this.renderer.domElement);
    controls.enableDamping = true;
    controls.enablePan = false;
    controls.minDistance = 1.5;
    controls.maxDistance = 8;

    this.scene = scene;
    this.camera = camera;
    this.controls = controls;
  }

  _loadModel() {
    new GLTFLoader().load(this.cfg.model, (gltf) => {
      const root = gltf.scene;

      root.traverse((o) => {
        if (!o.isMesh) return;
        const mat = o.material;
        // Drive metalness/roughness purely from code (ignore the packed
        // metallicRoughness map) so the matte<->chrome morph is strong & smooth.
        mat.metalnessMap = null;
        mat.roughnessMap = null;
        mat.envMapIntensity = this.cfg.envIntensity;
        mat.metalness = this.cfg.matteMetalness;
        mat.roughness = this.cfg.matteRoughness;
        mat.needsUpdate = true;
        this.materials.push(mat);
      });

      // Center the model at the origin and frame it with the camera.
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
    el.addEventListener('pointerenter', () => { this.targetHover = 1; });
    el.addEventListener('pointerleave', () => { this.targetHover = 0; });
    // On touch, tap toggles chrome since there's no hover.
    el.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') this.targetHover = this.targetHover ? 0 : 1;
    });
    window.addEventListener('resize', () => this._resize());
  }

  _resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  _loop() {
    const dt = Math.min(this._clock.getDelta(), 0.1);
    const k = 1 - Math.exp(-this.cfg.fadeSpeed * dt);
    this.hover += (this.targetHover - this.hover) * k;

    const c = this.cfg;
    for (const m of this.materials) {
      m.metalness = c.matteMetalness + (c.chromeMetalness - c.matteMetalness) * this.hover;
      m.roughness = c.matteRoughness + (c.chromeRoughness - c.matteRoughness) * this.hover;
    }

    if (this.pivot) this.pivot.rotation.y += c.autoRotateSpeed * dt;
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}

window.MetallicStatue = MetallicStatue;
