import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { type Parses, declarationsIn, parseFile } from './declare.js';

const ALPHA = join(dirname(fileURLToPath(import.meta.url)), './__fixtures__/workspace/packages/alpha/src');

const held = mkdtempSync(join(tmpdir(), 'variance-declare-'));
afterAll(() => rmSync(held, { recursive: true, force: true }));

let written = 0;

/** One file on disk, read the way a package's source is read. */
function kinds(source: string): Map<string, string> {
  const file = join(held, `at-${(written += 1)}.ts`);
  writeFileSync(file, source);
  return declarationsIn(parseFile(new Map(), file, 'at.ts'), 'at.ts');
}

describe('what a file declares', () => {
  const parses: Parses = new Map();
  const file = join(ALPHA, 'values.ts');
  const found = declarationsIn(parseFile(parses, file, 'values.ts'), 'values.ts');

  it('says what kind of thing each name is, in one word', () => {
    expect(Object.fromEntries(found)).toEqual({
      measure: 'function',
      Reading: 'class',
      Frame: 'interface',
      Span: 'type',
      Level: 'enum',
      grouped: 'namespace',
      first: 'const',
      mutable: 'let',
      older: 'var',
      second: 'const',
      rest: 'const',
      third: 'const',
      others: 'const',
    });
  });

  it('leaves out a declaration that introduces no binding', () => {
    // `declare module 'somewhere'` names itself with a string literal. Asking
    // it for an identifier is how a reader like this crashes on real source.
    expect(found.has('somewhere')).toBe(false);
  });

  it('holds a parse, so a barrel read twice is read once', () => {
    expect(parseFile(parses, file, 'values.ts')).toBe(parses.get(file));
    expect(parses.size).toBe(1);
  });
});

describe('a default export', () => {
  it('is whatever the expression under it is', () => {
    expect(kinds('export default { fetch: () => undefined };').get('default')).toBe('object');
    expect(kinds('export default () => undefined;').get('default')).toBe('function');
    expect(kinds('export default class {}').get('default')).toBe('class');
  });

  it('is a declaration when one is written', () => {
    expect(kinds('export default function named() {}').get('default')).toBe('function');
  });

  it('is refused rather than guessed when nothing names it', () => {
    expect(() => kinds('export default 1;')).toThrow(/default-exports a `Literal`/);
  });
});

describe('source that does not parse', () => {
  it('is an error naming the file rather than a silence', () => {
    expect(() => kinds('export const = ;')).toThrow(/at.ts does not parse/);
  });
});
