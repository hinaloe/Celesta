// Evaluates a template entry through the real CLI, the way the editor does,
// answering the host requests (media probing, text measurement) with fakes.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../../packages/cli/bin/celesta-react-render.js', import.meta.url));

function fakeMetrics(text) {
  return { width: text.length * 10, height: 24, ascent: 18, descent: 6, lineHeight: 24, lines: 1, glyphs: [] };
}

function fakeProbe(path) {
  return existsSync(path)
    ? { media: { durationSeconds: 2, audio: [{ durationSeconds: 2 }] } }
    : { error: `cannot probe ${path}` };
}

/**
 * Runs `entry` through the CLI with the given property-input layers and
 * resolves with the first `config`, `error` or `invalidProperties` it reports.
 */
export async function evaluate(entry, layers) {
  const child = spawn(process.execPath, [cli, entry, '--properties-stdin'], { stdio: ['pipe', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const send = (value) => child.stdin.write(`${JSON.stringify(value)}\n`);
  send({ propertyInputs: layers });
  try {
    for await (const line of createInterface({ input: child.stdout })) {
      const message = JSON.parse(line);
      if (message.probeMedia) {
        send(fakeProbe(message.probeMedia.path));
      } else if (message.measureText) {
        send({ metrics: fakeMetrics(message.measureText.text) });
      } else if (message.config) {
        // The CLI reports a rational frame rate; tests compare plain fps.
        const { numerator, denominator } = message.config.frameRate;
        return { ...message, config: { ...message.config, fps: numerator / denominator } };
      } else if (message.error || message.invalidProperties) {
        return message;
      }
    }
    throw new Error(`The CLI exited without reporting a config. ${stderr}`);
  } finally {
    child.stdin.end();
    child.kill();
  }
}

/** The property-input layer the editor builds from a project's props.json. */
export function entryPropsLayer(dir) {
  const file = join(dir, 'props.json');
  return { source: 'entryProps', file, baseDir: dir, values: JSON.parse(readFileSync(file, 'utf8')) };
}
