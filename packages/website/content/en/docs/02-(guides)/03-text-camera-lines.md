Titles that reveal themselves, a camera that travels, and lines that draw on. Like the helpers on the previous page, these are built on the frame, so scrubbing and exporting reproduce every moment.

## Text effects

**Text helpers**

| API | Use it for |
| --- | --- |
| `TextReveal` | Lines of a string slide up from behind their own masks, one after another. Set `lineHeight`, `from`, `stagger`, and `durationInFrames`; `align` pivots each line. |
| `useTypewriter(text, options)` | The typed-so-far `text`, its `length`, `done`, and `caretVisible`: steady while typing, blinking while idle. |
| `useCountUp(to, options)` | A number counting to `to`, with `from`, `delay`, `durationInFrames`, `easing`, and `decimals`. |

```tsx title="An editorial title reveal"
<TextReveal x={160} y={300} lineHeight={200} stagger={6}
  style={{ fontFamily: 'Archivo Black', fontSize: 210,
    fill: { type: 'solid', color: '#ecefe8' } }}>
  {'36 DAYS\nOF CELESTA'}
</TextReveal>
```

For a quick monospaced caret, use `length × advance` as an estimate. For actual glyph positions, use useTextMetrics() in the desktop runtime; see Text & fonts.

## Camera

`<Camera>` looks at a point of a larger world: lay the world out in its own coordinates, then animate `x`/`y` (the point shown at the center), `zoom`, and `rotation`. `shake` adds a smooth handheld drift of up to that many pixels.

```tsx title="Travel along a long timeline"
<Camera x={interpolate(frame, [0, 120], [0, 4000], { extrapolateRight: 'clamp' })}
  y={540} zoom={1.1} shake={4}>
  <TimelineWorld />
</Camera>
```

## Lines and charts

`<Line x1 y1 x2 y2>` draws a segment and `<Polyline points>` connects several; both take `stroke`, `strokeWidth`, `cap` (`round` by default), and `join`. Animate a polyline’s `progress` from 0 to 1 to draw it on, and use `pointOnPolyline(points, t)` to put a marker on its tip.

For other shapes, `<Path>` takes `points` (with `closed`) or SVG-like `commands` (`moveTo`, `lineTo`, `quadTo`, `cubicTo`, `close`), a `stroke` and/or `fill`, and `cap`/`join`/`miterLimit`. Each is one layer however many segments it has, stays sharp when scaled, and paints a translucent stroke that crosses itself only once, so draw procedural line art as a few paths rather than many thin rects.

## Circles, ellipses, and arrows

`<Circle radius>` and `<Ellipse width height>` are placed like a `Rect`: `x`/`y` put their box’s anchor (top-left by default), `fill` gradients start from the box’s top-left, and a `stroke` stays inside the box. `<Arrow x1 y1 x2 y2>` points its head’s tip at `x2`/`y2`; set `strokeWidth`, `headLength`, `headWidth`, and `heads` (`end`, `start`, or `both`). An arrow shorter than its heads shrinks them to fit, so it can grow from nothing, and one with no length draws nothing. A circle is drawn as a rounded `Rect` and the other two as paths; all three take gradients, transforms, and effects like any layer.

```tsx title="A labelled callout"
<Circle x={960} y={540} anchorX={0.5} anchorY={0.5} radius={80}
  stroke="#FFD84D" strokeWidth={8} />
<Arrow x1={600} y1={300} x2={890} y2={480} strokeWidth={6} stroke="#FFD84D" />
```

## Triangles, polygons, stars, pies, and hearts

`<Polygon radius sides>`, `<Star radius points innerRatio>`, and `<Pie radius startAngle endAngle>` are sized by a radius and placed like a `<Circle>` of that radius; `<Triangle width height apex>` and `<Heart width height>` fill a box placed like a `Rect`. Polygon corners and star tips start at 12 o’clock, and pie angles are degrees clockwise from 12 o’clock, so animate `endAngle` from `startAngle` to sweep a slice open: equal angles draw nothing, and 360° apart a whole circle. `cornerRadius` rounds the corners of every shape but the heart. Each shape is one path whose `stroke` is centred on the outline, unlike a circle’s or an ellipse’s, and takes `join`/`miterLimit` like a `<Path>`; `cap` only shapes the ends of dashes, since the outline is closed.

`trianglePath`, `polygonPath`, `starPath`, `piePath`, and `heartPath` return the same path commands, measured from the box’s top-left, to pass to a `<Path>` or to reshape first.

```tsx title="A pie chart that sweeps open"
<Pie x={760} y={340} radius={200} endAngle={interpolate(frame, [0, 45], [0, 270], { extrapolateRight: 'clamp' })}
  fill="#4DD8C0" />
<Star x={1200} y={340} radius={120} points={5} innerRatio={0.45} cornerRadius={8} fill="#FFD84D" />
<Path x={1200} y={640} commands={starPath({ radius: 120, points: 5 })} stroke="#FFFFFF" strokeWidth={4} />
```
