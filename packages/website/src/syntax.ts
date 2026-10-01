import { language as bash } from '@twinkleplop/bash';
import { language as json } from '@twinkleplop/json';
import { language as tsx } from '@twinkleplop/tsx';

type Highlighter = ReturnType<typeof tsx>;
type RenderOptions = Parameters<Highlighter>[1];

const highlighters: Record<string, Highlighter> = { tsx: tsx(), json: json(), shell: bash() };

function escape(text: string) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Highlights `code` with twinkleplop and returns a `<pre>` HTML string. Unknown languages render as plain text. */
export function highlight(code: string, language: string, options?: RenderOptions): string {
  const highlighter = highlighters[language];
  if (highlighter) return highlighter(code, options);
  const attributes = Object.entries(options?.attributes ?? {}).map(([name, value]) => ` ${name}="${escape(String(value)).replace(/"/g, '&quot;')}"`).join('');
  return `<pre class="${options?.class_name ?? 'twinkleplop'}"${attributes}><code>${escape(code)}</code></pre>`;
}
