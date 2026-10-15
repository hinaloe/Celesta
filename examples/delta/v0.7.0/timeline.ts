// Where things land, in composition frames. 0.7.0 is cut to a 180 BPM
// score: one beat = 10 frames, one bar = 40 frames. film-0.7.0.tsx checks
// the chapter starts against computeTransitionSeries() for the cuts it makes.
export const BEAT = 10;
export const BAR = 4 * BEAT;

export const OPEN_LENGTH = 6 * BAR;
/** Twelve chapters of four bars, then MORE: eight one-bar cards. */
export const CHAPTER_LENGTH = 4 * BAR;
export const MORE_CARDS = 8;
export const CHAPTER_LENGTHS: readonly number[] = [...Array<number>(12).fill(CHAPTER_LENGTH), MORE_CARDS * BAR];
export const CHAPTER_COUNT = CHAPTER_LENGTHS.length;
export const OUTRO_LENGTH = 6 * BAR;

/** The frame chapter `i`'s cut lands on (its downbeat). */
export const chapterAt = (i: number) => OPEN_LENGTH + CHAPTER_LENGTHS.slice(0, i).reduce((sum, n) => sum + n, 0);
export const OUTRO_AT = chapterAt(CHAPTER_COUNT);
export const DURATION = OUTRO_AT + OUTRO_LENGTH;
