import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readRecord, recordStore } from './instrumented-modules.js';
import { testSelectionProbes, type TransformingContext } from './probes.js';

/**
 * One source, read through two transforms, cut into the same regions.
 *
 * Vitest reads a workspace module twice in one run: a package's own tests load
 * `src/x.ts` through esbuild, and another package's tests load `dist/x.js`,
 * which `tsc` built, through the manifest. Both readings are filed under
 * `src/x.ts`, and the run records only the regions both cut, each where both
 * put it (`joinReadings` in `readings.ts`). A region the two place on different
 * lines is dropped, and its lines select through the region around it.
 * `hunksOf` in `packages/sense/src/test-selection/patch.ts` has this shape: two
 * CI runs of the same three test files, from before the readings were joined,
 * recorded its `else` on lines 57 to 61 and on 56 to 61.
 */

// The texts and maps vite 5's esbuild and tsc 7 (ES2022, NodeNext) produce for
// `SOURCE`, verbatim. esbuild opens lines 6 and 7 with the origin of the `if`
// above, carried over, and gives the nested `if` no segment of its own.
const SOURCE = [
  'export function tally(lines: readonly string[]): [number, number] {',
  '  let removed = 0;',
  '  let added = 0;',
  '  for (const line of lines) {',
  "    if (line.startsWith('-')) removed += 1;",
  "    else if (line.startsWith('+')) added += 1;",
  "    else if (!line.startsWith('\\\\')) {",
  '      removed += 1;',
  '      added += 1;',
  '    }',
  '  }',
  '  return [removed, added];',
  '}',
  '',
].join('\n');

const ESBUILD = {
  code: [
    'export function tally(lines) {',
    '  let removed = 0;',
    '  let added = 0;',
    '  for (const line of lines) {',
    '    if (line.startsWith("-")) removed += 1;',
    '    else if (line.startsWith("+")) added += 1;',
    '    else if (!line.startsWith("\\\\")) {',
    '      removed += 1;',
    '      added += 1;',
    '    }',
    '  }',
    '  return [removed, added];',
    '}',
    '',
  ].join('\n'),
  map: {
    sources: ['/repo/app/src/a.ts'],
    mappings:
      'AAAO,gBAAS,MAAM,OAA4C;AAChE,MAAI,UAAU;AACd,MAAI,QAAQ;AACZ,aAAW,QAAQ,OAAO;AACxB,QAAI,KAAK,WAAW,GAAG,EAAG,YAAW;AAAA,aAC5B,KAAK,WAAW,GAAG,EAAG,UAAS;AAAA,aAC/B,CAAC,KAAK,WAAW,IAAI,GAAG;AAC/B,iBAAW;AACX,eAAS;AAAA,IACX;AAAA,EACF;AACA,SAAO,CAAC,SAAS,KAAK;AACxB;',
  },
};

const TSC = {
  code: [
    'export function tally(lines) {',
    '    let removed = 0;',
    '    let added = 0;',
    '    for (const line of lines) {',
    "        if (line.startsWith('-'))",
    '            removed += 1;',
    "        else if (line.startsWith('+'))",
    '            added += 1;',
    "        else if (!line.startsWith('\\\\')) {",
    '            removed += 1;',
    '            added += 1;',
    '        }',
    '    }',
    '    return [removed, added];',
    '}',
    '//# sourceMappingURL=a.js.map',
  ].join('\n'),
  map: {
    sources: ['../src/a.ts'],
    mappings:
      'AAAA,MAAM,UAAU,KAAK,CAAC,KAAwB;IAC5C,IAAI,OAAO,GAAG,CAAC,CAAC;IAChB,IAAI,KAAK,GAAG,CAAC,CAAC;IACd,KAAK,MAAM,IAAI,IAAI,KAAK,EAAE,CAAC;QACzB,IAAI,IAAI,CAAC,UAAU,CAAC,GAAG,CAAC;YAAE,OAAO,IAAI,CAAC,CAAC;aAClC,IAAI,IAAI,CAAC,UAAU,CAAC,GAAG,CAAC;YAAE,KAAK,IAAI,CAAC,CAAC;aACrC,IAAI,CAAC,IAAI,CAAC,UAAU,CAAC,IAAI,CAAC,EAAE,CAAC;YAChC,OAAO,IAAI,CAAC,CAAC;YACb,KAAK,IAAI,CAAC,CAAC;QACb,CAAC;IACH,CAAC;IACD,OAAO,CAAC,OAAO,EAAE,KAAK,CAAC,CAAC;AAC1B,CAAC',
  },
};

const root = join(tmpdir(), `variance-readings-${process.pid}`);
const cacheRoot = join(root, '.cache');

beforeAll(async () => {
  await mkdir(join(root, 'app/src'), { recursive: true });
  await writeFile(join(root, 'app/src/a.ts'), SOURCE);
});

afterAll(async () => {
  await rm(root, { force: true, recursive: true });
});

/** The regions the build seam, `testSelectionProbes`, records once `reading` is its last transform of the module. */
const recordedAfter = async (
  reading: typeof ESBUILD,
  file: string,
): Promise<readonly (readonly [string, number, number])[]> => {
  const plugin = testSelectionProbes({ root, cacheRoot, include: () => true });
  const context: TransformingContext = { getCombinedSourcemap: () => reading.map };
  plugin.transform.call(context, reading.code, join(root, file));
  const record = await readRecord(recordStore(root, 'build', cacheRoot), 'app/src/a.ts');
  return (record?.blocks ?? []).map((block) => [block.path, block.startLine, block.endLine] as const);
};

describe('a module read through esbuild and through its tsc build', () => {
  it('records an `else if` chain on the same lines whichever reading came last', async () => {
    const build = await recordedAfter(TSC, 'app/dist/a.js');
    const source = await recordedAfter(ESBUILD, 'app/src/a.ts');

    expect(build).toContainEqual(['for#0/body/if#0/else', 6, 10]);
    expect(build).toContainEqual(['for#0/body/if#0/else/if#0/else', 7, 10]);
    expect(source).toEqual(build);
  });
});

/**
 * A workspace library consumed through its manifest: the bundler loads
 * `dist/a.js`, which the default include refuses, and `tsc`'s map leads back to
 * `src/a.ts`, which it accepts. The include is asked about the file the module
 * is recorded under, so the build is product source by the name of its source.
 */
describe('a module loaded from its tsc build under the default include', () => {
  const transformed = (file: string, map: TransformingContext['getCombinedSourcemap'] | undefined) => {
    const plugin = testSelectionProbes({ root, cacheRoot, label: 'default-include' });
    const context = map === undefined ? undefined : { getCombinedSourcemap: map };
    return plugin.transform.call(context as TransformingContext, TSC.code, join(root, file));
  };

  it('is instrumented and recorded under the source its map leads to', async () => {
    const done = transformed('app/dist/a.js', () => TSC.map);

    expect(done?.code).toContain('.r("app/src/a.ts",');
    expect(done?.code).not.toContain('"app/dist/a.js"');
    const record = await readRecord(recordStore(root, 'default-include', cacheRoot), 'app/src/a.ts');
    expect(record).toMatchObject({ file: 'app/src/a.ts', instrumented: true });
  });

  it('is left out when no map leads anywhere but itself', () => {
    expect(transformed('app/dist/a.js', undefined)).toBeNull();
  });

  it('is left out when its map names several sources, as a bundled library does', () => {
    expect(transformed('app/dist/a.js', () => ({ ...TSC.map, sources: ['../src/a.ts', '../src/b.ts'] }))).toBeNull();
  });

  it('is left out under `node_modules`, wherever its map leads', () => {
    expect(transformed('node_modules/app/dist/a.js', () => ({ ...TSC.map, sources: ['../../../app/src/a.ts'] })))
      .toBeNull();
  });
});
