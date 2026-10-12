import { defineTheme } from '@natsuneko-laboratory/makit/theme';

/** Tungsten — amber tally light on graphite. Slots live in `index.tsx`; this file is read by the Makit CLI. */
export default defineTheme({
  name: 'tungsten',
  styles: ['./tungsten.css', './docs.css'],
});
