# Adding the metallic effect to an existing project

The effect is **one self-contained ES module** ([`metallic-facade.js`](metallic-facade.js))
with **no dependencies**. You give it a container element and a few texture URLs.

```js
import MetallicFacade from './metallic-facade.js';
const fx = new MetallicFacade(containerEl, { image: 'relief.png' });
// later, when removing it:
fx.destroy();
```

---

## 1. Copy the files

Copy into your project (e.g. a `public/metallic/` folder):

- `metallic-facade.js` — the component
- your textures — at minimum a base **image**; ideally also a **normal map**
  (see [TEXTURES.md](TEXTURES.md) for how to make/convert them)

That's it — there is nothing to `npm install`.

---

## 2. Plain HTML / no build step

```html
<div id="metal" style="width: 520px; height: 520px;"></div>

<script type="module">
  import MetallicFacade from './metallic/metallic-facade.js';
  new MetallicFacade(document.getElementById('metal'), {
    image:        './metallic/relief.png',
    normalMap:    './metallic/relief-normal.png',
    roughnessMap: './metallic/relief-rough.png', // optional
    dispMap:      './metallic/relief-disp.png',  // optional
  });
</script>
```

The container **must have a size** (width + height, or an `aspect-ratio`). The
canvas fills it. Move the cursor over it to reveal the metal.

---

## 3. With a bundler (Vite / webpack / Rollup)

Put `metallic-facade.js` in your source tree and import it normally:

```js
import MetallicFacade from '@/lib/metallic-facade.js';
```

Reference textures from your static/`public` folder (or import them so the
bundler fingerprints them):

```js
import img from './assets/relief.png';
import nor from './assets/relief-normal.png';
new MetallicFacade(el, { image: img, normalMap: nor });
```

---

## 4. React

```jsx
import { useEffect, useRef } from 'react';
import MetallicFacade from './metallic-facade.js';

export function Metal() {
  const ref = useRef(null);
  useEffect(() => {
    const fx = new MetallicFacade(ref.current, {
      image: '/metallic/relief.png',
      normalMap: '/metallic/relief-normal.png',
    });
    return () => fx.destroy();          // cleanup on unmount
  }, []);
  return <div ref={ref} style={{ width: 520, height: 520 }} />;
}
```

## 5. Vue 3

```vue
<script setup>
import { onMounted, onUnmounted, ref } from 'vue';
import MetallicFacade from './metallic-facade.js';
const el = ref(null); let fx;
onMounted(() => { fx = new MetallicFacade(el.value, { image: '/metallic/relief.png' }); });
onUnmounted(() => fx?.destroy());
</script>
<template><div ref="el" style="width:520px;height:520px"></div></template>
```

## 6. Svelte

```svelte
<script>
  import { onMount } from 'svelte';
  import MetallicFacade from './metallic-facade.js';
  let el, fx;
  onMount(() => { fx = new MetallicFacade(el, { image: '/metallic/relief.png' }); return () => fx.destroy(); });
</script>
<div bind:this={el} style="width:520px;height:520px"></div>
```

---

## Options

All options are listed in [TEXTURES.md → Options reference](TEXTURES.md#4-options-reference-metallic-facadejs).
The common ones: `image` (required), `normalMap`, `roughnessMap`, `dispMap`,
`metallic`, `lightRadius`, `specular`, `lightColor`, `fadeSpeed`.

## API

| Member | What it does |
|--------|--------------|
| `new MetallicFacade(container, options)` | Creates the canvas inside `container` and starts rendering. |
| `.destroy()` | Stops the loop, removes listeners, removes the canvas. Call on unmount. |

---

## Gotchas

- **Serve over HTTP**, not `file://` — ES modules and textures won't load otherwise
  (`python -m http.server`, or your dev server).
- **Sized container** — if the box has no height you'll see nothing. Use fixed
  px, or `aspect-ratio` matching your image so it isn't stretched.
- **Cross-origin textures** — images are requested with `crossOrigin="anonymous"`.
  If you host textures on another domain, that server must send
  `Access-Control-Allow-Origin`. Same-origin assets are simplest.
- **Auto-generated normals need same-origin** — when you omit `normalMap`, the
  normal is built on a `<canvas>`, which taints on cross-origin images. Provide a
  `normalMap` file (or host the image same-origin).
- **Touch devices** have no hover; the effect responds to pointer movement /
  taps.
