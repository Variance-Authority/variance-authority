import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { type Declaration, type Parses, declarationsIn, parseFile } from './declare.js';

const ALPHA = join(dirname(fileURLToPath(import.meta.url)), './__fixtures__/workspace/packages/alpha/src');

const held = mkdtempSync(join(tmpdir(), 'variance-declare-'));
afterAll(() => rmSync(held, { recursive: true, force: true }));

let written = 0;

/** One file on disk, read the way a package's source is read. */
function read(source: string): Map<string, Declaration> {
  const file = join(held, `at-${(written += 1)}.ts`);
  writeFileSync(file, source);
  return declarationsIn(parseFile(new Map(), file, 'at.ts'));
}

/** The same, reduced to the one word each name turned out to be. */
function kinds(source: string): Map<string, string> {
  return new Map([...read(source)].map(([name, declaration]) => [name, declaration.kind]));
}

describe('what a file declares', () => {
  const parses: Parses = new Map();
  const file = join(ALPHA, 'values.ts');
  const found = declarationsIn(parseFile(parses, file, 'values.ts'));

  it('says what kind of thing each name is, in one word', () => {
    expect(Object.fromEntries([...found].map(([name, { kind }]) => [name, kind]))).toEqual({
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

  it('says where each name is written', () => {
    expect(found.get('measure')?.at).toBe('values.ts');
    expect(found.get('Frame')?.line).toBe(19);
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

describe('the head a declaration was written with', () => {
  it('stops at the body, which is the part nobody calling it needs', () => {
    expect(read('export function measure(a: number): number { return a; }').get('measure')?.signature).toBe(
      'function measure(a: number): number',
    );
  });

  it('carries the clauses a class opens with', () => {
    const found = read('export class Reading extends Base implements Thing { x = 1; }');
    expect(found.get('Reading')?.signature).toBe('class Reading extends Base implements Thing');
  });

  it('is the whole of a declaration that has no body', () => {
    expect(read('export type Span = readonly [number, number];').get('Span')?.signature).toBe(
      'type Span = readonly [number, number]',
    );
  });

  it('runs into a function a `const` is bound to, because that is the shape to call', () => {
    expect(read('export const make = (x: number): string => String(x);').get('make')?.signature).toBe(
      'const make = (x: number): string =>',
    );
  });

  it('stops at the name and its type when a `const` is bound to a value', () => {
    // The value may be a thousand-line literal, and none of it is the contract.
    expect(read('export const first: number = 1;').get('first')?.signature).toBe('const first: number');
  });

  it('is absent for a default-exported object, which is a value and not a shape', () => {
    expect(read('export default { fetch: () => undefined };').get('default')?.signature).toBeUndefined();
  });

  it('survives being written across lines, as written', () => {
    const found = read('export function wide(\n  a: number,\n  b: number,\n): number { return a + b; }');
    expect(found.get('wide')?.signature).toBe('function wide(\n  a: number,\n  b: number,\n): number');
  });
});

describe('the doc block above a declaration', () => {
  it('is the prose, without the punctuation that held it together', () => {
    const found = read('/**\n * Measures it.\n *\n * @returns how much\n */\nexport function measure() {}');
    expect(found.get('measure')?.doc).toBe('Measures it.\n\n@returns how much');
  });

  it('is read against the statement, because that is where `export` is', () => {
    expect(read('/** Kept. */\nexport const first = 1;').get('first')?.doc).toBe('Kept.');
  });

  it('is absent when nothing was written, which is the whole finding', () => {
    expect(read('export const first = 1;').get('first')?.doc).toBeUndefined();
  });

  it('is not a line comment, which is a note to whoever is editing', () => {
    expect(read('// Not a doc.\nexport const first = 1;').get('first')?.doc).toBeUndefined();
  });

  it('is not a plain block comment, which is commented-out code as often as not', () => {
    expect(read('/* export const old = 0; */\nexport const first = 1;').get('first')?.doc).toBeUndefined();
  });

  it('belongs to the declaration it sits above and not to the one after that', () => {
    const found = read('/** First. */\nexport const first = 1;\nexport const second = 2;');
    expect(found.get('first')?.doc).toBe('First.');
    expect(found.get('second')?.doc).toBeUndefined();
  });

  it('is the nearest one when two are stacked', () => {
    const found = read('/** Older. */\n/** Newer. */\nexport const first = 1;');
    expect(found.get('first')?.doc).toBe('Newer.');
  });

  it('is shared by every name one statement binds, because one comment was written', () => {
    const found = read('/** Both. */\nexport const { third, others } = { third: 7, others: 8 };');
    expect(found.get('third')?.doc).toBe('Both.');
    expect(found.get('others')?.doc).toBe('Both.');
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
