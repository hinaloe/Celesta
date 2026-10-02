// Builds a lip-sync track from a VOICEVOX Engine `audio_query` result.
//
// Unlike `loadLipSync`, which guesses where the vowels fall inside a WAV,
// an AudioQuery states the length of every consonant and vowel the engine
// will synthesize, so the mouth lines up with the voice exactly. Engines
// that share VOICEVOX's API (AivisSpeech, COEIROINK v2, ...) return the same
// shape.
//
// The timeline mirrors `_query_to_decoder_feature` in voicevox_engine's
// `tts_pipeline/tts_engine.py`: optional interrogative upspeak, then
// `prePhonemeLength` silence, every accent phrase's moras followed by its
// `pause_mora`, `postPhonemeLength` silence; `pauseLength` /
// `pauseLengthScale` adjust only the pause moras, and `speedScale` divides
// everything. The engine also rounds each phoneme to its 93.75 Hz frame
// grid; that is not reproduced here (it is engine-specific and shifts each
// boundary by under 6 ms), so the track can differ from the WAV length by a
// few milliseconds.

import { lipSyncFromKeyframes, type LipSyncTrack, type MouthKeyframe } from './lipsync';
import type { MouthShape } from './generated/MouthShape';

/** One mora of a VOICEVOX AudioQuery. Only the fields lip sync reads. */
export interface VoicevoxMora {
  text?: string;
  consonant?: string | null;
  consonant_length?: number | null;
  vowel: string;
  vowel_length: number;
  pitch?: number;
}

export interface VoicevoxAccentPhrase {
  moras: readonly VoicevoxMora[];
  pause_mora?: VoicevoxMora | null;
  is_interrogative?: boolean;
}

/**
 * The JSON returned by VOICEVOX Engine's `POST /audio_query` (and passed to
 * `POST /synthesis`). Fields lip sync does not need are allowed but ignored.
 */
export interface VoicevoxAudioQuery {
  accent_phrases: readonly VoicevoxAccentPhrase[];
  speedScale?: number;
  prePhonemeLength?: number;
  postPhonemeLength?: number;
  /** Newer engines: when not null, replaces the length of every pause mora. */
  pauseLength?: number | null;
  /** Newer engines: multiplies the length of every pause mora. */
  pauseLengthScale?: number;
}

export interface VoicevoxLipSyncOptions {
  /**
   * Whether the voice was synthesized with interrogative upspeak, which
   * appends a 0.15 s mora to accent phrases marked `is_interrogative`.
   * Matches `/synthesis`'s `enable_interrogative_upspeak`, default `true`.
   */
  interrogativeUpspeak?: boolean;
}

// Consonants made by closing both lips. Showing the next vowel's open mouth
// during them looks like the lips never meet, so they stay `closed`; every
// other consonant anticipates its vowel, which is how the mouth actually
// moves into a mora.
const BILABIAL_CONSONANTS = new Set(['m', 'my', 'b', 'by', 'p', 'py']);

const UPSPEAK_LENGTH = 0.15;

/**
 * Mouth shape for a VOICEVOX vowel phoneme. Devoiced vowels (`A I U E O`)
 * keep their vowel's shape; `N` (ん), `cl` (っ), `pau`, `sil` and anything
 * unknown are `closed`.
 */
export function voicevoxVowelShape(vowel: string): MouthShape {
  switch (vowel) {
    case 'a':
    case 'A':
      return 'a';
    case 'i':
    case 'I':
      return 'i';
    case 'u':
    case 'U':
      return 'u';
    case 'e':
    case 'E':
      return 'e';
    case 'o':
    case 'O':
      return 'o';
    default:
      return 'closed';
  }
}

function lengthOf(value: number | null | undefined, what: string): number {
  const length = value ?? 0;
  if (!Number.isFinite(length) || length < 0) {
    throw new Error(`lipSyncFromVoicevox: ${what} must be a non-negative number, got ${value}`);
  }
  return length;
}

/**
 * Converts a VOICEVOX AudioQuery into a `LipSyncTrack` for `<Dialogue
 * lipSync>`, `<CharacterView lipSync>` or `useLipSync`. Pass the same query
 * that synthesized the voice, so speed and pause edits are reflected. Time 0
 * is the start of the WAV, including `prePhonemeLength`.
 */
export function lipSyncFromVoicevox(
  query: VoicevoxAudioQuery,
  options: VoicevoxLipSyncOptions = {},
): LipSyncTrack {
  const speedScale = query.speedScale ?? 1;
  if (!Number.isFinite(speedScale) || speedScale <= 0) {
    throw new Error(`lipSyncFromVoicevox: speedScale must be a positive number, got ${query.speedScale}`);
  }
  const pauseLengthScale = query.pauseLengthScale ?? 1;
  const upspeak = options.interrogativeUpspeak ?? true;

  const keyframes: MouthKeyframe[] = [];
  let cursor = 0;
  const push = (length: number, mouth: MouthShape): void => {
    if (length <= 0) return;
    keyframes.push({ seconds: cursor / speedScale, mouth });
    cursor += length;
  };

  push(lengthOf(query.prePhonemeLength, 'prePhonemeLength'), 'closed');
  for (const phrase of query.accent_phrases) {
    const moras = [...phrase.moras];
    const last = moras[moras.length - 1];
    if (upspeak && phrase.is_interrogative && last !== undefined && (last.pitch ?? 0) > 0) {
      moras.push({ vowel: last.vowel, vowel_length: UPSPEAK_LENGTH });
    }
    for (const mora of moras) {
      const vowel = voicevoxVowelShape(mora.vowel);
      if (mora.consonant) {
        const consonant = BILABIAL_CONSONANTS.has(mora.consonant) ? 'closed' : vowel;
        push(lengthOf(mora.consonant_length, 'consonant_length'), consonant);
      }
      push(lengthOf(mora.vowel_length, 'vowel_length'), vowel);
    }
    if (phrase.pause_mora) {
      const base = query.pauseLength ?? lengthOf(phrase.pause_mora.vowel_length, 'pause_mora.vowel_length');
      push(lengthOf(base * pauseLengthScale, 'pause length'), 'closed');
    }
  }
  push(lengthOf(query.postPhonemeLength, 'postPhonemeLength'), 'closed');

  return lipSyncFromKeyframes(keyframes, cursor / speedScale);
}
