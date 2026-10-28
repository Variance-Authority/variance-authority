import { describe, expect, it } from 'vitest';
import type { FileRecord } from '@variance-authority/core/relate';
import type { ParseKey, Parsed } from './cache.js';
import { keyFor, parseWay } from './files.js';
import { fileSizes, sourceScope } from './source-scope.js';
import { EntrypointsError, parseEntrypoints } from './test-selection/entrypoints.js';

const edge = (to: string) => ({ to, kind: 'imports' as const });
const RECORDS: FileRecord[] = [
  { file: 'apps/main/src/main.tsx', digest: 'd1', edges: [edge('apps/main/src/app.tsx')] },
  { file: 'apps/main/src/app.tsx', digest: 'd2', edges: [edge('libs/ui/button.tsx')] },
  { file: 'apps/main/src/orphan.ts', digest: 'd3' },
  { file: 'apps/next/app/page.tsx', digest: 'd4' },
  { file: 'apps/next/app/shop/page.tsx', digest: 'd5', edges: [edge('libs/ui/button.tsx')] },
  { file: 'apps/next/lib/unused.ts', digest: 'd6' },
  { file: 'libs/ui/button.tsx', digest: 'd7' },
  { file: 'tooling/lint.py', digest: 'd8' },
] as FileRecord[];

describe('sourceScope', () => {
  const entrypoints = parseEntrypoints(
    { 'apps/main': ['src/main.tsx'], './apps/next/': ['app/**/*', 'pages/*'] },
    'variance.config.json',
  );

  it('is every file the index holds when no directory is asked about', () => {
    expect(sourceScope(RECORDS)).toEqual({ seeds: 'everything', files: RECORDS.map((r) => r.file).sort() });
  });

  it('follows the imports out of the directory from its declared entry points, and leaves what they never reach', () => {
    expect(sourceScope(RECORDS, 'apps/main', entrypoints)).toEqual({
      from: 'apps/main',
      seeds: 'entrypoints',
      unmatched: [],
      files: ['apps/main/src/app.tsx', 'apps/main/src/main.tsx', 'libs/ui/button.tsx'],
    });
  });

  it('matches `**/` as no directory or many, and names a pattern that matched nothing', () => {
    expect(sourceScope(RECORDS, 'apps/next/', entrypoints)).toEqual({
      from: 'apps/next',
      seeds: 'entrypoints',
      unmatched: ['pages/*'],
      files: ['apps/next/app/page.tsx', 'apps/next/app/shop/page.tsx', 'libs/ui/button.tsx'],
    });
  });

  it('takes `.` as the repository root, so what its patterns leave out is not in the scope', () => {
    const root = parseEntrypoints({ '.': ['apps/**', 'libs/**'] }, 'variance.config.json');
    const scope = sourceScope(RECORDS, '.', root);
    expect(scope).toMatchObject({ seeds: 'entrypoints', unmatched: [] });
    expect(scope.files).toContain('apps/next/lib/unused.ts');
    expect(scope.files).not.toContain('tooling/lint.py');
  });

  it('is seeded from every file under a directory that declares no entry points, and says so', () => {
    expect(sourceScope(RECORDS, 'tooling', entrypoints)).toEqual({
      from: 'tooling',
      seeds: 'directory',
      files: ['tooling/lint.py'],
    });
  });
});

describe('sourceScope, asked about a directory the index holds nothing under', () => {
  it('refuses, rather than answer with an empty scope that reads as fully loaded', () => {
    expect(() => sourceScope(RECORDS, 'apps/mian')).toThrow('the source index holds no file under "apps/mian"');
  });
});

describe('parseEntrypoints', () => {
  it.each([
    [[], /an object from a directory/],
    [{}, /declares no directory/],
    [{ app: [] }, /non-empty array/],
    [{ app: ['../x.ts'] }, /non-empty array/],
    [{ '../app': ['x.ts'] }, /not a directory inside the repository/],
    [{ app: ['x.ts'], './app': ['y.ts'] }, /a second time/],
  ])('refuses %j', (value, said) => {
    expect(() => parseEntrypoints(value, 'variance.config.json')).toThrow(EntrypointsError);
    expect(() => parseEntrypoints(value, 'variance.config.json')).toThrow(said);
  });
});

describe('fileSizes', () => {
  const parses = new Map<ParseKey, Parsed>([
    [keyFor('d1', parseWay('apps/main/src/main.tsx')), { size: { bytes: 120, lines: 4, blocks: 2 }, exports: [] } as unknown as Parsed],
    [keyFor('d2', parseWay('apps/main/src/app.tsx')), { size: { bytes: 90, lines: 3 } } as unknown as Parsed],
    [keyFor('d8', parseWay('tooling/lint.py')), {} as Parsed],
  ]);

  it("joins each file to its parse's size through its digest, and leaves out a file whose parse stored none", () => {
    expect(fileSizes(RECORDS, parses, ['apps/main/src/main.tsx', 'apps/main/src/app.tsx', 'tooling/lint.py', 'missing.ts'])).toEqual([
      { file: 'apps/main/src/main.tsx', bytes: 120, lines: 4, blocks: 2, exports: 0 },
      { file: 'apps/main/src/app.tsx', bytes: 90, lines: 3 },
    ]);
  });
});
