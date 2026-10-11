import { describe, expect, it } from 'vitest';
import { digestString } from '../digest.js';
import { recordedFrame, sourceLines, type ExtentOf } from './source-lines.js';

// The map for a transform that dropped one blank line: four generated lines
// standing for original lines 1, 3, 4 and 5.
const DROPPED_BLANK = {
  sources: ['a.ts'],
  mappings: 'AAAA;AAEA;AACA;AACA',
};

const ORIGINAL = ['const a = 1;', '', 'const f = () => {', '  g();', '};'].join('\n');
const TRANSFORMED = ORIGINAL.split('\n')
  .filter((line) => line !== '')
  .join('\n');

/** The line one offset lands on, as a region of one character would be recorded. */
const lineIn = (extentOf: ExtentOf) => (offset: number): number | undefined =>
  extentOf(offset, offset)?.[0];

/**
 * Which entry of a map's `sources` is the file. A source is a path relative to
 * the map, behind `sourceRoot`, and it is the file when it resolves to it: a
 * source whose path merely ends the same way is another file.
 */
describe('the source a map names as the file', () => {
  const FILE = '/repo/app/src/a.ts';

  it('gives no lines when no source resolves to the file, though one ends like it', () => {
    // Beside `/repo/app/src/a.ts`, `app/src/a.ts` is `/repo/app/src/app/src/a.ts`.
    const extentOf = sourceLines(TRANSFORMED, { sources: ['app/src/a.ts'], mappings: DROPPED_BLANK.mappings }, FILE);

    expect(lineIn(extentOf)(TRANSFORMED.indexOf('const f'))).toBeUndefined();
  });

  it('gives no lines when the map names only another file', () => {
    const extentOf = sourceLines(TRANSFORMED, { sources: ['other.ts'], mappings: DROPPED_BLANK.mappings }, FILE);

    expect(lineIn(extentOf)(TRANSFORMED.indexOf('const f'))).toBeUndefined();
  });

  it('resolves each source beside the transformed text, where its map is', () => {
    // From `dist/a.js`, `src/a.ts` is `dist/src/a.ts`; only `../src/a.ts` is the file.
    const extentOf = sourceLines(
      TRANSFORMED,
      { sources: ['src/a.ts', '../src/a.ts'], mappings: 'AAAA;ACEA' },
      FILE,
      '/repo/app/dist/a.js',
    );
    const lineOf = lineIn(extentOf);

    expect(lineOf(TRANSFORMED.indexOf('const a'))).toBeUndefined();
    expect(lineOf(TRANSFORMED.indexOf('const f'))).toBe(3);
  });

  it('resolves a source behind the map’s `sourceRoot`', () => {
    const extentOf = sourceLines(
      TRANSFORMED,
      { sourceRoot: '../src/', sources: ['a.ts'], mappings: DROPPED_BLANK.mappings },
      FILE,
      '/repo/app/dist/a.js',
    );

    expect(lineIn(extentOf)(TRANSFORMED.indexOf('const f'))).toBe(3);
  });

  it('reads a source as the URL the format says it is', () => {
    const extentOf = sourceLines(
      TRANSFORMED,
      { sources: ['a%20b.ts'], mappings: DROPPED_BLANK.mappings },
      '/repo/app/src/a b.ts',
    );

    expect(lineIn(extentOf)(TRANSFORMED.indexOf('const f'))).toBe(3);
  });

  it('gives no lines for a source on another host, though its path is the file', () => {
    const extentOf = sourceLines(TRANSFORMED, { sources: ['//repo/app/src/a.ts'], mappings: DROPPED_BLANK.mappings }, FILE);

    expect(lineIn(extentOf)(TRANSFORMED.indexOf('const f'))).toBeUndefined();
  });

  it('gives no lines for a virtual module, though its id ends in the file’s path', () => {
    const extentOf = sourceLines(TRANSFORMED, { sources: [`\0${FILE}`], mappings: DROPPED_BLANK.mappings }, FILE);

    expect(lineIn(extentOf)(TRANSFORMED.indexOf('const f'))).toBeUndefined();
  });

  it('opens a region in the prologue at the file’s first origin, past another file’s', () => {
    // Line 2 is `other.ts`; line 3 is `a.ts` line 3.
    const code = 'helper();\nother();\nconst f = 1;';
    const extentOf = sourceLines(code, { sources: ['a.ts', 'other.ts'], mappings: ';ACAA;ADEA' }, FILE);

    expect(extentOf(0, code.indexOf('const f'))).toEqual([3, 3]);
  });

  it('frames a text under the host’s name when the one file its map names cannot be read', () => {
    const frame = recordedFrame(
      TRANSFORMED,
      { sources: ['../lib/x.ts'], mappings: DROPPED_BLANK.mappings },
      FILE,
      () => {
        throw new Error('ENOENT');
      },
    );

    expect(frame.file).toBe(FILE);
    expect(frame.sourceDigest).toBe(digestString(TRANSFORMED));
  });

  it('frames a text whose map names other files as that text, under the host’s name', () => {
    const frame = recordedFrame(
      TRANSFORMED,
      { sources: ['../lib/x.ts', '../lib/y.ts'], mappings: 'AAAA;ACEA' },
      FILE,
      () => ORIGINAL,
    );

    expect(frame.file).toBe(FILE);
    expect(frame.sourceDigest).toBe(digestString(TRANSFORMED));
    expect(lineIn(frame.extentOf)(TRANSFORMED.indexOf('const f'))).toBe(2);
  });
});
