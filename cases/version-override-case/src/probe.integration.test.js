import { describe, expect, it } from 'vitest';
import { probe } from './probe.mjs';

// The disk holds the head; the manifest holds the base of every test-side file.
const head = { 'kept head': 'passed', added: 'passed' };
const base = { 'kept base': 'passed', 'hides added helper': 'passed', 'base helper': 'passed', gone: 'passed', deep: 'passed' };

// A runner that resolves an import itself, below `fs` and the module loader,
// does not see a file only the base holds: Jest through its native resolver,
// Vitest through Vite's for an import.
const escapes = {
  jest: { cjs: 'base helper', esm: 'base helper', ts: 'base helper' },
  vitest: { esm: 'base helper', ts: 'base helper' },
};

describe.each(['jest', 'vitest', 'mocha', 'node'])('%s with the manifest applied', (runner) => {
  it.each(['cjs', 'esm', 'ts'])('runs the base tests on the head source, %s', { timeout: 120_000 }, (flavor) => {
    const result = probe(runner, flavor);
    const escaped = escapes[runner]?.[flavor];

    expect(result.override.cases, result.override.output).toEqual(escaped ? { ...base, [escaped]: 'failed' } : base);
    expect(result.control.cases, result.control.output).toEqual(head);
    expect(result.after.cases, 'a cache handed the base to a head run').toEqual(head);
    expect(result.untouched).toBe(true);
  });
});

describe('the `node --test` CLI', () => {
  // It globs its arguments through `lib/internal/fs/glob.js`, which takes
  // `lstatSync` and `readdirSync` from `fs` before any preload runs: a file only
  // the manifest holds is dropped without a word. `run({ files })` serves it.
  it.each(['cjs', 'esm', 'ts'])('drops a base-only file and serves the rest, %s', { timeout: 120_000 }, (flavor) => {
    const result = probe('node --test', flavor);

    expect(result.override.cases, result.override.output).toEqual({ 'kept base': 'passed', 'hides added helper': 'passed', 'base helper': 'passed' });
    expect(result.untouched).toBe(true);
  });
});
