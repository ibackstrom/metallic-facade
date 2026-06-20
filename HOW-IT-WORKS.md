# How the metallic hover effect works

This document explains, in detail, how the matte → metallic hover effect is
built. It covers the high-level idea, the rendering pipeline, every uniform, and
a line-by-line walkthrough of the GLSL fragment shader.

The technique was reverse-engineered from
[week.wild.plus/athens-26](https://week.wild.plus/athens-26).

---

## 1. The core idea

A common misconception is that an effect like this needs real 3D models. It does
not. The whole thing is a **single flat quad** (two triangles) with an image
texture on it. The illusion of depth and metal comes from two tricks:

1. **A normal map** gives every pixel a fake surface orientation, so the flat
   image *behaves* like it has bumps, grooves, and rounded columns.
2. **A light that follows the cursor** is evaluated per-pixel against those fake
   normals. Where the surface faces the light, you get a bright **specular
   highlight** — the visual signature of polished metal.

By mixing between a "matte" lighting formula and a "metallic" one, and fading the
whole thing in on hover, you get: *a normal-looking image that turns chrome as
your cursor sweeps across it.*

```diagram
╭───────────────────────────────────────────────────────────────────╮
│                         per pixel (fragment)                        │
│                                                                     │
│   base color ──┐                                                    │
│                ├──► matte shading ──┐                               │
│   normal map ──┤                    ├─ mix(matte, metallic, uMetallic)
│                ├──► metallic shading┘            │                  │
│   cursor pos ──┘                                 ▼                  │
│                                      mix(base, lit, hover) ──► pixel │
╰───────────────────────────────────────────────────────────────────╯
```

---

## 2. The rendering pipeline

The whole effect lives in [`metallic-facade.js`](metallic-facade.js). The steps:

1. **Create a canvas** inside the container and get a `webgl2` context (falling
   back to `webgl`).
2. **Compile two shaders:**
   - a trivial *vertex shader* that draws one full-screen triangle and passes
     UV coordinates through;
   - the *fragment shader* that does all the lighting (explained below).
3. **Upload two textures:**
   - `uBaseTexture` — your image;
   - `uNormalMap` — either the image you provide, or one generated on the fly
     (see §5).
4. **Track input:** `pointermove` updates a target cursor position;
   `pointerenter` / `pointerleave` set a target hover value of `1` / `0`.
5. **Animate every frame:** the actual cursor position and hover value are
   *smoothed* toward their targets with an exponential easing, then all uniforms
   are uploaded and the quad is redrawn.

### Why one triangle instead of a quad?

The vertex buffer is `[-1,-1, 3,-1, -1,3]`. That single oversized triangle
covers the entire clip-space `[-1,1]²` region, which is a tiny bit cheaper than
two triangles and avoids a seam down the diagonal. The `position * 0.5 + 0.5`
in the vertex shader turns clip-space coordinates into `0..1` UVs.

### Smoothing (the "follow" feel)

Each frame:

```js
const k = 1 - Math.exp(-fadeSpeed * dt);
cursor.x += (targetCursor.x - cursor.x) * k;
hover    += (targetHover    - hover)    * k;
```

This is frame-rate-independent exponential smoothing. Instead of snapping the
light to the cursor, it eases toward it, which is what makes the highlight feel
like it has weight and "drags" behind the pointer. `fadeSpeed` controls how
quickly it catches up (and how fast the effect fades in/out on enter/leave).

---

## 3. The uniforms

| Uniform | Type | Meaning |
|---------|------|---------|
| `uBaseTexture` | `sampler2D` | The image. |
| `uNormalMap` | `sampler2D` | Per-pixel surface normals, encoded as RGB. |
| `uCursorPos` | `vec2` | Cursor position in `0..1` UV space, **y up**. |
| `uAspectRatio` | `float` | image width / height; corrects distance math. |
| `uHover` | `float` | `0..1`, smoothed; fades the whole effect in/out. |
| `uLightColor` | `vec3` | Color of the cursor light. |
| `uLightIntensity` | `float` | Diffuse strength. |
| `uAmbientLight` | `float` | Flat base brightness everywhere. |
| `uCursorAmbient` | `float` | Extra fill light near the cursor. |
| `uLightRadius` | `float` | Falloff radius of the cursor light. |
| `uSpecular` | `float` | Matte specular strength. |
| `uMetallic` | `float` | `0` = matte, `1` = chrome. |
| `uCursorLightAngle` | `float` | Fixed light angle (radians). |
| `uCursorDirFollowsCursor` | `float` | `1` = light follows cursor, `0` = fixed. |

---

## 4. The fragment shader, line by line

The fragment shader runs once per pixel. Here is what each block does.

### 4.1 Aspect correction

```glsl
vec2 ar           = vec2(uAspectRatio, 1.0);
vec2 aspectUV     = vUv * ar;
vec2 aspectCursor = uCursorPos * ar;
```

UV coordinates run `0..1` on both axes regardless of the image's real shape. If
we measured the distance from the cursor in raw UVs, the light would look like a
squashed ellipse on a non-square image. Multiplying both the pixel and the
cursor by `(aspectRatio, 1.0)` puts them in a space where 1 unit is the same
physical distance horizontally and vertically, so the light is a true circle.

### 4.2 Sampling the textures

```glsl
vec4 baseColor = texture(uBaseTexture, vUv);
vec3 normal    = normalize(texture(uNormalMap, vUv).rgb * 2.0 - 1.0);
```

The base color is read straight from the image. The normal map stores a
direction in its RGB channels, but colors are `0..1` while a direction component
is `-1..1`. The `* 2.0 - 1.0` decodes it:

- `0.5, 0.5, 1.0` (the flat blue of a normal map) → `0, 0, 1` = "facing
  straight out of the screen".
- Deviations in R/G tilt the normal left/right/up/down — those tilts are what
  catch the light along column edges and statue contours.

### 4.3 Building the light direction

```glsl
vec2  lightDelta  = aspectCursor - aspectUV;     // vector toward the cursor
float lightDist   = length(lightDelta);          // distance to the cursor
vec2  cursorDir2D = vec2(cos(uCursorLightAngle), sin(uCursorLightAngle));
vec3  followDir   = normalize(vec3(lightDelta, 0.4));   // points at the cursor
vec3  fixedDir    = normalize(vec3(cursorDir2D, 0.5));  // points at a fixed angle
vec3  lightDir    = mix(fixedDir, followDir, uCursorDirFollowsCursor);
```

Two candidate light directions are computed:

- `followDir` aims from the current pixel toward the cursor (the `0.4` z-component
  lifts the light off the surface so highlights aren't razor-thin).
- `fixedDir` is a constant direction set by `uCursorLightAngle`.

`mix(...)` selects between them based on `uCursorDirFollowsCursor`. By default
the light follows the cursor, which is what makes highlights sweep across the
surface as you move.

### 4.4 Diffuse and specular terms

```glsl
float cursorDiff    = max(dot(normal, lightDir), 0.0);
vec3  halfVec       = normalize(lightDir + viewDir);          // viewDir = (0,0,1)
float cursorSpec    = pow(max(dot(normal, halfVec), 0.0), 64.0);  // tight, matte
float cursorSpecMtl = pow(max(dot(normal, halfVec), 0.0), 16.0);  // broad, metal
```

This is textbook **Blinn–Phong** lighting:

- **Diffuse** (`cursorDiff`): how directly the surface faces the light
  (`N · L`). Gives soft shading that reveals the bumps.
- **Specular**: the shiny hotspot, computed from the *half vector* between the
  light and the viewer (`N · H` raised to a power). A **higher exponent = a
  smaller, sharper highlight**.
  - The matte path uses exponent `64` (a small, focused glint).
  - The metallic path uses exponent `16` (a broader, brighter sheen — polished
    metal scatters its highlight more).

### 4.5 Distance falloff and hover gate

```glsl
float cursorAtten = (1.0 - smoothstep(0.0, uLightRadius, lightDist)) * uHover;
cursorAtten = clamp(cursorAtten, 0.0, 1.0);
```

`smoothstep` makes the light fade smoothly to zero at `uLightRadius`. Multiplying
by `uHover` means the entire lit contribution is scaled by how "hovered" the
element is — so on mouse-leave everything fades back to the plain image.

### 4.6 Matte shading

```glsl
vec3 matteColor = baseColor.rgb * (uAmbientLight + effCursorAmbient
                + effCursorDiff * uLightColor)
                + uLightColor * effCursorSpec;
```

The base color is lit by ambient + diffuse, then a white specular glint is added
on top. This is what a non-metallic, slightly glossy surface looks like.

### 4.7 Metallic shading

```glsl
float effMetalSpec   = cursorSpecMtl * uLightIntensity * 2.0 * cursorAtten;
float effMetalDiff   = cursorDiff    * uLightIntensity * 0.25 * cursorAtten;
vec3  metalHighlight = mix(uLightColor * effMetalSpec,
                           baseColor.rgb * effMetalSpec, 0.75);
vec3  metallicColor  = baseColor.rgb * (uAmbientLight + effCursorAmbient
                     + effMetalDiff * uLightColor)
                     + metalHighlight;
```

Three things make this read as **metal** rather than plastic:

1. **Weaker diffuse** (`* 0.25`): metal reflects light specularly, not diffusely,
   so the soft "matte" shading is dialed way down.
2. **Stronger, broader specular** (`* 2.0`, exponent 16): the highlight dominates.
3. **Tinted highlight:** real metal colors its reflections. `metalHighlight`
   mixes the white light color with the base color (75% toward the base color),
   so a bronze statue throws a bronze-tinted glint instead of a pure-white one.

### 4.8 Choosing matte vs metallic, then fading in

```glsl
vec3 lit        = clamp(mix(matteColor, metallicColor, uMetallic), 0.0, 1.0);
vec3 finalColor = mix(baseColor.rgb, lit, clamp(uHover, 0.0, 1.0));
fragColor       = vec4(finalColor, 1.0);
```

- `uMetallic` blends continuously between the two looks — you can set it to `0.5`
  for a "satin" finish.
- The final `mix(baseColor, lit, uHover)` cross-fades from the plain image to the
  fully lit result, so the effect smoothly appears on hover and disappears on
  leave.

---

## 5. Auto-generating the normal map

If you don't supply a normal map, one is built from the image's brightness with a
**Sobel filter** (`_generateNormalMap` in the JS):

1. Convert the image to grayscale (luminance).
2. For each pixel, measure how fast brightness changes horizontally (`dx`) and
   vertically (`dy`) using 3×3 Sobel kernels.
3. Treat those gradients as the slope of a height field: a normal of
   `(-dx, -dy, 1)`, normalized.
4. Encode that direction back into RGB with `value * 0.5 + 0.5`.

This treats *bright = high, dark = low*, which works surprisingly well for
photos of carved/relief surfaces. The `normalStrength` option scales `dx`/`dy`
to exaggerate or soften the relief. It is only a heuristic — a properly authored
or baked normal map will always look better.

---

## 6. Differences from the original site

The original Framer site bundles this shader with a few extra features that were
left out here to keep the component small and dependency-free:

- A **"smudge" reveal trail** rendered with a ping-pong framebuffer, so the lit
  area persists where the cursor has travelled (instead of only around the live
  cursor).
- An **intro dissolve** that fades the image in through a cloud-noise mask.
- A **"topper" texture** with multiple Photoshop-style blend modes
  (multiply / overlay / screen / soft-light).
- The site runs through **Three.js**; this version is plain WebGL.

The lighting math (diffuse, specular, matte vs metallic mix, tinted metal
highlight) is taken directly from the original fragment shader.
