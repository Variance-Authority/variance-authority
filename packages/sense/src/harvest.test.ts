import { describe, expect, it } from 'vitest';
import { readModule } from './read.js';

function text(source: string, span: { readonly start: number; readonly end: number } | undefined): string | undefined {
  return span === undefined ? undefined : source.slice(span.start, span.end).trimEnd().replace(/;$/, '');
}

describe('declaration facts harvested with a module record', () => {
  const source = [
    '/** Measures it. */',
    'export function measure(value: number): number { return value; }',
    'export interface Frame { width: number }',
    'export const make = (value: number): string => String(value);',
    'export const { first, ...others } = values;',
    'export default { fetch: () => undefined };',
  ].join('\n');
  const symbols = readModule('values.ts', source).symbols ?? [];

  it('keeps kind, line and callable head without retaining the AST', () => {
    const measure = symbols.find((symbol) => symbol.name === 'measure');
    expect(measure).toMatchObject({ kind: 'function', line: 2 });
    expect(text(source, measure?.signature)).toBe('function measure(value: number): number');

    const make = symbols.find((symbol) => symbol.name === 'make');
    expect(text(source, make?.signature)).toBe('const make = (value: number): string =>');
  });

  it('carries one declaration fact for every destructured binding', () => {
    expect(symbols.filter((symbol) => symbol.line === 5).map((symbol) => symbol.name)).toEqual(['first', 'others']);
  });

  it('carries the doc content span and leaves object signatures absent', () => {
    const measure = symbols.find((symbol) => symbol.name === 'measure');
    expect(text(source, measure?.doc)).toBe('* Measures it.');
    const defaultExport = symbols.find((symbol) => symbol.name === 'default');
    expect(defaultExport).toMatchObject({ kind: 'object' });
    expect(defaultExport).not.toHaveProperty('signature');
  });

  it('uses JavaScript offsets even when earlier source is non-ASCII', () => {
    const unicode = 'const face = "😀";\nexport const value: number = 1;';
    const value = readModule('unicode.ts', unicode).symbols?.find((symbol) => symbol.name === 'value');
    expect(text(unicode, value?.signature)).toBe('const value: number');
  });

  it('keeps both names of a named default declaration', () => {
    const named = readModule('named.ts', 'export default function Named() {}').symbols ?? [];
    expect(named.map((symbol) => [symbol.name, symbol.kind])).toEqual([
      ['default', 'function'],
      ['Named', 'function'],
    ]);
  });

  it('names an anonymous default value as a constant', () => {
    expect(readModule('literal.ts', "export default 'value' as const;").symbols).toEqual([
      { name: 'default', kind: 'const', line: 1 },
    ]);
  });
});

describe('export statement facts', () => {
  it('keep the statement and its own doc for foreign names', () => {
    const source = '/** Reads it. */\nexport { readFileSync } from "node:fs";\n';
    const exported = readModule('index.ts', source).exports?.[0];
    expect(text(source, exported?.signature)).toBe('export { readFileSync } from "node:fs"');
    expect(text(source, exported?.doc)).toBe('* Reads it.');
  });
});
