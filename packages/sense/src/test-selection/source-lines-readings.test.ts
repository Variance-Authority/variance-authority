import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readRecord, recordStore } from './instrumented-modules.js';
import { testSelectionProbes } from './probes.js';

/**
 * One source, read as itself and through its build, cut into the same regions.
 *
 * Vitest reads a workspace module twice in one run: a package's own tests load
 * `src/x.ts`, and another package's tests load `dist/x.js`, which `tsc` built,
 * through the manifest. Both readings are filed under
 * `src/x.ts`, and the run records only the regions both cut, each where both
 * put it (`joinReadings` in `readings.ts`). A region the two place on different
 * lines is dropped, and its lines select through the region around it.
 * `hunksOf` in `packages/sense/src/test-selection/patch.ts` has this shape: two
 * CI runs of the same three test files, from before the readings were joined,
 * recorded its `else` on lines 57 to 61 and on 56 to 61.
 */

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

// What tsc 7 (ES2022, NodeNext) writes for `SOURCE`, and the map beside it, verbatim.
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
  await mkdir(join(root, 'app/dist'), { recursive: true });
  await mkdir(join(root, 'node_modules/app/dist'), { recursive: true });
  await writeFile(join(root, 'app/src/a.ts'), SOURCE);
  await writeFile(join(root, 'app/dist/a.js'), TSC.code);
  await writeFile(join(root, 'app/dist/b.js'), TSC.code.replace('a.js.map', 'b.js.map'));
  await writeFile(join(root, 'node_modules/app/dist/a.js'), TSC.code);
  await writeFile(join(root, 'app/dist/a.js.map'), JSON.stringify({ version: 3, ...TSC.map }));
  await writeFile(join(root, 'app/dist/b.js.map'), JSON.stringify({ version: 3, ...TSC.map, sources: ['../src/a.ts', '../src/b.ts'] }));
  await writeFile(
    join(root, 'node_modules/app/dist/a.js.map'),
    JSON.stringify({ version: 3, ...TSC.map, sources: ['../../../app/src/a.ts'] }),
  );
});

afterAll(async () => {
  await rm(root, { force: true, recursive: true });
});

/** The regions the build seam, `testSelectionProbes`, records once it read `code` as `file` last. */
const recordedAfter = async (
  code: string,
  file: string,
): Promise<readonly (readonly [string, number, number])[]> => {
  const plugin = testSelectionProbes({ root, cacheRoot, include: () => true });
  plugin.transform(code, join(root, file));
  const record = await readRecord(recordStore(root, 'build', cacheRoot), 'app/src/a.ts');
  return (record?.blocks ?? []).map((block) => [block.path, block.startLine, block.endLine] as const);
};

describe('a module read as itself and through its tsc build', () => {
  it('records an `else if` chain on the same lines whichever reading came last', async () => {
    const build = await recordedAfter(TSC.code, 'app/dist/a.js');
    const source = await recordedAfter(SOURCE, 'app/src/a.ts');

    expect(build).toContainEqual(['for#0/body/if#0/else', 6, 10]);
    expect(build).toContainEqual(['for#0/body/if#0/else/if#0/else', 7, 10]);
    expect(source).toEqual(build);
  });
});

/**
 * A workspace library consumed through its manifest: the bundler loads
 * `dist/a.js`, which the default include refuses, and the map `tsc` wrote
 * beside it leads back to `src/a.ts`, which it accepts. The include is asked
 * about the file the module is recorded under, so the build is product source
 * by the name of its source.
 */
describe('a module loaded from its tsc build under the default include', () => {
  const transformed = (file: string, code = TSC.code) =>
    testSelectionProbes({ root, cacheRoot, label: 'default-include' }).transform(code, join(root, file));

  it('is instrumented and recorded under the source its map leads to', async () => {
    const done = transformed('app/dist/a.js');

    expect(done?.code).toContain('.r("app/src/a.ts",');
    expect(done?.code).not.toContain('"app/dist/a.js"');
    const record = await readRecord(recordStore(root, 'default-include', cacheRoot), 'app/src/a.ts');
    expect(record).toMatchObject({ file: 'app/src/a.ts', instrumented: true });
  });

  it('is left out when it points at no map', () => {
    expect(transformed('app/dist/a.js', TSC.code.replace(/\n\/\/# sourceMappingURL=.*$/, ''))).toBeNull();
  });

  it('is left out when its map names several sources, as a bundled library does', () => {
    expect(transformed('app/dist/b.js', TSC.code.replace('a.js.map', 'b.js.map'))).toBeNull();
  });

  it('is left out under `node_modules`, wherever its map leads', () => {
    expect(transformed('node_modules/app/dist/a.js')).toBeNull();
  });
});
