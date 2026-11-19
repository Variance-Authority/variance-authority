import { describe, expect, it } from 'vitest';
import { probe } from './probe.mjs';

// The disk holds the head; the manifest holds the base of every test-side file.
const head = { 'kept head': 'passed' };
const base = { 'kept base': 'passed', 'hides added helper': 'passed', gone: 'passed' };

describe.each(['jest', 'vitest', 'mocha', 'node'])('%s with the manifest applied', (runner) => {
  it.each(['cjs', 'esm', 'ts'])('runs the base tests on the head source, %s', { timeout: 120_000 }, (flavor) => {
    const result = probe(runner, flavor);

    expect(result.override.cases, result.override.output).toEqual(base);
    expect(result.control.cases).toMatchObject(head);
    expect(result.after.cases, 'a cache handed the base to a head run').toMatchObject(head);
    expect(result.untouched).toBe(true);
  });
});

describe('the `node --test` CLI', () => {
  // It globs its arguments through `lib/internal/fs/glob.js`, which takes
  // `lstatSync` and `readdirSync` from `fs` before any preload runs: a file only
  // the manifest holds is dropped without a word. `run({ files })` serves it.
  it.each(['cjs', 'esm', 'ts'])('drops a base-only file and serves the rest, %s', { timeout: 120_000 }, (flavor) => {
    const result = probe('node --test', flavor);

    expect(result.override.cases, result.override.output).toEqual({ 'kept base': 'passed', 'hides added helper': 'passed' });
    expect(result.untouched).toBe(true);
  });
});
