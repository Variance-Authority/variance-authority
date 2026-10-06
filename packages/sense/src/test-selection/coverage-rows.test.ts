import { transformSync } from '@swc/core';
import { describe, expect, it } from 'vitest';
import { instrument } from '../instrument/index.js';
import { coverageBlocks } from './coverage-rows.js';
import { recordedFrame, type TransformSourceMap } from './source-lines.js';

const FILE = '/checkout/src/price.ts';

const SOURCE = `export interface Order { readonly total?: number; readonly tier?: { readonly rate: number } }

export function price(order: Order | undefined): number {
  const total = order?.total ?? 0;
  if (total > 100) {
    return total * (order?.tier?.rate ?? 1);
  } else {
    return total;
  }
}

export class Cart {
  add(items: number[], value?: number): void {
    for (const item of [value]) items.push(item ?? 0);
  }
}
`;

/** One build of {@link SOURCE}: the emitted text and its map back to the file. */
function build(target: 'es2015' | 'es2022', source = SOURCE): { code: string; map: TransformSourceMap } {
  const out = transformSync(source, {
    filename: FILE,
    sourceMaps: true,
    jsc: { target, parser: { syntax: 'typescript' } },
  });
  return { code: out.code, map: JSON.parse(out.map!) as TransformSourceMap };
}

function rows(target: 'es2015' | 'es2022', source = SOURCE) {
  const { code, map } = build(target, source);
  const frame = recordedFrame(code, map, FILE, () => source);
  const done = instrument(code, FILE)!;
  return coverageBlocks(done.blocks, frame);
}

describe('coverageBlocks', () => {
  // A package's own tests load its source through one transform and every other
  // package's tests load its build through another. Both are filed under the
  // source, with one source digest and one set of lines; a region digest that
  // depended on the emitted text would read every region as edited the moment
  // the two met in one merge.
  it('digests a region from the source it maps to, whichever build was instrumented', () => {
    const lowered = rows('es2015');
    const modern = rows('es2022');
    expect(build('es2015').code).not.toBe(build('es2022').code);

    const identity = (row: (typeof lowered)[number]) => [row.name, row.path, row.startLine, row.endLine, row.digest];
    expect(lowered.map(identity)).toEqual(modern.map(identity));
  });

  // The lines inside a region a region owns are that region's, so an edit there
  // is charged to it and to nothing around it.
  it('charges an edit to the region whose own lines it lands on', () => {
    const before = rows('es2022');
    const after = rows('es2022', SOURCE.replace('return total * (order?.tier?.rate ?? 1);', 'return total * (order?.tier?.rate ?? 2);'));
    const changed = before
      .filter((row, index) => row.digest !== after[index]!.digest)
      .map((row) => `${row.name} ${row.path}`);
    expect(changed).toEqual(['price if#0/then']);
  });
});
