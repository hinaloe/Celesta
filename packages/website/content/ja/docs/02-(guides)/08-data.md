## 描画前にデータを読み込む

各フレームは同期的に描画するため、コンポーネントでファイルや通信を待てません。代わりに `async prepare()` エクスポートを使います。プレビューも書き出しも最初のフレーム前に一度だけ実行されます。結果をモジュールの変数に保存し、描画中に読み取ります。

```tsx title="一度取得して全フレームで使う"
let headlines: string[] = ['Hello from Celesta'];

export async function prepare() {
  try {
    const response = await fetch('https://example.com/headlines.json');
    headlines = (await response.json()) as string[];
  } catch (error) {
    console.error('Using the fallback headline', error);
  }
}
```

オフラインでも描画できるよう既定値を用意します。同じ理由で `loadLipSync()`、`loadPsdPreset()`、`preloadMedia()` も `prepare()` 内で実行します。

## データと props でコンポーネントを再利用する

設定は通常のオブジェクトや読み込んだ JSON データに置き、React コンポーネントの props として渡します。データ用の JSON は、.celesta.json のタイムライン形式とは別のものです。props に型を付けると、エディタで使い方を確認できます。

```tsx file=examples/data.tsx title="data.tsx"
```

> [!NOTE]
> **既存の JSON プロジェクトとの連携**
> ProjectProvider、useProjectProperty()、defineProjectProperties()、registerComponent() は既存の JSON プロジェクトとの連携に使えます。新しい React コンポジションでは必須ではありません。既存ファイルの保守には[旧形式のタイムラインの説明](/ja/docs/timelines/)を参照してください。
