import { Assets, Audio, Composition, Font, FreezeFrame, Group, Subtitles, progress, useCurrentFrame } from '@celesta/react';
import { TransitionSeries, computeTransitionSeries } from '@celesta/transitions';
import { CUT, ChapterShell } from './components/ChapterShell';
import { FPS, H, W, japaneseFonts } from './components/theme';
import { CAPTIONS } from './v0.7.0/captions';
import { CHAPTERS } from './v0.7.0/chapters';
import { CUTS, CUT_EASING } from './v0.7.0/cuts';
import { FilmContext } from './v0.7.0/film-context';
import { Hud } from './v0.7.0/Hud';
import { MORE_STRINGS, More } from './v0.7.0/More';
import { Open } from './v0.7.0/Open';
import { Outro } from './v0.7.0/Outro';
import { PRS } from './v0.7.0/prs';
import { SCORE_SRC, loadScore } from './v0.7.0/score';
import { CHAPTER_COUNT, CHAPTER_LENGTHS, OPEN_LENGTH, OUTRO_AT, OUTRO_LENGTH, chapterAt } from './v0.7.0/timeline';

// DELTA 0.7.0: what changed from Celesta v0.6.0 to v0.7.0, in a minute and a
// half. Twelve features of four bars and eight one-bar cards, cut to a
// 180 BPM drum & bass score; every chapter is a release-notes page with a
// live demo of the feature drawn by the feature.
// Open this file in Celesta, or export it with:
//   python3 examples/delta/make-score-0.7.0.py
//   Celesta-export --react examples/delta/film-0.7.0.tsx examples/delta/delta-0.7.0.mp4 --subtitles examples/delta/delta-0.7.0.srt
//
//   components/   the DELTA look, shared by every release film: theme, chapter page, diff panel, shaders
//   v0.7.0/       this release: the open, the chapters (chapters.tsx lists them, demos/ draws them), MORE, the outro
//
// The film is cut with the features it shows: every cut is a different
// transition (two of them defineTransition()), the open whips the PR log
// under a <MotionBlur> and flashes the chapters through a text mask, the
// card is glitched by a shader array, the HUD and the outro's ring read the
// score's spectrum, the fonts are loaded by name, the captions go out as an
// SRT file, and the entry holds a second composition: the poster.

/** prepare(): the score's spectrum, for everything that moves with the music. */
export async function prepare() {
  await loadScore();
}

// Each scene runs CUT frames past its bar line, so every cut lands on one.
const SCENES = [OPEN_LENGTH, ...CHAPTER_LENGTHS.map((length) => length + CUT), OUTRO_LENGTH + CUT];
const series = computeTransitionSeries(SCENES.flatMap((length, i) => (
  i === 0 ? [{ durationInFrames: length }] : [{ type: CUTS[i - 1].type, durationInFrames: CUT }, { durationInFrames: length }]
)));
const DURATION = series.durationInFrames;
/** The frame each chapter's cut lands on. */
const CHAPTER_AT = CHAPTER_LENGTHS.map((_, i) => series.sequences[i + 1].from + CUT);
// FreezeFrame and the outro find chapters through timeline.ts; keep it honest.
if (CHAPTERS.length + 1 !== CHAPTER_COUNT || CUTS.length !== CHAPTER_COUNT + 1
  || CHAPTER_AT.some((at, i) => at !== chapterAt(i)) || series.sequences[CHAPTER_COUNT + 1].from + CUT !== OUTRO_AT) {
  throw new Error('v0.7.0/timeline.ts does not match the cuts in film-0.7.0.tsx');
}
/** The outro's last frame with everything in: the poster. */
const POSTER_AT = DURATION - 30;

function Scene({ index }: { index: number }) {
  return index < CHAPTERS.length
    ? <ChapterShell chapter={CHAPTERS[index]} index={index} total={CHAPTERS.length} />
    : <More />;
}

function Film() {
  const outro = [
    ...CHAPTERS.map((chapter, i) => ({ title: chapter.title, at: CHAPTER_AT[i] + 100 })),
    { title: 'MORE', at: CHAPTER_AT[CHAPTERS.length] + 20 },
  ];
  return (
    <TransitionSeries>
      <TransitionSeries.Sequence durationInFrames={SCENES[0]}><Open chapters={CHAPTERS.length} /></TransitionSeries.Sequence>
      {CHAPTER_LENGTHS.flatMap((_, i) => [
        <TransitionSeries.Transition key={`cut-${i}`} type={CUTS[i].type} from={CUTS[i].from}
          durationInFrames={CUT} easing={CUT_EASING} />,
        <TransitionSeries.Sequence key={`scene-${i}`} durationInFrames={SCENES[i + 1]}>
          <Scene index={i} />
        </TransitionSeries.Sequence>,
      ])}
      <TransitionSeries.Transition type={CUTS[CHAPTER_COUNT].type} from={CUTS[CHAPTER_COUNT].from}
        durationInFrames={CUT} easing={CUT_EASING} />
      <TransitionSeries.Sequence durationInFrames={SCENES[SCENES.length - 1]}><Outro chapters={outro} /></TransitionSeries.Sequence>
    </TransitionSeries>
  );
}

function ChapterHud() {
  const frame = useCurrentFrame();
  // Only over the twelve chapter pages: MORE and the outro are full-bleed.
  const end = CHAPTER_AT[CHAPTERS.length];
  if (frame < CHAPTER_AT[0] || frame >= end) return null;
  const opacity = progress(frame, CHAPTER_AT[0], 10) * (1 - progress(frame, end - CUT, CUT));
  return <Group opacity={opacity}><Hud version="0.7.0" starts={CHAPTER_AT.slice(0, -1)} lengths={CHAPTER_LENGTHS.slice(0, -1)} /></Group>;
}

const JA_STRINGS = [...PRS.map(([, title]) => title), ...MORE_STRINGS, ...CAPTIONS.map((cue) => cue.text)];

function Fonts() {
  // Latin faces by family name (#341); Japanese subset to the film's glyphs.
  return (
    <Assets>
      <Font google="Bebas Neue" />
      <Font google="Space Grotesk" weights={[400, 500, 700]} />
      <Font google="JetBrains Mono" weights={[400, 700]} subsets={['latin', 'greek']} />
      <Font src={japaneseFonts(JA_STRINGS)} />
    </Assets>
  );
}

export default function Root() {
  return (
    <>
      <Composition id="film" width={W} height={H} fps={FPS} durationInFrames={DURATION} lang="ja-JP">
        <Fonts />
        <FilmContext.Provider value={Film}>
          <Film />
        </FilmContext.Provider>
        <ChapterHud />
        <Subtitles cues={CAPTIONS} />
        <Audio src={SCORE_SRC} />
      </Composition>
      {/* A still of the outro. As long as the film, so the frames its thumbnails
          freeze exist in it too; export any one frame of it. */}
      <Composition id="poster" width={W} height={H} fps={FPS} durationInFrames={DURATION} lang="ja-JP">
        <Fonts />
        <FilmContext.Provider value={Film}>
          <FreezeFrame frame={POSTER_AT}><Film /></FreezeFrame>
        </FilmContext.Provider>
      </Composition>
    </>
  );
}
