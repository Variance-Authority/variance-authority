import { describe, expect, it } from 'vitest';
import { spliced } from './instrument/spliced.js';
import { readModule } from './read.js';

describe('the size a module read records', () => {
  const source = [
    '// A header comment is not code.',
    '',
    'export function measure(value: number): number {',
    '  /* nor is',
    '     a block comment */',
    '  if (value > 0) {',
    '    return value;',
    '  }',
    '  return 0;',
    '}',
    'export const half = (value: number) => value / 2;',
    '',
  ].join('\n');

  it('counts bytes, the lines holding code, and the regions the instrument cuts', () => {
    const cut = spliced(source, 'values.ts', 'presence')!;
    expect(readModule('values.ts', source).size).toEqual({
      bytes: Buffer.byteLength(source),
      lines: 7,
      blocks: cut.blocks.filter((block) => block.end > block.start).length,
    });
  });

  it('keeps bytes and lines and counts no region for a module that does not parse', () => {
    const broken = 'export const = ;\n';
    expect(readModule('broken.ts', broken).size).toEqual({ bytes: broken.length, lines: 1 });
  });
});
