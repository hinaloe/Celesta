## 座標とアンカー

キャンバスの原点は左上で、単位はピクセルです。レイヤーの `x` と `y` は**アンカー**を配置し、既定のアンカーは左上です。`anchorX` と `anchorY` を 0〜1 に設定して移動できます。`0.5` が中心、`1` が右端または下端です。回転（度）と拡縮もアンカーを中心に行います。

```tsx title="中央揃え・回転・拡縮"
<Rect x={960} y={540} anchorX={0.5} anchorY={0.5}
  width={400} height={400} cornerRadius={48}
  rotation={12} scale={0.8} opacity={0.9} fill="#a68bbf" />
```

`scaleX` と `scaleY` は各軸の `scale` を上書きします。`opacity` はグループを通じて乗算されます。

## 図形

`Rect` は矩形を描き、任意の `cornerRadius`、`fill`、内側の `stroke` と `strokeWidth` を指定できます。色は `#RRGGBB` や `#RRGGBBAA` のような、アルファを付けられる 16 進文字列です。正方形の角丸を辺の半分にすると円になります。

## ぼかし・影・光彩

映像のレイヤーや Group に blur、shadow、glow を指定できます。値はフレームごとに変更でき、ぼかしの半径（最大 64 ピクセル）と影のずれは出力画像のピクセル単位です。Group では、子要素をまとめた結果に効果を適用します。

```tsx title="光彩と影の付いたタイトル"
<Group glow={{ color: "#FFCC6680", blur: 12 }}>
  <Text style={{ fontSize: 96 }}
    shadow={{ color: "#000000B0", blur: 6, offsetX: 4, offsetY: 6 }}>
    Celesta
  </Text>
</Group>
```

## カスタムシェーダー

`@celesta/shader` の `defineShader` で、WGSL のフィルタを定義できます。`fn effect(input: EffectInput) -> vec4f` を書き、出力の各ピクセルを乗算済みアルファの RGBA で返します。レイヤーの画素は `source_at(position)`（シーンのピクセル座標、補間あり）か `source_load(pixel)` で読みます。`input.uv` はレイヤーの矩形の中での位置（0,0 から 1,1）で、`celesta` にはシーンの大きさとその矩形が入っています。パラメータは `params` で宣言し、使うたびに値を渡します。時間もパラメータとして渡すので、シーケンスや FreezeFrame の中でも正しく動きます。結果はどのレイヤーの `shader` にも渡せます。シェーダーは blur、shadow、glow より先に適用され、レイヤーの矩形と `padding` の範囲にだけ書き込みます。ソースは `.wgsl` ファイルとして import でき、エディタのハイライトが効くうえ、保存するとプレビューが再読み込みされます。シェーダーはプレビューと書き出しで動き、ブラウザ版エディタでは使えません。

```tsx title="波打つタイトル"
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

## ブレンドモード

各レイヤーの `blendMode` で、CSS の `mix-blend-mode` と同様に下の描画との混ぜ方を変えます。`normal`（既定）、`multiply`、`screen`、`overlay`、`add`、`difference` が使えます。`Group` で `normal` 以外を選ぶと、先に子をまとめて描き、その結果を 1 レイヤーとして混ぜます。

```tsx title="明るい背景でも暗い背景でも読める HUD"
<Group blendMode="difference" opacity={0.8}>
  <Text x={48} y={48} style={{ fill: { type: 'solid', color: '#ffffff' } }}>
    REC 00:00:12
  </Text>
</Group>
```

## グループ化と配置

`Group` 自体はサイズを持ちません。子は `x` / `y` を基準に配置され、回転・拡縮・透明度が全体に適用されます。レイアウトのヘルパーもこれを基礎にしています。

**レイアウトのヘルパー**

| API | 用途 |
| --- | --- |
| `Center` | 原点をキャンバスまたは親 `SafeArea` の中心に移動します。 |
| `SafeArea` | `padding`（数値または `{ top, right, bottom, left }`）で余白を取り、内側のヘルパーが見る領域を縮めます。 |
| `Stack` | 子を `spacing` ピクセル間隔で並べます。既定は `vertical`、`horizontal` も選べます。 |
| `Grid` | `columns` 列、`columnWidth` × `rowHeight` のセルに子を配置します。間隔も指定できます。 |
| `Fit` | `sourceWidth` × `sourceHeight` で設計した内容を、現在の領域に `contain` または `cover` で合わせます。 |

```tsx title="セーフマージン内の中央揃えリスト"
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

ヘルパーは子の原点を配置し、描画サイズは計測しません。配置点を中心にするには、子のアンカーを `0.5` にします。

## グループを切り抜く

`Group` に `clip` を指定すると、グループの座標系にある矩形 `{ x, y, width, height, cornerRadius }` の内側にだけ子を描きます。マスクによる表示、ワイプ、パネル内のスクロールに使えます。クリップはグループとともに移動・拡縮・回転し、境界はアンチエイリアスされます。入れ子のクリップは共通部分だけを表示します。

```tsx title="境界の裏からテキストをスライド"
<Group x={120} y={200} clip={{ width: 720, height: 96 }}>
  <Text y={96 * (1 - reveal)}
    style={{ fontSize: 88, fill: { type: 'solid', color: '#332f3b' } }}>
    Layer it.
  </Text>
</Group>
```
