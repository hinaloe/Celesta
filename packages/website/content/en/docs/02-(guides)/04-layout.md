## Coordinates and anchors

The canvas origin is the top-left corner, measured in pixels. A layer’s `x` and `y` place its **anchor**, which is the top-left corner by default. Set `anchorX` and `anchorY` between 0 and 1 to move it: `0.5` is the center and `1` the right or bottom edge. Rotation (in degrees) and scale turn around the anchor too.

```tsx title="Centered, rotated, and scaled"
<Rect x={960} y={540} anchorX={0.5} anchorY={0.5}
  width={400} height={400} cornerRadius={48}
  rotation={12} scale={0.8} opacity={0.9} fill="#a68bbf" />
```

`scaleX` and `scaleY` override `scale` on one axis. `opacity` multiplies down through groups. A `Group` below 1 fades its children together as one picture, as CSS `opacity` does, so overlapping children do not show through one another.

## Skew and 3D

Every layer and `Group` can lean and turn in depth, as CSS transforms do:

| Prop | Meaning |
| --- | --- |
| `skewX`, `skewY` | Shear in degrees, as CSS `skew()`. `skewX` slants vertical edges, `skewY` horizontal ones. |
| `rotationX`, `rotationY` | Turn in degrees about the horizontal and vertical axes, as CSS `rotateX()` and `rotateY()`. Positive `rotationY` turns the right edge away; positive `rotationX` tilts the top edge away. |
| `perspective` | The viewing distance in pixels for the layer’s own 3D rotation, as CSS `perspective()`. Smaller values look more dramatic. Without it (or when it is not positive) the rotation is orthographic and parallel edges stay parallel. |
| `backfaceVisibility` | `"visible"` (the default) or `"hidden"`, which skips the layer, and for a group everything in it, while its back faces the viewer. |

The transforms apply in this order, from the layer outward: `scale`, skew, `rotation`, `rotationY`, `rotationX`, `perspective`, then `x`/`y`. As with `rotation` and `scale`, everything turns about the anchor. A `Group` has no size, so it turns about its own origin. The vanishing point of a `perspective` is that same pivot, so a layer recedes toward its anchor, not toward the center of the canvas.

Skew and 3D rotation without a perspective only reshape the layer, so they cost no more than a non-uniform scale. A layer with both `perspective` and a 3D rotation is drawn through its own picture, which is then projected onto its parent. The picture is made at the sharpness of its nearest, most magnified part, so text and paths stay crisp up close, and the far side is filtered as it shrinks, without shimmer. Because it is a picture of its own, a group with a `perspective` is isolated: its children’s `blendMode`s mix only with each other, as in CSS.

Children are flattened into their parent’s plane, as CSS `transform-style: flat` does. A turned group’s children are not sorted by depth: they draw in the order they are written, each in the plane of the group. To make a card with two faces, put each face in its own group and hide the one that faces away. Whether a layer faces away follows the turns of all its parents: a face inside a group turned 180 degrees is hidden until the card has turned over. A mirror (`scaleX={-1}`) does not turn a layer away. A layer exactly edge-on counts as facing the viewer but draws nothing.

```tsx title="A card that turns over"
<Group x={960} y={540} rotationY={frame * 4} perspective={1400}>
  <Group backfaceVisibility="hidden">
    <Rect x={-170} y={-235} width={340} height={470} cornerRadius={28} fill="#f4efe6" />
    <Text anchorX={0.5} anchorY={0.5} style={{ fontSize: 64, align: 'center' }}>Front</Text>
  </Group>
  <Group rotationY={180} backfaceVisibility="hidden">
    <Rect x={-170} y={-235} width={340} height={470} cornerRadius={28} fill="#1d3557" />
    <Text anchorX={0.5} anchorY={0.5} style={{ fontSize: 64, align: 'center' }}>Back</Text>
  </Group>
</Group>
```

Effects on a layer with a `perspective` and a 3D rotation (`blur`, `shadow`, `glow`, and the color and stylize filters) apply after the projection, in output pixels, as they do after any other transform. Effects on layers inside it are measured in output pixels too, so a blur does not change size as the layer turns. Custom `shader`s and the built-in filters on those inner layers run in the layer’s own picture instead, so their pixels are the picture’s pixels, which shrink with the projection on the far side. Pointer hit tests follow the projected shape.

The CPU reference renderer does not draw skew, `rotationX`, or `rotationY` and refuses a scene that uses them, as it does for `rotation`. Preview, export, and the browser editor draw them. See `examples/with-3d-transform.tsx` for a card flip, leaning cards, and a tilted floor of tiles.

## Shapes

`Rect` draws a rectangle with an optional `cornerRadius`, `fill`, and inner `stroke` with `strokeWidth`. Colors are hex strings, with an optional alpha channel: `#RRGGBB` or `#RRGGBBAA`. A square with a corner radius of half its size makes a circle.

## Blur, shadows, and glow

Visual layers and groups accept blur, shadow, and glow, which can change every frame. Blur radii (up to 64 pixels) and shadow offsets use output pixels. Group effects apply to the combined children.

```tsx title="A glowing title with a shadow"
<Group glow={{ color: "#FFCC6680", blur: 12 }}>
  <Text style={{ fontSize: 96 }}
    shadow={{ color: "#000000B0", blur: 6, offsetX: 4, offsetY: 6 }}>
    Celesta
  </Text>
</Group>
```

## Color correction

Visual layers and groups also take color filters, which can change every frame: `brightness`, `contrast`, and `saturation` (1 keeps the color), `hue` (degrees to rotate the hue), `grayscale` and `invert` (0 to 1), `tint` (a color laid over the pixels, `{ color, amount }`), and `vignette` (0 to 1, or `{ amount, radius, softness }`; it darkens toward the edges of the layer’s box). Each works on the straight sRGB color, keeps alpha, and clamps its result, as CSS `filter` functions do. They apply after `shader`, in the order listed here, and before blur, shadow, and glow; the stylize effects below go around them. They run in preview, export, and the browser editor.

```tsx title="An old photograph"
<Image src="street.jpg" grayscale={1} tint={{ color: "#704214", amount: 0.35 }}
  contrast={1.1} vignette={0.6} />
```

To apply them in another order, or between custom shaders, pass their functions from `@celesta/shader` to `shader` as an array: `shader={[ripple({ time }), grayscale(), vignette(0.6)]}`.

## Stylize effects

Visual layers and groups also take built-in stylize effects, whose values can change every frame. Sizes and distances are output pixels, angles degrees, and grids and centres follow the layer’s box.

- `pixelate` averages square cells. A number is the cells’ size.
- `halftone` draws a dot of each cell’s color whose area follows the cell’s brightness, transparent between the dots. A number is the grid’s size; `{ size, angle }` turns the grid (45 by default).
- `chromaticAberration` moves red and blue apart. A number is the offset; `{ offset, angle }` gives its direction.
- `wave` sways the pixels along a sine: `{ amplitude, wavelength, phase, angle }`. Animate `phase` to make it travel.
- `noise` adds grain, 0 to 1, or `{ amount, seed, monochrome }`. Without a `seed` the grain changes every frame, following the layer’s `useCurrentFrame()`, yet a frame always renders the same; give a `seed` to hold it still.
- `scanlines` darkens horizontal bands, 0 to 1, or `{ amount, spacing, thickness, offset }`.
- `zoomBlur` blurs toward a centre as a fast zoom would, 0 to 1, or `{ amount, centerX, centerY }`.

The props apply in this order: `chromaKey`, `pixelate`, `wave`, `zoomBlur`, `chromaticAberration`, the color filters, `halftone`, `noise`, then `scanlines`; all after `shader` and before blur, shadow, and glow. `@celesta/shader` exports functions of the same names for the `shader` array, for another order. They run in preview, export, and the browser editor.

```tsx title="A worn videotape"
<Group chromaticAberration={3} noise={0.12} scanlines={{ amount: 0.4, offset: frame / 4 }}>
  …
</Group>
```

## Chroma key

`chromaKey` makes the colors near a key color transparent, to composite green-screen footage from a `<Video>` or an `<Image>` (or any other layer). A string is the key color; `{ color, tolerance, softness, spill }` tunes it:

- `tolerance` (0.2 by default): how near a color’s chroma (its BT.709 CbCr) must be to the key’s to become transparent. Brightness does not count, so the screen’s shadows key with the rest of it.
- `softness` (0.1): how far beyond `tolerance` colors fade back in, which softens the edges.
- `spill` (0.5), 0 to 1: how much of the key’s color cast to take out of what remains, keeping its brightness.

Neutral colors lie as far from the key as the key’s own chroma: 0.36 for `#00b140`, 0.60 for `#00ff00`. Keep `tolerance + softness` below that, or grays turn translucent too. The values can change every frame. `examples/greenscreen` keys footage Celesta draws itself.

```tsx title="Key a green screen"
<Video src="presenter.mp4" chromaKey={{ color: "#00b140", spill: 0.8 }} />
```

## Custom shaders

`defineShader` from `@celesta/shader` defines a filter in WGSL. Write `fn effect(input: EffectInput) -> vec4f`, which returns each output pixel as premultiplied RGBA. Read the layer with `source_at(position)` (scene pixels, interpolated) or `source_load(pixel)`; `input.uv` is the pixel’s place in the layer’s box, from 0,0 to 1,1, and `celesta` holds the scene size and that box. Declare parameters with `params` and pass their values with every use; time is a parameter too, so a shader follows sequences and freeze frames. Pass the result to any layer’s `shader` prop. Pass an array, such as `shader={[ripple({ time }), rgbSplit({ amount: 6 })]}`, to apply several shaders in order, each filtering the result of the one before; every shader sees the same layer box, and their paddings add up. The shader runs before the color filter props, blur, shadow, and glow, and writes only the layer’s box plus its `padding`. Import a `.wgsl` file as the source to edit it with highlighting; saving it reloads the preview. Shaders run in preview and export, not in the browser editor.

```tsx title="A rippling title"
import { defineShader } from '@celesta/shader';

const ripple = defineShader({
  name: 'ripple',
  wgsl: `fn effect(input: EffectInput) -> vec4f {
    let center = mix(celesta.content.xy, celesta.content.zw, vec2f(0.5));
    let offset = input.position - center;
    let wave = sin(length(offset) * 0.06 - params.time * 6.0) * params.amplitude;
    let direction = offset / max(length(offset), 1e-4);
    return source_at(input.position - direction * wave);
  }`,
  params: { time: 'f32', amplitude: { type: 'f32', default: 6 } },
  padding: 8,
});

<Text style={{ fontSize: 120 }} shader={ripple({ time: frame / fps })}>
  Celesta
</Text>
```

## Blend modes

Set `blendMode` on any layer to change how it combines with what is beneath it, as CSS `mix-blend-mode` does: `normal` (the default), `multiply`, `screen`, `overlay`, `add`, `difference`, `darken`, `lighten`, `colorDodge`, `colorBurn`, `hardLight`, `softLight`, `exclusion`, `hue`, `saturation`, `color`, or `luminosity`. They follow the W3C Compositing and Blending formulas; two-word names are camelCase (`colorDodge`, not CSS's `color-dodge`). On a `Group`, any mode other than `normal` draws the children together first, then blends the result as one layer.

```tsx title="A HUD that stays readable on light and dark scenes"
<Group blendMode="difference" opacity={0.8}>
  <Text x={48} y={48} style={{ fill: { type: 'solid', color: '#ffffff' } }}>
    REC 00:00:12
  </Text>
</Group>
```

## Group and arrange

`Group` has no size of its own. Its children are placed relative to its `x`/`y`, and its rotation, scale, and opacity apply to all of them. The layout helpers build on it:

**Layout helpers**

| API | Use it for |
| --- | --- |
| `Center` | Moves the origin to the center of the canvas or the enclosing `SafeArea`. |
| `SafeArea` | Insets its children by `padding` (a number, `{ top, right, bottom, left }`, or the `'vertical-social'` preset) and shrinks the area nested helpers see. |
| `Stack` | Places each child `spacing` pixels apart, `vertical` by default or `horizontal`. |
| `Grid` | Places children into `columns` of `columnWidth` × `rowHeight` cells, with optional gaps. |
| `Fit` | Scales content designed at `sourceWidth` × `sourceHeight` to `contain` or `cover` the current area. |

```tsx title="A centered list inside a safe margin"
<SafeArea padding={96}>
  <Center>
    <Stack spacing={96} y={-96}>
      {['Write', 'Preview', 'Export'].map((step) => (
        <Text key={step} anchorX={0.5} anchorY={0.5}
          style={{ fontSize: 64, fill: { type: 'solid', color: '#332f3b' } }}>
          {step}
        </Text>
      ))}
    </Stack>
  </Center>
</SafeArea>
```

Helpers position child origins; they do not measure what the children draw. Anchor children at `0.5` when you want them centered on those points.

## Vertical video for Shorts, TikTok, and Reels

Use a 1080×1920 canvas. The players draw their own UI over the video: the caption, channel name, and progress bar cover about the bottom 20%, and the like, comment, and share buttons run down the right edge. Keep everything meant to be read (headlines, subtitles, logos, calls to action) inside `<SafeArea>`, and let backgrounds, footage, and decoration run to the edges. The `'vertical-social'` preset keeps top 10%, right 18.5%, bottom 20%, and left 1/15 of the canvas clear (top 192, right 200, bottom 384, left 72 px at 1080×1920). It is a rough guide, not a platform specification, and does not follow changes to the platforms' UI; pass `{ top, right, bottom, left }` when you know better.

```tsx title="Copy inside the platform safe area, background to the edges"
<Composition width={1080} height={1920} fps={30} durationInFrames={300}>
  <Image src="./bg.jpg" width={1080} height={1920} />
  <SafeArea padding="vertical-social">
    <Center>
      <Text anchorX={0.5} anchorY={0.5} maxWidth={760}
        style={{ fontSize: 96, align: 'center' }}>
        Readable copy
      </Text>
    </Center>
  </SafeArea>
  <DebugOverlay safeArea="vertical-social" />
</Composition>
```

To check, give `<DebugOverlay>` the same safe area and export PNG frames or a contact sheet with `--debug-guides` (see [Export](/en/docs/export/)). The area the UI covers is shaded; every line of text must stay inside the outline, including while it moves.

## Clip a group

Give a `Group` a `clip` to draw its children only inside a rectangle, `{ x, y, width, height, cornerRadius }`, in the group’s own coordinates. Use it for a mask reveal, a wipe, or content that scrolls inside a panel. The clip moves, scales, and rotates with the group, its edge is anti-aliased, and clips nested inside one another intersect.

```tsx title="Text sliding up from behind an edge"
<Group x={120} y={200} clip={{ width: 720, height: 96 }}>
  <Text y={96 * (1 - reveal)}
    style={{ fontSize: 88, fill: { type: 'solid', color: '#332f3b' } }}>
    Layer it.
  </Text>
</Group>
```

## Mask a group

Give a `Group` a `mask` to show its children only where another drawing is: text, a path, an image, or a whole subtree, in the group’s own coordinates. The mask is never shown itself. Wrap it in `<Mask mode="luminance" invert>` to use its brightness instead of its alpha, or to show the children where the mask is not drawn. A masked group is isolated, so its children’s blend modes mix only with each other, and its blur, shadow, and glow follow the cut-out shape. Masks draw the same in preview, export, and the browser editor.

```tsx title="Stripes inside letters"
<Group mask={
  <Text x={960} y={540} anchorX={0.5} anchorY={0.5}
    style={{ fontSize: 360, fontWeight: 900 }}>
    CELESTA
  </Text>
}>
  <Stripes />
</Group>
```
