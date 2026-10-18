// Generates the WAV files for packages/cli/examples/with-voice-level-matching.tsx
// into examples/assets/voice-level-demo: one synthetic "voice" per line of
// script.json, a BGM loop, and a game-audio bed. Everything is synthesized
// here (no recordings), so the files are redistributable and reproducible.
//
//   node packages/cli/scripts/make-voice-level-fixtures.mjs
//
// The voices are not speech, only speech-shaped: a harmonic buzz per mora
// with vowel-dependent formant weights, a falling pitch contour, short pauses
// at punctuation, and silence before and after. Each line's length follows
// its `reading`, so editing script.json and re-running this script changes
// the timing the example plans from. しずく is recorded loud and こむぎ quiet
// (about 16 dB apart) so level matching has something to do.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEMO = join(HERE, '..', '..', '..', 'examples', 'assets', 'voice-level-demo');
const RATE = 48_000;

const SPEAKERS = {
  shizuku: { f0: 250, rmsDbfs: -14 },
  komugi: { f0: 135, rmsDbfs: -30 },
};

// Relative harmonic weights around each vowel's first two formants.
const FORMANTS = { a: [800, 1200], i: [300, 2300], u: [350, 1300], e: [500, 1900], o: [500, 900] };
const VOWEL_OF = new Map();
for (const [vowel, kana] of Object.entries({
  a: 'あかがさざただなはばぱまやらわゃ',
  i: 'いきぎしじちぢにひびぴみり',
  u: 'うくぐすずつづぬふぶぷむゆるゅ',
  e: 'えけげせぜてでねへべぺめれ',
  o: 'おこごそぞとどのほぼぽもよろをょ',
})) {
  for (const character of kana) VOWEL_OF.set(character, vowel);
}

function writeWav(path, channels) {
  const frames = channels[0].length;
  const dataSize = frames * channels.length * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVEfmt ', 8, 'ascii');
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels.length, 22);
  buffer.writeUInt32LE(RATE, 24);
  buffer.writeUInt32LE(RATE * channels.length * 2, 28);
  buffer.writeUInt16LE(channels.length * 2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(dataSize, 40);
  let offset = 44;
  for (let i = 0; i < frames; i += 1) {
    for (const channel of channels) {
      buffer.writeInt16LE(Math.round(Math.max(-1, Math.min(1, channel[i])) * 0x7fff), offset);
      offset += 2;
    }
  }
  writeFileSync(path, buffer);
}

/** Deterministic noise, so re-running the script gives identical files. */
function noise(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x80000000 - 1;
  };
}

function voice(reading, { f0, rmsDbfs }) {
  const MORA = 0.14;
  const PAUSE = 0.22;
  const EDGE = 0.2;
  const units = [];
  for (const character of reading) {
    if ('、。！？'.includes(character)) units.push(null);
    else if ('ゃゅょぁぃぅぇぉ'.includes(character) && units.length > 0 && units[units.length - 1]) {
      units[units.length - 1] = VOWEL_OF.get(character) ?? units[units.length - 1];
    } else if ('っ'.includes(character)) units.push('pause-short');
    else if (character === 'ー' && units.length > 0) units.push(units[units.length - 1]);
    else if (character === 'ん') units.push('n');
    else units.push(VOWEL_OF.get(character) ?? 'a');
  }
  const seconds = EDGE * 2 + units.reduce((total, unit) => total + (unit === null ? PAUSE : unit === 'pause-short' ? MORA / 2 : MORA), 0);
  const samples = new Float64Array(Math.ceil(seconds * RATE));
  let at = EDGE;
  let phase = 0;
  units.forEach((unit, index) => {
    const length = unit === null ? PAUSE : unit === 'pause-short' ? MORA / 2 : MORA;
    if (unit !== null && unit !== 'pause-short') {
      const start = Math.round(at * RATE);
      const count = Math.round(length * 0.85 * RATE);
      const [f1, f2] = unit === 'n' ? [250, 1000] : FORMANTS[unit];
      // Pitch falls across the line, with a small rise on every third mora.
      const pitch = f0 * (1.1 - 0.25 * (index / units.length)) * (index % 3 === 0 ? 1.06 : 1);
      for (let i = 0; i < count; i += 1) {
        const t = i / count;
        const envelope = Math.min(1, t / 0.15) * Math.min(1, (1 - t) / 0.25) * (unit === 'n' ? 0.5 : 1);
        phase += (2 * Math.PI * pitch) / RATE;
        let value = 0;
        for (let harmonic = 1; harmonic * pitch < 4000; harmonic += 1) {
          const frequency = harmonic * pitch;
          const weight = 1 / harmonic + 1.5 * Math.exp(-(((frequency - f1) / 150) ** 2)) + 0.8 * Math.exp(-(((frequency - f2) / 200) ** 2));
          value += weight * Math.sin(harmonic * phase);
        }
        samples[start + i] += envelope * value;
      }
    }
    at += length;
  });
  // Scale so the voiced part sits at the speaker's level (power over samples above -60 dBFS-ish).
  let sum = 0;
  let voiced = 0;
  let peak = 0;
  for (const value of samples) {
    peak = Math.max(peak, Math.abs(value));
  }
  for (const value of samples) {
    if (Math.abs(value) > peak * 0.05) {
      sum += value * value;
      voiced += 1;
    }
  }
  const scale = 10 ** (rmsDbfs / 20) / Math.sqrt(sum / voiced);
  return samples.map((value) => value * scale);
}

function bgm(seconds) {
  const frames = Math.round(seconds * RATE);
  const left = new Float64Array(frames);
  const right = new Float64Array(frames);
  // C – Am – F – G, two seconds each, as soft sine triads plus a plucked arpeggio.
  const chords = [[261.63, 329.63, 392.0], [220.0, 261.63, 329.63], [174.61, 220.0, 261.63], [196.0, 246.94, 293.66]];
  for (let i = 0; i < frames; i += 1) {
    const t = i / RATE;
    const chord = chords[Math.floor(t / 2) % 4];
    const within = t % 2;
    const swell = Math.min(1, within / 0.3) * Math.min(1, (2 - within) / 0.3);
    let pad = 0;
    for (const frequency of chord) pad += Math.sin(2 * Math.PI * frequency * t) + 0.3 * Math.sin(4 * Math.PI * frequency * t);
    const step = Math.floor(within / 0.25);
    const note = chord[step % 3] * (step >= 3 ? 2 : 1);
    const since = within - step * 0.25;
    const pluck = Math.sin(2 * Math.PI * note * t) * Math.exp(-since * 9);
    left[i] = 0.06 * pad * (0.6 + 0.4 * swell) + 0.12 * pluck;
    right[i] = 0.06 * pad * (0.6 + 0.4 * swell) + 0.09 * pluck;
  }
  return [left, right];
}

function game(seconds) {
  const frames = Math.round(seconds * RATE);
  const left = new Float64Array(frames);
  const right = new Float64Array(frames);
  const random = noise(7);
  let lowL = 0;
  let lowR = 0;
  for (let i = 0; i < frames; i += 1) {
    const t = i / RATE;
    // A low engine-like rumble, slightly different per side.
    lowL += 0.02 * (random() - lowL);
    lowR += 0.02 * (random() - lowR);
    const rumble = 0.5 + 0.5 * Math.sin(2 * Math.PI * 0.4 * t);
    // A short blip every 0.75 s, alternating sides.
    const beat = Math.floor(t / 0.75);
    const since = t - beat * 0.75;
    const blip = since < 0.08 ? Math.sign(Math.sin(2 * Math.PI * (beat % 4 === 0 ? 1320 : 880) * t)) * (1 - since / 0.08) : 0;
    left[i] = 1.6 * lowL * rumble + (beat % 2 === 0 ? 0.08 : 0.03) * blip;
    right[i] = 1.6 * lowR * rumble + (beat % 2 === 0 ? 0.03 : 0.08) * blip;
  }
  return [left, right];
}

const script = JSON.parse(readFileSync(join(DEMO, 'script.json'), 'utf8'));
mkdirSync(join(DEMO, 'voices'), { recursive: true });
for (const line of script) {
  writeWav(join(DEMO, 'voices', `${line.id}.wav`), [voice(line.reading, SPEAKERS[line.speaker])]);
}
writeWav(join(DEMO, 'bgm.wav'), bgm(40));
writeWav(join(DEMO, 'game.wav'), game(40));
console.log(`wrote ${script.length} voices, bgm.wav, and game.wav to ${DEMO}`);
