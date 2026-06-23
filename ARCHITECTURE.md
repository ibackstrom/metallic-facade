# Architecture (for future agents)

Single file, no dependencies: `metallic-facade.js` exports the `MetallicFacade`
class. `index.html` instantiates it. WebGL2 with a WebGL1 fallback.

## Render pipeline — two passes per frame

```
                 ┌──────────────────── every animation frame ────────────────────┐
                 │                                                                │
  maskTex[A] ───▶│  PASS 1  accProg (ACC_FRAG)  →  FBO  →  maskTex[B]            │
  (prev paint)   │    • faded = max(prev - paintFade*dt, 0)   (linear fade)       │
                 │    • brush = soft circle at cursor (radius, feather)           │
                 │    • out   = max(faded, brush)                                 │
                 │  swap A⇄B                                                       │
                 │                                                                │
  maskTex[B] ───▶│  PASS 2  prog (FRAG)  →  canvas                                │
                 │    • reveal amount = texture(uMask, vUv).r                     │
                 │    • mix(white base, metallic, reveal)                         │
                 └────────────────────────────────────────────────────────────────┘
```

### Pass 1 — paint accumulation (`_paintPass`, `ACC_FRAG`)
A persistent single-channel "paint" buffer. Ping-pong between two textures
(`maskTex[0/1]`, fixed `MASK_SIZE = 1024`) through one FBO (`maskFBO`) because a
texture can't be read and written at once. Each frame it subtracts a small linear
amount (fade toward white) and stamps a soft brush at the cursor. `uActive`
(= `targetHover`) gates painting to when the pointer is over the canvas.

**Why linear, not multiply:** the buffer is 8-bit. A multiplicative decay's
per-frame step drops below half a quantization step and rounds back to the same
value — leaving a permanent gray ghost. Linear subtraction always reaches 0.
(See commit history if tempted to "optimize" this back.)

### Pass 2 — metal render (`_render`, `FRAG`)
Reads the paint buffer as the reveal mask and blends:
`finalColor = mix(baseColor, revealed, cursorAtten)` where
`cursorAtten = mask.r` and `revealed = mix(matte, metallic, uMetallic)`.

- **matte** = the untouched base image (white relief).
- **metallic** = a faked studio chrome: a vertical tonal ramp from the surface
  normal, two gaussian light strips, fresnel rim, AO/cavity from albedo +
  displacement, a contrast curve (`uMetalContrast`), and a **cursor-driven**
  diffuse + specular term so the metal reacts to cursor position like a moving
  light (`uLightIntensity`, `uSpecular`, `lightDir` follows the cursor).

## Texture units
0 base, 1 normal, 2 roughness, 3 displacement, 4 paint mask. In Pass 1, unit 0 is
temporarily the previous paint texture.

## Shaders
`FRAG` / `ACC_FRAG` are GLSL ES 3.00 (`#version 300 es`). `FRAG1` / `ACC_FRAG1`
are auto-derived for WebGL1 by string replacement (strip `#version`, `in`→
`varying`, `texture(`→`texture2D(`, drop `out`/`fragColor`). Edit only the GL2
source; the GL1 versions follow. Both programs bind `position` to attribute
location 0 (`bindAttribLocation`) so one vertex buffer + one attrib pointer
serves both.

## Coordinates
Cursor is normalized 0..1, **y up** (`_bindEvents`). `vUv` (from the fullscreen
triangle) is also y-up, so paint and sampling align. Distances use
`vec2(uAspectRatio, 1.0)` so the brush stays round. The base image is uploaded
with `UNPACK_FLIP_Y_WEBGL` so it displays upright.

## Key methods
- `_initGL` — link both programs, vertex buffer, uniform locations, then
  `_initPaintBuffers`.
- `_initPaintBuffers` / `_makeMaskTex` — create + clear the ping-pong textures.
- `_loop` — dt, cursor/hover smoothing, compute `_paintFade`, call passes.
- `_paintPass` — Pass 1 (renders into FBO, viewport = `MASK_SIZE`).
- `_render` — Pass 2 (resets viewport to canvas, binds mask, draws).
- `_generateNormalMap` — Sobel normal map when no `normalMap` supplied.

## Gotchas
- Reset the viewport in `_render`; Pass 1 sets it to `MASK_SIZE`.
- Never read and write the same paint texture — keep the ping-pong swap.
- Unused uniforms (e.g. `uFeather` in `FRAG`) may be stripped by the compiler;
  `getUniformLocation` returns null and `uniformXf(null, …)` is a safe no-op.
- The paint buffer is fixed-size and independent of canvas resize.

## Defaults vs overrides
`DEFAULTS` in `metallic-facade.js` holds every tunable. Options passed in
`index.html` win. User-facing meaning of each is in `USAGE.md`.
