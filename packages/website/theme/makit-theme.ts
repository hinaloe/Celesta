import { defineTheme } from '@natsuneko-laboratory/makit/theme';

/** Noir — white on black, one electric blue. Slots live in `index.tsx`; this file is read by the Makit CLI. */
export default defineTheme({
  name: 'noir',
  styles: ['./noir.css', './docs.css'],
});
