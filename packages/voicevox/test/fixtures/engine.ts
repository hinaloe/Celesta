// Types of the JSON fixtures: queries as VOICEVOX Engine returns them, with
// every field set (VoicevoxAudioQuery leaves optional what Celesta defaults).

import type { VoicevoxAccentPhrase, VoicevoxAudioQuery, VoicevoxMora } from '../../src/index.js';

export interface EngineMora extends VoicevoxMora {
  text: string;
  consonant: string | null;
  consonant_length: number | null;
  pitch: number;
}

export interface EngineAccentPhrase extends VoicevoxAccentPhrase {
  moras: EngineMora[];
  accent: number;
  pause_mora: EngineMora | null;
  is_interrogative: boolean;
}

export interface EngineQuery extends VoicevoxAudioQuery {
  accent_phrases: EngineAccentPhrase[];
  speedScale: number;
  pitchScale: number;
  intonationScale: number;
  volumeScale: number;
  prePhonemeLength: number;
  postPhonemeLength: number;
  pauseLength: number | null;
  pauseLengthScale: number;
  outputSamplingRate: number;
  outputStereo: boolean;
  kana: string;
}

/** An entry of voicevox-engine-0.26-synthesis.json: a query and the WAV the engine made from it. */
export interface Synthesized {
  name: string;
  query: EngineQuery;
  wavSamples: number;
  sampleRate: number;
}

/** A query the tests build and edit in place. */
export type EditableQuery = Omit<VoicevoxAudioQuery, 'accent_phrases'> & {
  accent_phrases: (Omit<VoicevoxAccentPhrase, 'moras'> & { moras: VoicevoxMora[] })[];
};
