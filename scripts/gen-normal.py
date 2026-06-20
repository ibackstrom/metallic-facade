#!/usr/bin/env python3
"""
Generate a tangent-space normal map from a relief / bas-relief image.

The metallic effect fakes a 3D surface from a flat picture by reading a NORMAL
MAP. This script builds one by treating the image's brightness as a height field
and measuring its slope at two scales:

  * a BROAD blur  -> smooth, volumetric form  (the big silver gradients across
                     cheeks, necks, foreheads)
  * a FINE  blur  -> crisp relief detail       (hair, beards, ornaments)

Both are combined, converted to a normal vector per pixel, and written as an RGB
PNG (R=x, G=y, B=z, each mapped 0..255).

Usage:
    python scripts/gen-normal.py SRC.png  DST.png  [--broad 9] [--fine 1.5]
                                                    [--broad-w 28] [--fine-w 5]

Requires: numpy, Pillow   ->   pip install numpy Pillow
"""
import argparse
import numpy as np
from PIL import Image


def blur(a, sigma):
    """Separable float Gaussian blur (keeps full precision -> no banding)."""
    r = int(max(1, round(3 * sigma)))
    x = np.arange(-r, r + 1, dtype=np.float32)
    k = np.exp(-(x * x) / (2 * sigma * sigma))
    k /= k.sum()
    ap = np.pad(a, ((0, 0), (r, r)), mode="edge")
    tmp = np.zeros_like(a)
    for i, kv in enumerate(k):
        tmp += kv * ap[:, i:i + a.shape[1]]
    app = np.pad(tmp, ((r, r), (0, 0)), mode="edge")
    out = np.zeros_like(a)
    for i, kv in enumerate(k):
        out += kv * app[i:i + a.shape[0], :]
    return out


def grad(h):
    """Central-difference gradients (dx, dy) of a height field."""
    gx = np.zeros_like(h)
    gy = np.zeros_like(h)
    gx[:, 1:-1] = h[:, 2:] - h[:, :-2]
    gy[1:-1, :] = h[2:, :] - h[:-2, :]
    gx[:, 0] = h[:, 1] - h[:, 0]
    gx[:, -1] = h[:, -1] - h[:, -2]
    gy[0, :] = h[1, :] - h[0, :]
    gy[-1, :] = h[-1, :] - h[-2, :]
    return gx, gy


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("dst")
    ap.add_argument("--broad", type=float, default=9.0, help="broad blur sigma")
    ap.add_argument("--fine", type=float, default=1.5, help="fine blur sigma")
    ap.add_argument("--broad-w", type=float, default=28.0, help="broad weight")
    ap.add_argument("--fine-w", type=float, default=5.0, help="fine weight")
    args = ap.parse_args()

    img = Image.open(args.src).convert("RGB")
    lum = np.asarray(img.convert("L"), dtype=np.float32) / 255.0

    gx_b, gy_b = grad(blur(lum, args.broad))
    gx_f, gy_f = grad(blur(lum, args.fine))

    nx = -(gx_b * args.broad_w + gx_f * args.fine_w)
    ny = -(gy_b * args.broad_w + gy_f * args.fine_w)
    nz = np.ones_like(lum)

    length = np.sqrt(nx * nx + ny * ny + nz * nz)
    nx, ny, nz = nx / length, ny / length, nz / length

    rgb = np.stack([nx * 0.5 + 0.5, ny * 0.5 + 0.5, nz * 0.5 + 0.5], axis=-1)
    out = (np.clip(rgb, 0, 1) * 255).astype(np.uint8)
    Image.fromarray(out, "RGB").save(args.dst)
    print("wrote", args.dst, out.shape)


if __name__ == "__main__":
    main()
