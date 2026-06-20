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
3. **Chrome colour** — a *fake studio reflection*: the reflected ray's vertical
   component `g` drives a tonal ramp (dark below → bright above) with a bright
   "horizon" sweep, plus a sharp `pow(dot(normal, halfVec), 40)` glint. This
   gives the full near-black → white range that reads as polished silver. Crucially
   it **replaces** the base colour instead of brightening it (that was the old
   washed-out bug).
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
