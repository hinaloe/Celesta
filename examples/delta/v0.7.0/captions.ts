import type { SubtitleCue } from '@celesta/react';
import { PRS } from './prs';
import { CHAPTER_COUNT, CHAPTER_LENGTHS, OPEN_LENGTH, OUTRO_AT, OUTRO_LENGTH, chapterAt } from './timeline';

// One Japanese caption per scene. <Subtitles> draws nothing; the export
// writes them out with --subtitles delta-0.7.0.srt.
const TEXTS = [
  `Celesta v0.6.0 → v0.7.0。マージされた ${PRS.length} 本の PR から`,
  'Δ01 TRANSITIONS — 新しいトランジション 7 種と defineTransition()。この映像に同じ切り替えは 2 度出てきません',
  'Δ02 MASK — テキストやパスや部分木を、グループのマスクに',
  'Δ03 MOTION BLUR — シャッターが開いている間の平均を描く MotionBlur と、残像の Trail',
  'Δ04 EFFECTS — ハーフトーン・色収差・波・ノイズ・走査線・ズームブラーとクロマキーをプロパティで',
  'Δ05 COLOR — 色補正のプロパティと、順に適用されるシェーダーの配列',
  'Δ06 BLEND — W3C の 17 種のブレンドモードと PSD のブレンドレイヤー',
  'Δ07 SHAPES — 角を丸められる三角形・多角形・星・扇形・ハートと、破線・点線',
  'Δ08 PATHS — パスの長さ・トリム・モーフィングと SVG のパスデータ',
  'Δ09 SPECTRUM — 音声のスペクトルと音量をフレームごとに。このバーはこの映像の BGM です',
  'Δ10 MEDIA — 音の鳴る Video、ループ、アニメーション画像、透過動画の書き出し',
  'Δ11 MCP — コーディングエージェント向けの Celesta MCP サーバー',
  'Δ12 EDITOR — React のコンポジションの音声・動画クリップ、ジェスチャー、ソースを開く、Problems タブ',
  'MORE — 複数のコンポジション、Google Fonts、字幕ファイル、セーフエリアほか',
  'Celesta 0.7.0 — Every update is a diff.',
];

export const CAPTIONS: readonly SubtitleCue[] = [
  { from: 0, durationInFrames: OPEN_LENGTH, text: TEXTS[0] },
  ...Array.from({ length: CHAPTER_COUNT }, (_, i) => ({ from: chapterAt(i), durationInFrames: CHAPTER_LENGTHS[i], text: TEXTS[i + 1] })),
  { from: OUTRO_AT, durationInFrames: OUTRO_LENGTH, text: TEXTS[CHAPTER_COUNT + 1] },
];
