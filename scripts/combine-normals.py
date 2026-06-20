#!/usr/bin/env python3
"""
Combine a FORM normal map (the subject's big 3D shape) with a DETAIL normal map
(a fine texture, e.g. a tiling pebble/hammered map) into one normal map.

This lets the subject keep its silhouette/volume while gaining a surface texture,
instead of the detail map flattening the form (a plain swap replaces the shape).

Blend used: UDN / partial-derivative — keep the form's Z, add the detail's
sideways slopes (scaled by --detail). Result is renormalized.

Usage:
    python scripts/combine-normals.py FORM.png DETAIL.jpg OUT.png \
        [--detail 0.6] [--tile 2.0]

  --detail  strength of the texture layer (0 = form only, 1 = full)
  --tile    how many times the detail map repeats across the width
            (keeps pebbles a sensible size instead of stretching one copy)

Requires: numpy, Pillow
"""
import argparse
import numpy as np
from PIL import Image


def load_normal(path):
    a = np.asarray(Image.open(path).convert("RGB"), dtype=np.float32) / 255.0
    return a * 2.0 - 1.0  # decode 0..1 -> -1..1


def tile_to(detail, h, w, tile):
    """Resize+tile the detail map so it repeats `tile` times across width."""
    dh, dw, _ = detail.shape
    cell_w = max(1, int(round(w / tile)))
    cell_h = max(1, int(round(cell_w * dh / dw)))   # keep detail's aspect
    cell = Image.fromarray(((detail * 0.5 + 0.5) * 255).astype(np.uint8))
    cell = cell.resize((cell_w, cell_h), Image.LANCZOS)
    cell = np.asarray(cell, dtype=np.float32) / 255.0 * 2.0 - 1.0
    ny = int(np.ceil(h / cell_h))
    nx = int(np.ceil(w / cell_w))
    tiled = np.tile(cell, (ny, nx, 1))[:h, :w, :]
    return tiled


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("form")
    ap.add_argument("detail")
    ap.add_argument("out")
    ap.add_argument("--detail", dest="strength", type=float, default=0.6,
                    help="strength of the texture layer (0=form only)")
    ap.add_argument("--tile", type=float, default=2.0)
    args = ap.parse_args()

    form = load_normal(args.form)
    h, w, _ = form.shape
    det = tile_to(load_normal(args.detail), h, w, args.tile)

    # UDN blend: keep form Z, add detail XY slopes.
    nx = form[..., 0] + det[..., 0] * args.strength
    ny = form[..., 1] + det[..., 1] * args.strength
    nz = form[..., 2]
    length = np.sqrt(nx * nx + ny * ny + nz * nz)
    nx, ny, nz = nx / length, ny / length, nz / length

    rgb = np.stack([nx * 0.5 + 0.5, ny * 0.5 + 0.5, nz * 0.5 + 0.5], axis=-1)
    out = (np.clip(rgb, 0, 1) * 255).astype(np.uint8)
    Image.fromarray(out, "RGB").save(args.out)
    print("wrote", args.out, out.shape)


if __name__ == "__main__":
    main()
