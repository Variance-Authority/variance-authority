// The signup page as a recording run serves it: its markup, then each app file
// probed the way a recording build probes it.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { executionCollectorSource, testSelectionProbes } from '@variance-authority/sense/journal';

const here = dirname(fileURLToPath(import.meta.url));
const root = dirname(here);
const FILES = ['validate.js', 'session.js', 'http.js', 'form.js'];

export const MARKUP = `<form onsubmit="return false">
${['name', 'email', 'surname', 'phone'].map((n) => `  <label>${n} <input id="${n}" name="${n}"></label><span id="${n}-hint" role="alert"></span>`).join('\n')}
  <button id="send" type="button">Sign up</button>
  <p id="status" role="status"></p>
</form>`;

/** The collector, then every app file, less the collector import a bundler would resolve. */
export function script() {
  const probes = testSelectionProbes({ root });
  // Each file in a scope of its own, as a module has: every probed file
  // declares the same probe names, and the files meet on globalThis.
  const files = FILES.map((file) => {
    const path = join(here, 'app', file);
    const { code } = probes.transform.handler(readFileSync(path, 'utf8'), path);
    return `(function () {\n${code.replace(/\n;import "[^"]+";\s*$/, '')}\n})();`;
  });
  return `{${executionCollectorSource()}}\n${files.join('\n')}`;
}
