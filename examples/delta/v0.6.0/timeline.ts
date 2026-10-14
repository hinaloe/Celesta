import { BAR } from '../components/theme';
import { OPEN_LENGTH } from './Open';

// Where things land, in composition frames. film-0.6.0.tsx checks these
// against computeTransitionSeries() for the cuts it actually makes.
export const CHAPTER_COUNT = 12;
export const CHAPTER_LENGTH = 2 * BAR;
/** The frame chapter `i`'s cut lands on (its downbeat). */
export const chapterAt = (i: number) => OPEN_LENGTH + i * CHAPTER_LENGTH;
export const OUTRO_AT = chapterAt(CHAPTER_COUNT);
