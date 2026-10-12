import { useEffect, useId, useState } from 'react';
import Editor, { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker';
import JsonWorker from 'monaco-editor/language/json/json.worker.js?worker';
import TypeScriptWorker from 'monaco-editor/language/typescript/ts.worker.js?worker';

self.MonacoEnvironment = {
  getWorker(_, label) {
    if (label === 'json') return new JsonWorker();
    if (label === 'typescript' || label === 'javascript') return new TypeScriptWorker();
    return new EditorWorker();
  },
};
loader.config({ monaco });

for (const defaults of [monaco.typescript.typescriptDefaults, monaco.typescript.javascriptDefaults]) {
  defaults.setCompilerOptions({ jsx: monaco.typescript.JsxEmit.ReactJSX, target: monaco.typescript.ScriptTarget.ESNext, allowNonTsExtensions: true });
  // Compilation reports project errors; the editor has no Celesta/React type declarations.
  defaults.setDiagnosticsOptions({ noSemanticValidation: true });
}

// Tungsten surfaces with Vitesse syntax colors, matching the documentation's Shiki themes.
monaco.editor.defineTheme('tungsten-dark', {
  base: 'vs-dark', inherit: true,
  rules: [
    { token: 'comment', foreground: '758575', fontStyle: 'italic' }, { token: 'keyword', foreground: '4d9375' },
    { token: 'string', foreground: 'c98a7d' }, { token: 'number', foreground: '4c9a91' }, { token: 'regexp', foreground: 'c4704f' },
    { token: 'type', foreground: '5da994' }, { token: 'type.identifier', foreground: '5da994' }, { token: 'identifier', foreground: 'bd976a' },
    { token: 'delimiter', foreground: '666666' }, { token: 'tag', foreground: '4d9375' }, { token: 'attribute.name', foreground: 'bd976a' },
  ],
  colors: {
    'editor.background': '#111110', 'editor.foreground': '#efe9df', 'editor.selectionBackground': '#ffb0203d',
    'editor.lineHighlightBackground': '#1a1917', 'editorCursor.foreground': '#ffb020',
    'editorLineNumber.foreground': '#5c574f', 'editorLineNumber.activeForeground': '#958e82',
  },
});
monaco.editor.defineTheme('tungsten-light', {
  base: 'vs', inherit: true,
  rules: [
    { token: 'comment', foreground: 'a0ada0', fontStyle: 'italic' }, { token: 'keyword', foreground: '1e754f' },
    { token: 'string', foreground: 'b56959' }, { token: 'number', foreground: '2f798a' }, { token: 'regexp', foreground: 'ab5e3f' },
    { token: 'type', foreground: '2e8f82' }, { token: 'type.identifier', foreground: '2e8f82' }, { token: 'identifier', foreground: 'b07d48' },
    { token: 'delimiter', foreground: '999999' }, { token: 'tag', foreground: '1e754f' }, { token: 'attribute.name', foreground: 'b07d48' },
  ],
  colors: {
    'editor.background': '#f4f2ed', 'editor.foreground': '#1a1916', 'editor.selectionBackground': '#ffb02052',
    'editor.lineHighlightBackground': '#eae7e0', 'editorCursor.foreground': '#945700',
    'editorLineNumber.foreground': '#a8a195', 'editorLineNumber.activeForeground': '#6b655b',
  },
});

/** The page's resolved color scheme: Tungsten sets `color-scheme` on `<html>` from `data-theme` and the system preference. */
function useColorScheme() {
  const read = () => getComputedStyle(document.documentElement).colorScheme.includes('dark') ? 'dark' : 'light';
  const [scheme, setScheme] = useState(read);
  useEffect(() => {
    const update = () => setScheme(read());
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class', 'style'] });
    const media = matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', update);
    return () => { observer.disconnect(); media.removeEventListener('change', update); };
  }, []);
  return scheme;
}

export default function SourceEditor({ name, source, readOnly, loading, label, onChange }: {
  name: string; source: string; readOnly: boolean; loading: string; label: string; onChange: (source: string) => void;
}) {
  const id = useId();
  const scheme = useColorScheme();
  const root = `file:///celesta/${encodeURIComponent(id)}/`;
  useEffect(() => () => {
    // Monaco retains inactive file models so switching files preserves undo and scroll.
    for (const model of monaco.editor.getModels()) {
      if (model.uri.path.startsWith(monaco.Uri.parse(root).path)) model.dispose();
    }
  }, [root]);

  const language = name.endsWith('.json') ? 'json' : /\.[cm]?jsx?$/.test(name) ? 'javascript' : 'typescript';
  return <Editor path={`${root}${name.split('/').map(encodeURIComponent).join('/')}`} language={language} value={source} theme={`tungsten-${scheme}`}
    loading={loading}
    onChange={value => { if (value !== undefined) onChange(value); }}
    options={{
      readOnly, ariaLabel: label, automaticLayout: true, editContext: false,
      fontFamily: "ui-monospace, 'SF Mono', SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace", fontSize: 12.5, lineHeight: 21,
      minimap: { enabled: false }, scrollBeyondLastLine: false, tabSize: 2,
      padding: { top: 16, bottom: 16 }, fixedOverflowWidgets: true,
    }} />;
}
