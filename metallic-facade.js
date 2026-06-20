/*
 * Metallic Facade — interactive matte→metallic hover effect.
 *
 * Reverse-engineered & adapted from the WebGL shader used on
 * https://week.wild.plus/athens-26
 *
 * How it works:
 *   - An image is drawn on a WebGL quad.
 *   - A NORMAL MAP gives the flat image fake 3D relief ("the models / facade").
 *   - A light FOLLOWS THE CURSOR. Where the cursor is, the normal-mapped
 *     surface lights up with sharp specular highlights = chrome / metallic look.
 *   - On mouse-enter the effect fades in (uHover 0→1); on leave it fades out.
 *
 * Usage:
 *   new MetallicFacade(container, {
 *     image: 'facade.jpg',
 *     normalMap: 'facade-normal.jpg', // optional; auto-generated if omitted
 *   });
 *
 * No dependencies. Requires WebGL2 (falls back to WebGL1).
 */

const VERT = `#version 300 es
in vec2 position;
out vec2 vUv;
void main() {
  vUv = position * 0.5 + 0.5;
  gl_Position = vec4(position, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;

uniform sampler2D uBaseTexture;
uniform sampler2D uNormalMap;

uniform vec2  uCursorPos;            // 0..1, y up
uniform float uAspectRatio;
uniform float uHover;                // 0..1 fade in/out
uniform vec3  uLightColor;
uniform float uLightIntensity;
uniform float uAmbientLight;
uniform float uCursorAmbient;
uniform float uLightRadius;
uniform float uSpecular;
uniform float uMetallic;             // 0 = matte, 1 = chrome
uniform float uCursorLightAngle;     // radians
uniform float uCursorDirFollowsCursor;

in vec2 vUv;
out vec4 fragColor;

void main() {
  vec2 ar           = vec2(uAspectRatio, 1.0);
  vec2 aspectUV     = vUv * ar;
  vec2 aspectCursor = uCursorPos * ar;

  vec4 baseColor = texture(uBaseTexture, vUv);

  // Normal map → surface normal (the fake 3D relief of the "models")
  vec3 normal = normalize(texture(uNormalMap, vUv).rgb * 2.0 - 1.0);

  vec3 viewDir = vec3(0.0, 0.0, 1.0);

  // Light direction: either follows the cursor or a fixed angle
  vec2  lightDelta  = aspectCursor - aspectUV;
  float lightDist   = length(lightDelta);
  vec2  cursorDir2D = vec2(cos(uCursorLightAngle), sin(uCursorLightAngle));
  vec3  followDir   = normalize(vec3(lightDelta, 0.4));
  vec3  fixedDir    = normalize(vec3(cursorDir2D, 0.5));
  vec3  lightDir    = mix(fixedDir, followDir, uCursorDirFollowsCursor);

  float cursorDiff    = max(dot(normal, lightDir), 0.0);
  vec3  halfVec       = normalize(lightDir + viewDir);
  float cursorSpec    = pow(max(dot(normal, halfVec), 0.0), 64.0);
  float cursorSpecMtl = pow(max(dot(normal, halfVec), 0.0), 16.0);

  // Light falls off with distance from the cursor, and fades with hover
  float cursorAtten = (1.0 - smoothstep(0.0, uLightRadius, lightDist)) * uHover;
  cursorAtten = clamp(cursorAtten, 0.0, 1.0);

  float effCursorDiff    = cursorDiff * uLightIntensity * cursorAtten;
  float effCursorSpec    = cursorSpec * uSpecular * cursorAtten;
  float effCursorAmbient = uCursorAmbient * cursorAtten;

  // ---- Matte plaster (subtle) — keeps the un-revealed look as the image ----
  vec3 matteColor = baseColor.rgb + uLightColor * effCursorSpec * 0.4;

  // ---- Chrome / liquid silver -------------------------------------------
  // Fake studio reflection: map the reflected ray to a vertical tonal ramp
  // (dark below -> bright above) with a bright horizon band, so the relief
  // reads as polished metal — deep recesses, hot highlights, full range.
  vec3  refl  = reflect(-viewDir, normal);
  float g     = clamp(refl.y, -1.0, 1.0);
  float body  = smoothstep(-0.6, 0.6, g);
  vec3  silver = mix(vec3(0.06, 0.06, 0.08), vec3(0.92, 0.94, 1.0), body);
  // bright "studio horizon" sweep — sits ABOVE the flat mid-tone so flat
  // areas stay mid-silver and only upward-facing curves catch the hot band.
  silver += vec3(0.5) * exp(-pow((g - 0.35) / 0.13, 2.0));
  float glint = pow(max(dot(normal, halfVec), 0.0), 40.0);    // moving hot spots
  silver += uLightColor * glint * uSpecular;
  vec3  metallicColor = clamp(silver, 0.0, 1.0);

  // ---- Reveal: matte -> chrome near the cursor, fading with hover ----
  vec3 revealed   = mix(matteColor, metallicColor, uMetallic);
  vec3 finalColor = mix(baseColor.rgb, revealed, cursorAtten);

  fragColor = vec4(finalColor, 1.0);
}`;

// WebGL1 fallback shaders
const VERT1 = `attribute vec2 position; varying vec2 vUv;
void main(){ vUv = position*0.5+0.5; gl_Position = vec4(position,0.0,1.0); }`;
const FRAG1 = FRAG
  .replace('#version 300 es\n', '')
  .replace('out vec4 fragColor;', '')
  .replace(/\bin vec2 vUv;/, 'varying vec2 vUv;')
  .replace(/\btexture\(/g, 'texture2D(')
  .replace(/fragColor/g, 'gl_FragColor');

const DEFAULTS = {
  image: null,
  normalMap: null,        // if null, generated from the image
  lightIntensity: 0.4,
  ambientLight: 0.5,      // brighter than the site (0.06) so the base is visible
  lightRadius: 1.5,
  specular: 1.1,
  cursorAmbient: 0.19,
  cursorLightAngle: 135,  // degrees
  cursorDirFollowsCursor: 1,
  metallic: 0.85,
  lightColor: [1, 1, 1],
  normalStrength: 1.0,    // used only when auto-generating the normal map
  fadeSpeed: 6,           // hover fade in/out speed
};

class MetallicFacade {
  constructor(container, options = {}) {
    this.cfg = Object.assign({}, DEFAULTS, options);
    this.container = container;

    this.canvas = document.createElement('canvas');
    Object.assign(this.canvas.style, {
      width: '100%', height: '100%', display: 'block',
    });
    container.appendChild(this.canvas);

    this.gl = this.canvas.getContext('webgl2');
    this.isGL2 = !!this.gl;
    if (!this.gl) this.gl = this.canvas.getContext('webgl');
    if (!this.gl) { console.error('WebGL not supported'); return; }

    this.cursor = { x: 0.5, y: 0.5 };
    this.targetCursor = { x: 0.5, y: 0.5 };
    this.hover = 0;
    this.targetHover = 0;
    this.aspect = 1;

    this._initGL();
    this._bindEvents();
    this._loadTextures();

    this._lastT = performance.now();
    this._loop = this._loop.bind(this);
    requestAnimationFrame(this._loop);
  }

  _compile(type, src) {
    const gl = this.gl;
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
      throw gl.getShaderInfoLog(s);
    return s;
  }

  _initGL() {
    const gl = this.gl;
    const prog = gl.createProgram();
    gl.attachShader(prog, this._compile(gl.VERTEX_SHADER, this.isGL2 ? VERT : VERT1));
    gl.attachShader(prog, this._compile(gl.FRAGMENT_SHADER, this.isGL2 ? FRAG : FRAG1));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS))
      throw gl.getProgramInfoLog(prog);
    gl.useProgram(prog);
    this.prog = prog;

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'position');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    this.u = {};
    [
      'uBaseTexture', 'uNormalMap', 'uCursorPos', 'uAspectRatio', 'uHover',
      'uLightColor', 'uLightIntensity', 'uAmbientLight', 'uCursorAmbient',
      'uLightRadius', 'uSpecular', 'uMetallic', 'uCursorLightAngle',
      'uCursorDirFollowsCursor',
    ].forEach(n => this.u[n] = gl.getUniformLocation(prog, n));
  }

  _placeholderTexture(rgba) {
    const gl = this.gl;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA,
      gl.UNSIGNED_BYTE, new Uint8Array(rgba));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return t;
  }

  _uploadTexture(tex, img) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  }

  _loadTextures() {
    const gl = this.gl;
    this.baseTex = this._placeholderTexture([200, 200, 200, 255]);
    this.normalTex = this._placeholderTexture([128, 128, 255, 255]);

    if (!this.cfg.image) return;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      this.aspect = img.width / img.height;
      this._resize();
      this._uploadTexture(this.baseTex, img);

      if (this.cfg.normalMap) {
        const n = new Image();
        n.crossOrigin = 'anonymous';
        n.onload = () => this._uploadTexture(this.normalTex, n);
        n.src = this.cfg.normalMap;
      } else {
        this._uploadTexture(this.normalTex,
          this._generateNormalMap(img, this.cfg.normalStrength));
      }
    };
    img.src = this.cfg.image;
  }

  // Build a normal map from the image's luminance using a Sobel filter.
  _generateNormalMap(img, strength) {
    const w = img.naturalWidth, h = img.naturalHeight;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const src = ctx.getImageData(0, 0, w, h).data;

    const lum = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++)
      lum[i] = (0.299 * src[i * 4] + 0.587 * src[i * 4 + 1] + 0.114 * src[i * 4 + 2]) / 255;

    const out = ctx.createImageData(w, h);
    const at = (x, y) => lum[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const dx = (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1))
                 - (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1));
        const dy = (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1))
                 - (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1));
        const nx = -dx * strength, ny = -dy * strength, nz = 1.0;
        const len = Math.hypot(nx, ny, nz) || 1;
        const o = (y * w + x) * 4;
        out.data[o]     = (nx / len * 0.5 + 0.5) * 255;
        out.data[o + 1] = (ny / len * 0.5 + 0.5) * 255;
        out.data[o + 2] = (nz / len * 0.5 + 0.5) * 255;
        out.data[o + 3] = 255;
      }
    }
    ctx.putImageData(out, 0, 0);
    return c;
  }

  _bindEvents() {
    const move = (clientX, clientY) => {
      const r = this.canvas.getBoundingClientRect();
      this.targetCursor.x = (clientX - r.left) / r.width;
      this.targetCursor.y = 1 - (clientY - r.top) / r.height; // y up
    };
    this.canvas.addEventListener('pointermove', e => move(e.clientX, e.clientY));
    this.canvas.addEventListener('pointerenter', () => { this.targetHover = 1; });
    this.canvas.addEventListener('pointerleave', () => { this.targetHover = 0; });
    window.addEventListener('resize', () => this._resize());
  }

  _resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = this.container.clientWidth || this.canvas.clientWidth;
    const h = this.container.clientHeight || this.canvas.clientHeight;
    this.canvas.width = Math.max(1, Math.floor(w * dpr));
    this.canvas.height = Math.max(1, Math.floor(h * dpr));
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    this.viewAspect = w / h;
  }

  _loop(t) {
    const dt = Math.min((t - this._lastT) / 1000, 0.1);
    this._lastT = t;
    const k = 1 - Math.exp(-this.cfg.fadeSpeed * dt);
    this.cursor.x += (this.targetCursor.x - this.cursor.x) * k;
    this.cursor.y += (this.targetCursor.y - this.cursor.y) * k;
    this.hover += (this.targetHover - this.hover) * k;
    this._render();
    requestAnimationFrame(this._loop);
  }

  _render() {
    const gl = this.gl, u = this.u, c = this.cfg;
    gl.useProgram(this.prog);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.baseTex);
    gl.uniform1i(u.uBaseTexture, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.normalTex);
    gl.uniform1i(u.uNormalMap, 1);

    gl.uniform2f(u.uCursorPos, this.cursor.x, this.cursor.y);
    gl.uniform1f(u.uAspectRatio, this.aspect || 1);
    gl.uniform1f(u.uHover, this.hover);
    gl.uniform3fv(u.uLightColor, c.lightColor);
    gl.uniform1f(u.uLightIntensity, c.lightIntensity);
    gl.uniform1f(u.uAmbientLight, c.ambientLight);
    gl.uniform1f(u.uCursorAmbient, c.cursorAmbient);
    gl.uniform1f(u.uLightRadius, c.lightRadius);
    gl.uniform1f(u.uSpecular, c.specular);
    gl.uniform1f(u.uMetallic, c.metallic);
    gl.uniform1f(u.uCursorLightAngle, c.cursorLightAngle * Math.PI / 180);
    gl.uniform1f(u.uCursorDirFollowsCursor, c.cursorDirFollowsCursor);

    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}

window.MetallicFacade = MetallicFacade;
export default MetallicFacade;
