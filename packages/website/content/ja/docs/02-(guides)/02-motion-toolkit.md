シーンを並べる、リストを順に表示する、拍に合わせて切り替えるなど、よく使うパターンのヘルパーです。`Sequence`、`Group`、フレームに基づくので、スクラブでき、結果も一定です。テキスト効果・カメラ・線は[次のページ](/ja/docs/text-camera-lines/)、シード付き乱数とノイズは [`@celesta/math`](/ja/docs/math/) で説明します。

## シーンを続けて並べる

`<Series>` は子の `<Series.Sequence>` を順番に再生するので、開始フレームではなく各シーンの長さを指定できます。`offset` を負にすると前のシーンと重なります。`computeSeries()` は描画せず同じ計算を行い、コンポジション全体の長さを求めるのに便利です。

```tsx title="各シーンの長さから全体を計算"
const SCENES = [
  { name: 'intro', durationInFrames: 90, Scene: Intro },
  { name: 'body', durationInFrames: 240, Scene: Body },
  { name: 'outro', durationInFrames: 60, Scene: Outro },
];
const { durationInFrames } = computeSeries(SCENES);

export default function Root() {
  return (
    <Composition width={1920} height={1080} fps={30} durationInFrames={durationInFrames}>
      <Series>
        {SCENES.map(({ name, durationInFrames, Scene }) => (
          <Series.Sequence key={name} durationInFrames={durationInFrames}>
            <Scene />
          </Series.Sequence>
        ))}
      </Series>
    </Composition>
  );
}
```

## シーンをトランジションでつなぐ

`<TransitionSeries>` は `Series` と同じくシーンを順に並べ、2 つのシーンの間に `<TransitionSeries.Transition>` を置けます。`'cut'` はカット、`'crossfade'` は次のシーンを前のシーンの上にフェードイン、`'slide'` は次のシーンが前のシーンを押し出し、`'wipe'` は動く直線の境界の向こうに次のシーンを見せます。トランジションは前後のシーンを `durationInFrames` の分だけ重ねるので、`computeTransitionSeries()` で各シーンの開始位置と、重なりの分だけ短くなった全体の長さを求められます。

```tsx file=examples/transition-series.tsx title="クロスフェードとスライドでつないだシーン"
```

各シーンは通常の Sequence で、入りのトランジションの最初のフレームがフレーム 0 です。後のシーンが手前に描かれます。前後どちらかのシーンより長いトランジションや、入りと出のトランジションを合わせた長さに満たないシーンはエラーになるので、空白や 3 つのシーンの同時表示は起こりません。重なったシーンの音声は同時に再生されます。`useTransitionVolume(volume)` はシーン内の Audio に映像と一緒にフェードする音量を返し、`useTransitionSeriesScene()` はほかのタイミング調整のためにシーン前後のトランジションを返します。

## 順番に入場させる

`progress(frame, start, durationInFrames, easing?)` は「区間のどこまで進んだか」を 0〜1 に制限した値で返し、多くの入場効果の基礎になります。`<Stagger each={n}>` は前の子から `n` フレーム遅れて次の子を開始するので、フレーム 0 向けの入場効果がリストを順に流れます。

```tsx title="一行ずつ表示する"
function Row({ label, y }: { label: string; y: number }) {
  const frame = useCurrentFrame(); // 0 when this row starts
  const p = progress(frame, 0, 20, Easings.easeOutExpo);
  return <Text x={120 + 40 * (1 - p)} y={y} opacity={p}>{label}</Text>;
}

<Stagger each={4}>
  {items.map((item, i) => <Row key={item} label={item} y={200 + i * 64} />)}
</Stagger>
```

## 拍に合わせる

`useBeat({ bpm })` は現在の `beat`、`bar`、`beatInBar`、拍内の `progress`、拍ごとに 1 になり次の拍まで減衰する `pulse` を返します。音楽に合わせた点滅・拡縮・カットに使えます。`offset` で最初の拍をずらせます。

```tsx title="音楽に合わせて脈動する点"
const { pulse } = useBeat({ bpm: 120 });
return <Rect width={40} height={40} cornerRadius={20} scale={1 + 0.3 * pulse} fill="#7cf29c" />;
```

## キュー

`useCue(cues)` は `at` 順の `{ at, …data }` オブジェクトのリストを受け取り、現在のキュー、`index`、開始からの `frame`、`previous` と `next` のキューを返します。キャプションの切り替え、カメラの移動、グラフの注釈をキューの列で表せます。`cueAt(cues, frame)` はコンポーネント外でも同じ計算を行います。

```tsx title="キャプションを切り替えてフェードイン"
const active = useCue([
  { at: 0, text: 'Write it.' },
  { at: 45, text: 'Preview it.' },
  { at: 90, text: 'Ship it.' },
]);
if (!active) return null;
return <Text opacity={progress(active.frame, 0, 10)}>{active.cue.text}</Text>;
```

## タイムコード

`@celesta/react` の `frameToTimecode(frame, fps)` は、`HH:MM:SS:FF` 形式の画面内時計を生成します。
