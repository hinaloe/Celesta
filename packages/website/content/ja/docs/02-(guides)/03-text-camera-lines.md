表示されていくタイトル、移動するカメラ、描かれていく線。前のページのヘルパーと同様にフレームに基づくので、スクラブと書き出しで各瞬間を再現できます。

## テキスト効果

**テキストのヘルパー**

| API | 用途 |
| --- | --- |
| `TextReveal` | 文字列の各行を、それぞれのマスクの裏から順にスライド表示します。`lineHeight`、`from`、`stagger`、`durationInFrames` を設定し、`align` で各行の横方向の揃え位置（0 左、0.5 中央、1 右）を指定します。 |
| `useTypewriter(text, options)` | 入力済みの `text`、その `length`、`done`、`caretVisible`。入力中は固定、停止中は点滅します。 |
| `useCountUp(to, options)` | `to` まで数える数値。`from`、`delay`、`durationInFrames`、`easing`、`decimals` で調整します。 |

```tsx title="タイトルを段階的に表示"
<TextReveal x={160} y={300} lineHeight={200} stagger={6}
  style={{ fontFamily: 'Archivo Black', fontSize: 210,
    fill: { type: 'solid', color: '#ecefe8' } }}>
  {'36 DAYS\nOF CELESTA'}
</TextReveal>
```

等幅フォントのカーソル位置は、`length × advance` を目安に計算できます。実際の文字の位置や幅を使う場合は、デスクトップの useTextMetrics() を利用してください。詳しくは「テキストとフォント」を参照してください。

## カメラ

`<Camera>` は大きなワールドの一部を映します。ワールドを独自の座標で配置し、`x` / `y`（中心に映す点）、`zoom`、`rotation` を動かします。`shake` は指定したピクセル数までの滑らかな手持ち風の揺れを加えます。

```tsx title="長いタイムラインに沿って移動"
<Camera x={interpolate(frame, [0, 120], [0, 4000], { extrapolateRight: 'clamp' })}
  y={540} zoom={1.1} shake={4}>
  <TimelineWorld />
</Camera>
```

## 線とグラフ

`<Line x1 y1 x2 y2>` は線分、`<Polyline points>` は複数の点を結びます。どちらも `stroke`、`strokeWidth`、`cap`（既定 `round`）、`join` を取ります。折れ線の `progress` を 0〜1 に動かすと線が描かれ、`pointOnPolyline(points, t)` で先端にマーカーを置けます。

ほかの形は `<Path>` に `points`（`closed` を指定）または SVG 風の `commands`（`moveTo`、`lineTo`、`quadTo`、`cubicTo`、`close`）、`stroke` や `fill`、`cap` / `join` / `miterLimit` を渡します。区間数によらず 1 レイヤーで、拡大しても鮮明です。半透明の線が交差しても重ね塗りされないので、生成する線画は多数の細い矩形より少数のパスで描いてください。

## 円・楕円・矢印

`<Circle radius>` と `<Ellipse width height>` は `Rect` と同じように配置します。`x` / `y` でボックスのアンカー（既定は左上）を置き、`fill` のグラデーションは左上を基準とし、`stroke` はボックス内に収まります。`<Arrow x1 y1 x2 y2>` は先端を `x2` / `y2` に向けます。`strokeWidth`、`headLength`、`headWidth`、`heads`（`end`、`start`、`both`）を指定できます。矢印が短いと頭も縮むので、長さ 0 から伸ばせます。長さ 0 では何も描きません。円は丸い `Rect`、ほかの 2 つはパスで描きます。いずれもグラデーション・変換・効果を使えます。

```tsx title="ラベル付きの注釈"
<Circle x={960} y={540} anchorX={0.5} anchorY={0.5} radius={80}
  stroke="#FFD84D" strokeWidth={8} />
<Arrow x1={600} y1={300} x2={890} y2={480} strokeWidth={6} stroke="#FFD84D" />
```

## 三角形・多角形・星・扇形・ハート

`<Polygon radius sides>`、`<Star radius points innerRatio>`、`<Pie radius startAngle endAngle>` は半径で大きさを決め、同じ半径の `<Circle>` と同じように配置します。`<Triangle width height apex>` と `<Heart width height>` は、`Rect` と同じように配置したボックスいっぱいに描きます。多角形の角と星の先端は 12 時の位置から始まります。扇形の角度は 12 時から時計回りの度数です。`endAngle` を `startAngle` からアニメーションすると扇形が開きます。2 つの角度が等しいと何も描かず、360° 離れると円になります。`cornerRadius` はハート以外の角を丸めます。どの図形も 1 つのパスで、`stroke` は円や楕円と違って輪郭の中心に描きます。`<Path>` と同じく `join` / `miterLimit` も指定できます。

`trianglePath`、`polygonPath`、`starPath`、`piePath`、`heartPath` は、同じ形のパスコマンドをボックスの左上を原点として返します。そのまま `<Path>` に渡すことも、変形してから渡すこともできます。

```tsx title="開いていく円グラフ"
<Pie x={760} y={340} radius={200} endAngle={interpolate(frame, [0, 45], [0, 270], { extrapolateRight: 'clamp' })}
  fill="#4DD8C0" />
<Star x={1200} y={340} radius={120} points={5} innerRatio={0.45} cornerRadius={8} fill="#FFD84D" />
<Path x={1200} y={640} commands={starPath({ radius: 120, points: 5 })} stroke="#FFFFFF" strokeWidth={4} />
```
