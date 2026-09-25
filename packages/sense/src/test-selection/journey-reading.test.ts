import { describe, expect, it } from 'vitest';
import { nativeAvailable } from '../native.js';
import { readJourneyChange } from './journey-reading.js';

/**
 * `api.ts` reads a bound at the top level and hands it to `get`. The diffs are
 * written against that text, which is what the caller finds in the blob the
 * patch names.
 */
const FILE = 'src/api.ts';
const BEFORE = [
  "import { send } from './http';",
  '',
  'const LIMIT = 10;',
  '',
  'export function get(path: string): string {',
  '  return send(path, LIMIT);',
  '}',
  '',
].join('\n');

const diff = (hunk: string): string =>
  [`diff --git a/${FILE} b/${FILE}`, 'index 1111111..2222222 100644', `--- a/${FILE}`, `+++ b/${FILE}`, hunk, ''].join('\n');

const COMMENT = diff(
  [
    '@@ -3,5 +3,8 @@',
    ' const LIMIT = 10;',
    ' ',
    '+/**',
    '+ * Sends `path` with the shared bound.',
    '+ */',
    ' export function get(path: string): string {',
    '   return send(path, LIMIT);',
    ' }',
  ].join('\n'),
);

describe.runIf(nativeAvailable())('reading a change for the journey selector', () => {
  it('proves a comment above a function changes nothing that runs', () => {
    const reading = readJourneyChange(COMMENT, () => BEFORE);
    expect(reading.readings).toEqual([{ file: FILE, verdict: 'none', names: [] }]);
    expect([...reading.read]).toEqual([[FILE, 'none']]);
  });

  it('proves a changed body leaves what the module does as it loads', () => {
    const body = diff(['@@ -5,3 +5,3 @@', ' export function get(path: string): string {', '-  return send(path, LIMIT);', '+  return send(path, LIMIT + 1);', ' }'].join('\n'));
    expect([...readJourneyChange(body, () => BEFORE).read]).toEqual([[FILE, 'bodies']]);
  });

  it('leaves a moved value to its lines', () => {
    const value = diff(['@@ -3,1 +3,1 @@', '-const LIMIT = 10;', '+const LIMIT = 20;'].join('\n'));
    const reading = readJourneyChange(value, () => BEFORE);
    expect(reading.readings).toEqual([expect.objectContaining({ file: FILE, verdict: 'values' })]);
    expect(reading.read.size).toBe(0);
  });

  it('reads only a file the module reader claims', () => {
    const lock = ['diff --git a/yarn.lock b/yarn.lock', 'index 1111111..2222222 100644', '--- a/yarn.lock', '+++ b/yarn.lock', '@@ -1,1 +1,1 @@', '-a', '+b', ''].join('\n');
    expect(readJourneyChange(lock, () => 'a\n')).toEqual({ read: new Map(), readings: [] });
  });

  it('names what it could not read, and leaves those lines charged as they fall', () => {
    expect(readJourneyChange(COMMENT, () => undefined)).toEqual({ read: new Map(), readings: [{ file: FILE, unread: 'source' }] });
    const drifted = BEFORE.replace('const LIMIT = 10;', 'const LIMIT = 11;');
    expect(readJourneyChange(COMMENT, () => drifted).readings).toEqual([{ file: FILE, unread: 'hunk' }]);
  });
});
