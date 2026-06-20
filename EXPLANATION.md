# How it works — in simple words

We take a normal, flat picture (here: stone tiles) and make it look like shiny
metal **wherever you move the mouse**. Here is the whole idea, step by step.

---

## 1. We start with a flat picture

It's just an image on the screen. Flat, like a photo on a wall. Nothing shines
yet.

## 2. We tell the computer where the bumps are

Your eyes can see the tiles have raised parts and dips. The computer can't — to
it the picture is flat. So we give it a second, helper image called a **normal
map** (the bluish-purple one).

For every tiny spot it says: "this part faces up", "this part faces sideways",
"this part is a dent". Now the computer knows the shape, even though the picture
is still flat.

## 3. We put a light at the mouse

Where your cursor is, we switch on a small **light**. It shines on the bumps from
step 2:

- bumps facing the light → **bright** ✨
- dents → fall into **shadow** 🌑

Bright highlights on bumps + dark shadows in dents = our brain says **"that's
metal!"** That's why the tiles turn silver.

## 4. Two extra helper images make it nicer

- **Roughness map** — says where the metal is glossy like a mirror and where it's
  dull like a spoon. Real metal has both.
- **Displacement (height) map** — says where tiles are high and where the cracks
  are deep. We darken the deep cracks so everything looks 3D.

## 5. It fades smoothly

When you move the mouse in, the silver **eases in** like it's being poured on.
When you move away, it **eases back** to plain stone. Smooth, not sudden.

---

## The pieces

| Piece | Job |
|-------|-----|
| Picture (color) | what you see when nothing shines |
| Normal map | the secret "where are the bumps" map |
| Light at the cursor | turns on the shine where the mouse is |
| Roughness map | makes metal mirror-like or dull |
| Height map | hides shadow in cracks, adds depth |

---

## The one big idea

> The picture is flat. But with a **bump map** and a **light that follows the
> mouse**, the computer fools your eyes — and the flat picture looks like real
> shiny metal.
