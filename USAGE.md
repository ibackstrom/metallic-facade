# Usage

Interactive effect: a white relief image that the cursor "paints" into polished
metal. Painted areas linger, then fade back to white.

## Run locally

The page uses ES modules and loads images, so it must be served over HTTP — not
opened as a `file://` URL (that shows a blank page).

```
python -m http.server 8000
```

Then open http://localhost:8000/.

VS Code alternative: install the **Live Server** extension, right-click
`index.html` → **Open with Live Server**.

## Use it

Move the cursor over the image. It reveals the metal under the brush and leaves a
trail that fades. Move fast to cover more before earlier strokes fade out.

## Configure

All options are passed in `index.html` where `MetallicFacade` is created. Values
set there override the defaults in `metallic-facade.js`. Change a value, save,
refresh the browser.

```js
new MetallicFacade(document.getElementById('stage'), {
  image: 'relief.png',
  normalMap: 'relief-normal.png',
  roughnessMap: 'relief-rough.png',
  dispMap: 'relief-disp.png',
  metallic: 0.95,
  lightRadius: 0.4,
  specular: 1.3,
});
```

### Parameters

| Option           | Default | What it does |
|------------------|---------|--------------|
| `image`          | —       | Base picture (the white relief). |
| `normalMap`      | auto    | Surface bumps. Auto-generated from `image` if omitted. |
| `roughnessMap`   | —       | r channel: 0 = mirror, 1 = matte. |
| `dispMap`        | —       | r channel: 0 = recess, 1 = raised. |
| `lightRadius`    | 1.5     | **Brush size.** Bigger = wider stroke. |
| `paintFade`      | 0.4     | **Fade speed.** Painted area clears in ~`1/paintFade` seconds. Lower = lingers longer. |
| `brushStrength`  | 1.0     | How solid each stroke is (0–1). |
| `feather`        | 0.7     | Brush edge softness. 0 = hard edge, 1 = soft. |
| `metallic`       | 0.85    | 0 = matte, 1 = full chrome. |
| `metalContrast`  | 1.5     | Contrast inside the metal. 1 = none. |
| `specular`       | 1.1     | Strength of the cursor highlight on the metal. |
| `lightIntensity` | 0.4     | How much the metal shading reacts to cursor position. |
| `lightColor`     | white   | `[r, g, b]`, each 0–1. |

## Replace the image

Swap `relief.png` (and ideally provide matching `*-normal/-rough/-disp` maps for
the best look). Without helper maps a normal map is generated automatically; the
result is flatter. See `TEXTURES.md`.
