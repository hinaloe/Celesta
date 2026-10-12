import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { sampleSources } from './plugins/sample-sources.ts';
import { sitePages } from './plugins/site-pages.ts';

/** The repository root: examples and other packages' sources are read from here. */
const root = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig({
  plugins: [sampleSources(root), react(), tailwindcss(), sitePages(root)],
  build: { rolldownOptions: { input: ['index.html', 'docs/index.html', 'showcase/index.html'] } },
});
