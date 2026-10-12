import { createElement as h, Fragment, type ReactNode } from 'react';
import type { Locale } from '../site/copy/index.ts';

/** Wraps translated children in an element; called with no children it renders a self-closing slot. */
export type Slot = (children?: ReactNode) => ReactNode;

/** The playground's own strings (`playground.*` and the showcase editor), carried by the island. */
const en = {
  label: 'Playground',
  theSceneBelowIsCodeChangeA: (s0: Slot, s1: Slot) => h(Fragment, null, 'The scene below is code.', s0(), s1('Change a line.')),
  tryEditingTitle: 'Try editing TITLE.',
  celestaWebEditor: (s0: Slot, s1: Slot, s2: Slot, s3: Slot) => h(Fragment, null, s0(s1()), s2(h(Fragment, null, s3(), ' Celesta web editor'))),
  tsxYourCompositionCopySource: (s0: Slot, s1: Slot, s2: Slot) => h(Fragment, null, s0(h(Fragment, null, s1('TSX'), ' Your composition')), s2('Copy source')),
  compositionSourceCode: 'Composition source code',
  linesNotSavedDownloadToKeepIt: (s0: Slot) => h(Fragment, null, s0(), ' lines · Not saved. Download to keep it.'),
  openTsxDownloadTsx: (s0: Slot, s1: Slot, s2: Slot) => h(Fragment, null, s0(h(Fragment, null, 'Open .tsx', s1())), s2('Download .tsx ↓')),
  compositionPreview: (s0: Slot, s1: Slot, s2: Slot) => h(Fragment, null, s0('COMPOSITION PREVIEW'), s1(s2())),
  previewFrame: 'Preview frame',
  addMedia: (s0: Slot, s1: Slot, s2: Slot, s3: Slot) => h(Fragment, null, s0(h(Fragment, null, 'Add media', s1())), s2(s3())),
  exportMp4: (s0: Slot, s1: Slot, s2: Slot) => h(Fragment, null, s0('Export MP4 ↓'), s1(), s2()),
  videoPreviewIsSilentMp4ExportIncludes: 'Video preview is silent; MP4 export includes audio.',
  esbuildCompilesYourTsxInAWeb: 'esbuild compiles your TSX in a Web Worker and Celesta’s React renderer evaluates each frame. Preview and export share one canvas renderer.',
  runsEntirelyInYourBrowser: 'Runs entirely in your browser',
  status: {
    preparing: 'Preparing the editor…',
    compiling: 'Compiling…',
    ready: 'Ready to preview and export.',
    fixCode: 'Fix the code to preview.',
    exporting: 'Exporting MP4…',
    downloaded: 'MP4 downloaded.',
    canceled: 'Export canceled.',
    failed: 'Export failed.',
    copiedSource: 'Source copied.',
    copySourceFailed: 'Could not copy source.',
    waiting: 'Waiting for code',
  },
  controls: {
    previewAt: (v: { frame: number }) => `Composition preview at frame ${v.frame}`,
    pause: 'Pause preview',
    play: 'Play preview',
    frameOf: (v: { frame: number; last: number }) => `Frame ${v.frame} of ${v.last}`,
    cancel: 'Cancel',
    exportProgress: 'Export progress',
  },
  mediaHint: 'Use media file names in Image/Video src.',
  editorLoading: 'Loading editor…',
  showcase: {
    loading: 'Loading composition source…',
    retry: 'Retry',
    editTitle: 'Make it your own.',
    editHint: 'Choose a file. Change a line.',
    sourceFile: 'Source file',
    reset: 'Reset sample',
  },
};

export type PlaygroundCopy = typeof en;

const ja: PlaygroundCopy = {
  label: 'プレイグラウンド',
  theSceneBelowIsCodeChangeA: (s0, s1) => h(Fragment, null, 'コードを変えて、', s0(), s1('動きを試そう。')),
  tryEditingTitle: 'まずは TITLE の文字を書き換えてみましょう。',
  celestaWebEditor: (s0, s1, s2, s3) => h(Fragment, null, s0(s1()), s2(h(Fragment, null, s3(), ' Celesta ウェブエディタ'))),
  tsxYourCompositionCopySource: (s0, s1, s2) => h(Fragment, null, s0(h(Fragment, null, s1('TSX'), ' コンポジション')), s2('ソースをコピー')),
  compositionSourceCode: 'コンポジションのソースコード',
  linesNotSavedDownloadToKeepIt: (s0) => h(Fragment, null, s0(), ' 行 · 保存するにはダウンロードしてください。'),
  openTsxDownloadTsx: (s0, s1, s2) => h(Fragment, null, s0(h(Fragment, null, '.tsx を開く', s1())), s2('.tsx をダウンロード ↓')),
  compositionPreview: (s0, s1, s2) => h(Fragment, null, s0('コンポジションのプレビュー'), s1(s2())),
  previewFrame: 'プレビューするフレーム',
  addMedia: (s0, s1, s2, s3) => h(Fragment, null, s0(h(Fragment, null, 'メディアを追加', s1())), s2(s3())),
  exportMp4: (s0, s1, s2) => h(Fragment, null, s0('MP4 に書き出す ↓'), s1(), s2()),
  videoPreviewIsSilentMp4ExportIncludes: 'プレビューは映像のみです。書き出した MP4 には音声も含まれます。',
  esbuildCompilesYourTsxInAWeb: 'コードを編集すると、プレビューに反映されます。確認した映像を、そのまま MP4 に書き出せます。',
  runsEntirelyInYourBrowser: 'ブラウザだけで使えます',
  status: {
    preparing: 'エディタを準備中…',
    compiling: 'コンパイル中…',
    ready: 'プレビューと書き出しができます。',
    fixCode: 'プレビューするには、コードを修正してください。',
    exporting: 'MP4 を書き出し中…',
    downloaded: 'MP4 をダウンロードしました。',
    canceled: '書き出しを中止しました。',
    failed: '書き出しに失敗しました。',
    copiedSource: 'ソースをコピーしました。',
    copySourceFailed: 'ソースをコピーできませんでした。',
    waiting: 'コードの入力待ち',
  },
  controls: {
    previewAt: (v) => `フレーム ${v.frame} のプレビュー`,
    pause: 'プレビューを一時停止',
    play: 'プレビューを再生',
    frameOf: (v) => `フレーム ${v.frame} / ${v.last}`,
    cancel: '中止',
    exportProgress: '書き出しの進捗',
  },
  mediaHint: '追加したファイル名を Image/Video の src に指定してください。',
  editorLoading: 'エディターを読み込み中…',
  showcase: {
    loading: '作品のソースを読み込み中…',
    retry: '再試行',
    editTitle: '自分の作品にしてみよう。',
    editHint: 'ファイルを選んで、1行変えてみよう。',
    sourceFile: 'ソースファイル',
    reset: 'サンプルをリセット',
  },
};

const catalogs: Record<Locale, PlaygroundCopy> = { en, ja };

export const playgroundCopy = (locale: Locale): PlaygroundCopy => catalogs[locale] ?? en;
