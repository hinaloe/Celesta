インストールしたアプリには React ランタイムが含まれています。アプリまたは CLI で[プロジェクトを作成](/ja/docs/create-project/)すると、ひな形の `film.tsx` と TypeScript 設定を取得できます。ひな形はパッケージのインストールやビルドなしでプレビュー・書き出しできます。追加の npm 依存関係はプロジェクトのフォルダに入れてください。

## 最初のシーンを作る

自分のプロジェクトに `first-scene.tsx` を作ります。このサンプルは 1920 × 1080、30 fps のコンポジションです。タイトルが 30 フレームかけてフェードインし、そのまま 5 秒の終了まで表示されます。

```tsx file=examples/first-scene.tsx title="first-scene.tsx"
```

Celesta の **File → Open…** で `first-scene.tsx` を選び、`Space` で再生します。

テキストや色を変えて保存すると、ネイティブプレビューが再読み込みされます。Celesta のコンポーネントは動画のレイヤーを表します。HTML 要素や CSS クラスの代わりに `Text`、`Rect`、`Group` を使います。

## コンポジションの構成

- ファイルの **default export** は、サイズ・フレームレート・長さを持つ単一の `<Composition>` を返します。
- 内側は順番に描画され、後のレイヤーが前のレイヤーの上に重なります。
- 自作コンポーネントは通常の React 関数コンポーネントです。props、`.map()`、条件分岐もいつもどおり使えます。
- 任意の名前付きエクスポート `prepare()` は、最初のフレームの前に一度だけ実行されます。[データ・プロパティ・コンポーネント](/ja/docs/data/)をご覧ください。

## エディタの TypeScript 設定

React コンポジションを開き、**File → Set Up TypeScript** を選びます。Celesta がすべての `@celesta/*` パッケージ、React、Node.js の対応する型宣言をローカルの `.celesta/` ディレクトリにコピーします。

まだコンポジションがない新規プロジェクトでは、**File → Set Up TypeScript in Folder…** でフォルダを選ぶと、最初から型を使って書けます。

`tsconfig.json` がなければ Celesta が作成します。既存の設定がある場合は、ほかの設定を残して以下の `extends` を追加します。

```json title="tsconfig.json"
{
  "extends": "./.celesta/tsconfig.json"
}
```

この設定に必要な型宣言を npm から入れる必要はありません。新しいアプリでプロジェクトを開くと `.celesta/` が更新されます。このディレクトリは Git から自身を除外します。
