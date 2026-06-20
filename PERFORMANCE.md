# Performance & architecture

This documents how the metallic effect is built and **why it is cheap to run**.
Everything lives in one file, [`metallic-facade.js`](metallic-facade.js), and
runs almost entirely on the GPU.

---

## Design goals

1. **Zero dependencies** — no Three.js, no build step. One ES module.
2. **One GPU pass** — the whole look is a single fragment shader; no
   post-processing, no render targets.
3. **Tiny CPU work per frame** — the CPU only nudges a few numbers; the GPU does
   the per-pixel maths.
4. **Instant first paint** — renders immediately with placeholders, then swaps in
   textures as they load.

---

## Runtime data flow

```diagram
 once (setup)                          every frame (~16.6 ms @ 60 Hz)
╭──────────────────────────╮         ╭───────────────────────────────────╮
│ compile shaders          │         │ ease cursor + hover toward target │
│ upload 1×1 placeholders  │         │ set ~15 uniforms (cheap)          │
│ async-load textures      │ ──────▶ │ bind 4 textures                   │
│ build geometry (3 verts) │         │ 1 × drawArrays(TRIANGLES, 0, 3)   │
╰──────────────────────────╯         ╰───────────────────────────────────╯
                                                     │
                                            GPU fragment shader
                                       (runs once per on-screen pixel)
```

---

## Why it's fast

### 1. A single full-screen triangle — one draw call
The geometry is **three vertices** that form one oversized triangle covering the
whole canvas:

```js
new Float32Array([-1, -1, 3, -1, -1, 3])   // 1 triangle, clipped to the screen
...
gl.drawArrays(gl.TRIANGLES, 0, 3);         // exactly one draw call per frame
```

This is the standard fullscreen trick. A single triangle (vs. two for a quad)
means no diagonal seam and slightly better GPU rasterizer cache behaviour. Vertex
processing is effectively free (3 vertices).

### 2. All the work is one fragment shader
There are no extra passes, framebuffers, or blits. The cost is simply:

> **fragments processed ≈ canvas width × height × DPR²**

and each fragment does a small fixed amount of maths plus **4 texture fetches**
(color, normal, roughness, height). That's it.

### 3. Procedural reflections — no environment texture
The "chrome" is a *mathematical* studio environment (a tonal ramp + two light
bands + Fresnel) computed from the reflection vector. There is **no cubemap or
HDRI to download, store, or sample**, which saves memory bandwidth and VRAM and
removes a big asset from the network.

### 4. Device-pixel-ratio capped at 2
```js
const dpr = Math.min(window.devicePixelRatio || 1, 2);
```
On phones/retina screens DPR can be 3–4. Since cost grows with DPR **squared**,
capping at 2 can cut fragment work by ~4× on a DPR-4 screen with no visible
quality loss.

### 5. Minimal texture state
Textures use `LINEAR` filtering, `CLAMP_TO_EDGE`, and **no mipmaps**
(`generateMipmap` is never called). For a screen-filling image shown roughly 1:1
mipmaps aren't needed, so we skip the extra memory (~33%) and generation cost.

### 6. Instant first paint with placeholders
Each texture starts as a **1×1 pixel** placeholder, so the canvas renders on
frame one. Real textures load asynchronously (`new Image()`) and are swapped in
on their `onload` — the page never blocks on the network.

### 7. Frame-rate-independent animation
The fade/cursor easing uses exponential smoothing tied to real elapsed time:

```js
const k = 1 - Math.exp(-fadeSpeed * dt);
```

So it looks identical at 30, 60, or 144 Hz and never "speeds up" on fast
displays — no per-frame constant that assumes 60 fps.

### 8. WebGL2 with a WebGL1 fallback
It prefers WebGL2 but auto-generates a WebGL1 version of the shader, so it runs on
old hardware without shipping two hand-written shaders.

---

## Cost breakdown

| Resource | Cost |
|----------|------|
| Draw calls / frame | **1** |
| Vertices / frame | **3** |
| Shader passes | **1** (no post-processing) |
| Texture fetches / fragment | **4** |
| Uniform updates / frame | ~15 scalars/vectors (negligible) |
| CPU / frame | a few multiplies for easing + uniform uploads |
| Network | the module (~a few KB) + your texture files |
| VRAM | the 4 textures (no mipmaps, no env map) |

In practice the effect is **GPU-fragment-bound**: the only thing that meaningfully
changes the cost is the canvas size × DPR. Keep the stage reasonably sized and it
holds 60 fps comfortably, even on integrated GPUs.

---

## Asset-side optimizations

- **Normal maps are prepared offline** ([`scripts/gen-normal.py`](scripts/gen-normal.py))
  so the browser doesn't compute them. (A runtime Sobel fallback exists for
  convenience, but a baked map is faster and higher quality.)
- **Right-size your textures.** 1K (1024²) is plenty for most stages; use 2K only
  for very large displays. Texture size drives VRAM and upload time, not frame
  cost.
- **Reuse one normal for several scales** — it's just a texture; resolution of the
  *display*, not the texture, sets the per-frame cost.

---

## Honest trade-offs (and easy wins if you need them)

The component favours simplicity. If you are squeezing a very constrained device,
these are the levers (not currently applied):

- **Render-on-demand.** The loop runs continuously so fades stay smooth. You could
  pause `requestAnimationFrame` once `hover` and `cursor` have settled and resume
  on pointer events — near-zero cost while idle.
- **Pause when off-screen.** Wrap init / the loop in an `IntersectionObserver` so
  it doesn't render while scrolled out of view.
- **Compressed textures.** Shipping KTX2 / Basis instead of PNG/JPEG cuts download
  size and VRAM further (at the cost of a transcoder).
- **`willReadFrequently`** on the canvas used by the runtime normal generator
  would speed up that one-time read on some browsers (irrelevant if you supply a
  baked normal map).
- **Lower the DPR cap to 1** on low-end devices for another ~4× fragment saving.

None of these are required for typical use — the default path is already a single
cheap draw call per frame.
