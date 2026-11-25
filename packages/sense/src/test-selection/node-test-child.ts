/**
 * What each `node --test` child loads first (`--import`): records the one test
 * file this process runs.
 *
 * The file is the child's own script, `process.argv[1]`. Hooks go in before it
 * loads, `node:test` is redirected to `node-test-wrapper.cts` so every case is
 * observed, and the journal is written when the process exits.
 */

import { registerHooks } from 'node:module';
import { observeTestFile, registerRecording } from './runner.js';

const file = process.argv[1];
const observer = file === undefined ? undefined : observeTestFile(file);
if (observer !== undefined) {
  registerRecording();
  (globalThis as Record<symbol, unknown>)[Symbol.for('variance-authority.node-test.observer')] = observer;
  const wrapper = new URL('./node-test-wrapper.cjs', import.meta.url).href;
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier !== 'node:test' || context.parentURL === wrapper) return nextResolve(specifier, context);
      return { url: wrapper, shortCircuit: true, format: 'commonjs' };
    },
  });
  process.on('exit', () => observer.finish());
}
