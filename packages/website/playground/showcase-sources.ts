import { showcase } from '../site/showcase-catalog.ts';

// Relative to this file: packages/website/playground → the repository's examples/.
const examples = '../../../examples/';
const sources = import.meta.glob('../../../examples/**/*.{ts,tsx}', { query: '?raw', import: 'default' });

export async function loadShowcase(slug: string): Promise<Record<string, string>> {
  if (!showcase.some(sample => sample.slug === slug && !('desktop' in sample))) throw new Error('This composition requires the desktop app.');
  const prefix = `${examples}${slug}/`;
  const files = await Promise.all(Object.entries(sources).filter(([path]) => path.startsWith(prefix)).map(async ([path, load]) => [path.slice(prefix.length), await load()] as [string, string]));
  if (!files.some(([path]) => path === 'film.tsx')) throw new Error('This composition has no browser source files.');
  return Object.fromEntries(files);
}
