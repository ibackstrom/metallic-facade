# Texture pipeline — how the metallic effect works and how to add your own

This demo turns a flat image into a surface that becomes **polished silver under
the cursor**. It needs two textures:

| Texture | Purpose |
|---------|---------|
| **Base image** (`relief.png`) | What you see at rest (matte plaster / marble). |
| **Normal map** (`relief-normal.png`) | Fake 3D surface used to compute the metal reflections. |

The whole thing is one fullscreen quad with a fragment shader in
[`metallic-facade.js`](metallic-facade.js). No 3D geometry, no dependencies.

```diagram
╭──────────────╮   build    ╭──────────────╮
│  base image  │──────────▶ │  normal map  │   (gen-normal.py, or authored)
╰──────┬───────╯            ╰──────┬───────╯
       │                           │
       ▼                           ▼
   uBaseTexture                uNormalMap
       │                           │
       ╰──────────▶ fragment shader ◀────────╯
                          │
            cursor reveal: matte ──▶ chrome
                          │
                          ▼
                     final pixel
```

---

## 1. Prepare the base image

Pick a **frontal, evenly lit, light-coloured relief** on a plain background
(marble busts, bas-reliefs, coins, carved facades all work). Save it as
`relief.png` (or `.jpg`) in the project folder.

Tips for the best result:
- Flat, head-on photo — perspective/strong side-shadows fight the effect.
- Light subject on a neutral background so the metal reveal reads clearly.
- Note the pixel **width / height**; you'll use it for the aspect ratio.

---

## 2. Build the normal map

A normal map encodes, per pixel, which way the surface "faces". The shader uses
it to decide where light reflects, which is what makes flat pixels look like 3D
metal. You have two options.

### Option A — generate one from the image (recommended starting point)

Use the bundled script. It treats brightness as height and combines a **broad**
blur (smooth volumetric form) with a **fine** blur (crisp detail):

```bash
pip install numpy Pillow          # one-time
python scripts/gen-normal.py relief.png relief-normal.png
```

Tuning flags (defaults in parentheses):

| Flag | Default | Effect |
|------|---------|--------|
| `--broad`   | `9`  | Blur radius for the big form. Larger = smoother, more "liquid" silver. |
| `--fine`    | `1.5`| Blur radius for detail. Smaller = sharper hair/beard lines. |
| `--broad-w` | `28` | How strongly the broad form bends the surface (chrome drama). |
| `--fine-w`  | `5`  | How strongly fine detail shows up. |
| `--flatten` | `0`  | High-pass radius. **Use ~30–48 for real museum photos** of weathered/stained marble: it removes lighting gradients and stains that would otherwise become "molten" waves on flat surfaces. Leave `0` for clean digital reliefs. |

Example — a real (weathered, side-lit) museum photo cleaned up to polished cast silver:

```bash
python scripts/gen-normal.py relief.png relief-normal.png \
    --flatten 42 --broad 10 --fine 3 --broad-w 28 --fine-w 2
```

> **Source matters most.** A *clean, evenly-lit, frontal* relief (or a digital
> render) gives crisp polished chrome. A weathered, side-lit marble photo carries
> its surface pitting and lighting into the normals — `--flatten` and heavier
> blur tame it, but a clean source always wins.

Example — punchier, deeper relief:

```bash
python scripts/gen-normal.py relief.png relief-normal.png --broad 12 --broad-w 40
```

Why two scales? A plain edge filter (single fine pass) only finds outlines, so
the metal comes out flat with speckled edges. The broad pass gives each face a
smooth curve, so the reflection sweeps across it like real chrome.
The blur is done in floating point to avoid stair-step **banding** in the
gradients.

### Option B — use an authored / downloaded normal map

Any tangent-space normal map (the mostly purple-blue images) works — e.g. a
tiling stone/pebble texture. Drop it in the folder and point `normalMap` at it.
It **replaces** the surface shape, so the base image's own relief is overridden
by the texture's bumps (good for an all-over metal-pebble look, not for keeping
the subject's form).

> A real, authored normal map of *your subject* always looks best. The generated
> one (Option A) is a convincing approximation from a single photo.

#### Using a full PBR set (e.g. Poly Haven / ambientCG, CC0)

These ship an **albedo** (`*_diff`) and a real **normal map** (`*_nor_gl` =
OpenGL/Y-up, which is what this shader expects). Use `diff` as the `image` and the
normal as `normalMap` — this is the highest-quality, lowest-effort route.

If the normal is an `.exr` (float), convert it to PNG once (the browser can't load
EXR):

```python
import os; os.environ['OPENCV_IO_ENABLE_OPENEXR'] = '1'
import cv2, numpy as np
from PIL import Image
exr = cv2.imread('wall_nor_gl_1k.exr', cv2.IMREAD_UNCHANGED)        # BGR float
rgb = cv2.cvtColor(exr, cv2.COLOR_BGR2RGB)
Image.fromarray(np.clip(rgb * 255 + 0.5, 0, 255).astype('uint8')).save('relief-normal.png')
```

Use `*_nor_gl` (OpenGL), **not** `*_nor_dx` (DirectX) — the DX one has its green
channel flipped and the lighting will look inverted.

You can also wire in the **roughness** and **displacement** maps for extra realism
(`roughnessMap` makes some areas satin and others mirror; `dispMap` darkens the
crevices and lifts raised faces):

```python
# roughness EXR (single channel float) -> grayscale PNG
r = cv2.imread('rough_1k.exr', cv2.IMREAD_UNCHANGED)
if r.ndim == 3: r = r[..., 0]
Image.fromarray(np.clip(r * 255 + 0.5, 0, 255).astype('uint8'), 'L').save('relief-rough.png')

# displacement is often a 16-bit PNG -> normalize to 8-bit (don't just convert('L'),
# that clips!)
a = np.asarray(Image.open('disp_1k.png')).astype(np.float32)
a = (a - a.min()) / (a.max() - a.min())
Image.fromarray((a * 255 + 0.5).astype('uint8'), 'L').save('relief-disp.png')
```

```js
new MetallicFacade(el, {
  image: 'relief.png', normalMap: 'relief-normal.png',
  roughnessMap: 'relief-rough.png', dispMap: 'relief-disp.png',
});
```

### Option C — combine subject form + a detail texture (recommended for "one image + a separate normal map")

If you have **one base image** and a **separate, unrelated normal map** (e.g. a
tiling pebble/hammered map), don't just swap it in — that *replaces* the
subject's shape and the figures disappear. Instead blend the subject's own form
(Option A) with the detail map so the subject stays and gains a metal texture:

```bash
# 1. form normal from the image
python scripts/gen-normal.py relief.png relief-normal.png
# 2. blend in the detail texture
python scripts/combine-normals.py relief-normal.png pebbles-normal.jpg \
    relief-normal-combined.png --detail 0.18 --tile 3.0
# 3. point index.html at relief-normal-combined.png
```

| Flag | Default | Effect |
|------|---------|--------|
| `--detail` | `0.6` | Texture strength. **Keep it low (~0.15–0.25)** or the texture drowns the subject. |
| `--tile`   | `2.0` | How many times the detail repeats across the width (bigger = smaller bumps). |

---

## 3. Wire the textures into the page

Edit [`index.html`](index.html):

```html
<div class="stage" id="stage"></div>
<script type="module">
  import MetallicFacade from './metallic-facade.js';
  new MetallicFacade(document.getElementById('stage'), {
    image:     'relief.png',
    normalMap: 'relief-normal.png',  // omit to auto-generate at runtime
    metallic:   0.95,
    ambientLight: 0.5,
    lightRadius:  1.6,
    specular:     1.3,
  });
</script>
```

Set the stage box to your image's aspect ratio so it isn't stretched:

```css
.stage { width: min(86vw, 600px); aspect-ratio: 837 / 1292; }
```

If you omit `normalMap`, the component generates one in the browser from the
image brightness (Sobel filter) using the `normalStrength` option — handy for a
quick look, but the offline script (Option A) is higher quality.

---

## 4. Options reference (`metallic-facade.js`)

| Option | Default | Meaning |
|--------|---------|---------|
| `image` | `null` | Base image URL (required). |
| `normalMap` | `null` | Normal map URL; auto-generated from `image` if omitted. |
| `roughnessMap` | `null` | Optional. `r` channel: 0 = mirror, 1 = matte. Varies the reflection sharpness per pixel (satin vs polished). |
| `dispMap` | `null` | Optional. `r` channel height: 0 = recess, 1 = peak. Darkens crevices and lifts raised faces. |
| `metallic` | `0.85` | 0 = matte, 1 = full chrome under the cursor. |
| `lightRadius` | `1.5` | Size of the reveal around the cursor. |
| `specular` | `1.1` | Strength of the sharp moving highlights. |
| `ambientLight` | `0.5` | Base brightness inside the reveal. |
| `lightColor` | `[1,1,1]` | Tint of highlights (e.g. warm gold). |
| `normalStrength` | `1.0` | Depth — only when auto-generating the normal map. |
| `fadeSpeed` | `6` | How fast the reveal fades in/out. |
| `cursorDirFollowsCursor` | `1` | 1 = light follows cursor; 0 = fixed angle. |
| `cursorLightAngle` | `135` | Fixed light angle in degrees (when not following). |

---

## 5. How the shader turns normals into metal

Inside the fragment shader (`FRAG` in `metallic-facade.js`):

1. **Sample** the base colour and decode the normal:
   `normal = normalize(texture(uNormalMap, vUv).rgb * 2.0 - 1.0)`.
2. **Reveal mask** — `cursorAtten` is a soft circle around the cursor
   (`lightRadius`) multiplied by the hover fade. 0 away from the cursor, 1 on it.
3. **Chrome colour** — a *fake studio reflection* sampled by the reflection
   vector: a vertical tonal ramp (flat → mid-silver, dark floor → cool sky) with
   two crisp light strips (**key + fill**) for sparkle, a **Fresnel rim** that
   glows at grazing angles, a **cavity/AO** term (from the albedo's darkness)
   that deepens recesses, and a sharp `pow(dot(normal, halfVec), 60)` glint that
   tracks the cursor. This gives the full near-black → white range that reads as
   polished silver. Crucially it **replaces** the base colour instead of
   brightening it (that was the old washed-out bug). The albedo is therefore used
   twice: as the resting image *and* to drive the cavity shadows of the metal.
4. **Blend**: `finalColor = mix(baseColor, chrome, cursorAtten)` — matte plaster
   everywhere, melting into silver where the cursor is.

So the **normal map is the heart of the look**: its smoothness and depth decide
whether the metal looks like liquid chrome or flat foil. Iterate on step 2.

---

## 6. Test locally and deploy

Serve the folder over HTTP (modules/textures won't load over `file://`):

```bash
python -m http.server 8000
# open http://localhost:8000
```

Move the cursor over the image to reveal the metal. When happy, commit the
`image`, `normalMap`, and edited `index.html`, then push (GitHub Pages serves it
at the repo's Pages URL; allow ~1 min and hard-refresh).
