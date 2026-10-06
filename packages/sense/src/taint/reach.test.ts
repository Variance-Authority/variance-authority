import { describe, expect, it } from 'vitest';
import { relationsOfFiles, type FileRecord } from '@variance-authority/core/relate';
import { shadowReach } from './reach.js';

/**
 * `card.test.ts` imports `card.ts`, which imports `api.ts`, which imports
 * `client.ts`, which imports `socket.ts`. `types.ts` is reached only by a
 * type-only import, and `orphan.ts` by nothing.
 */
const RECORDS: readonly FileRecord[] = [
  { file: 'src/socket.ts' },
  { file: 'src/client.ts', edges: [{ to: 'src/socket.ts', kind: 'imports' }] },
  { file: 'src/api.ts', edges: [{ to: 'src/client.ts', kind: 'imports' }] },
  { file: 'src/types.ts' },
  { file: 'src/card.ts', edges: [{ to: 'src/api.ts', kind: 'imports' }, { to: 'src/types.ts', kind: 'type' }] },
  { file: 'src/card.test.ts', edges: [{ to: 'src/card.ts', kind: 'imports' }] },
  { file: 'src/orphan.ts' },
];

const reachOf = (mocked: readonly string[]) =>
  shadowReach(relationsOfFiles(RECORDS, { shadows: new Map([['src/card.test.ts', mocked]]) }), 'src/card.test.ts');

describe('how far a test file is from what it shadows', () => {
  it('counts the imports from the test file to each module it shadows, and names the file that imports it', () => {
    expect(reachOf(['src/card.ts', 'src/api.ts', 'src/socket.ts'])).toEqual([
      { module: 'src/api.ts', hops: 2, importer: 'src/card.ts' },
      { module: 'src/card.ts', hops: 1, importer: 'src/card.test.ts' },
      { module: 'src/socket.ts', hops: 4, importer: 'src/client.ts' },
    ]);
  });

  it('gives no distance to a module the test file does not load: a type-only import loads nothing', () => {
    expect(reachOf(['src/orphan.ts', 'src/types.ts'])).toEqual([{ module: 'src/orphan.ts' }, { module: 'src/types.ts' }]);
  });

  it('is empty for a test file that shadows nothing, or that the graph does not hold', () => {
    const relations = relationsOfFiles(RECORDS);
    expect(shadowReach(relations, 'src/card.test.ts')).toEqual([]);
    expect(shadowReach(relations, 'src/gone.test.ts')).toEqual([]);
  });
});
