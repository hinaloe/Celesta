import { fileURLToPath } from 'node:url';
import { defineConfig } from '@natsuneko-laboratory/makit';
import { remarkInclude } from './plugins/remark-include.ts';

export default defineConfig({
  title: 'Celesta',
  description:
    'Celesta renders React components to video. Scrub to any frame in the browser or the desktop app, then export an MP4. Free and open source.',
  siteUrl: 'https://celesta.natsuneko.cat',
  sourceDir: 'content',
  outDir: 'dist',
  i18n: {
    defaultLocale: 'en',
    locales: [
      { locale: 'en', label: 'English' },
      { locale: 'ja', label: '日本語' },
    ],
    root: { behavior: 'detect' },
  },
  navigation: {
    auto: { numericPrefixes: true },
    pagination: { enabled: true, crossSection: true },
  },
  markdown: {
    code: { copyButton: true },
    remarkPlugins: [[remarkInclude, { root: fileURLToPath(new URL('.', import.meta.url)) }]],
    shiki: { themes: { light: 'vitesse-light', dark: 'vitesse-dark' } },
  },
  llms: { enabled: true },
  github: { repository: 'mika-f/Celesta' },
});
