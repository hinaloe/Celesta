// Japanese the demos draw, in one place, so fonts.tsx can subset Noto Sans
// JP to exactly these characters without importing the demos.

/** STROKES: a subtitle with a double outline. */
export const SUBTITLE_JA = 'フチは何重にでも。';

/** FALLBACK: code in JetBrains Mono, whose Japanese comes from Noto Sans JP. */
export const FALLBACK_CODE = [
  'const 名前 = "デルタ"; // 和文は',
  'let 字幕 = `${名前} 0.8.0`; // Noto から',
];

/** VOICES: the transcripts of examples/assets/voice-folder/shizuku. */
export const VOICE_TEXTS = [
  'こんにちは。ボイスフォルダーを読み込んでみます。',
  '音声と文字を、同じ名前で保存してください。',
  '保存し直すと、プレビューが自動で更新されます。',
];

export const DEMO_STRINGS = [SUBTITLE_JA, ...FALLBACK_CODE, ...VOICE_TEXTS, 'しずく'];
