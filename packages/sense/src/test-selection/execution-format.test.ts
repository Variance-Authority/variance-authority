import { describe, expect, it } from 'vitest';
import {
  decodeExecutionIndex,
  encodeExecutionIndex,
  executionIndexBytes,
  isEncodedExecutionIndex,
} from './execution-format.js';
import type { ExecutionIndex } from './reverse.js';

describe('the execution index as columns', () => {
  it('returns the index it was handed, field for field', () => {
    const index = representative();
    expect(decodeExecutionIndex(encodeExecutionIndex(index))).toEqual(index);
  });

  it('keeps whether each case finished, stopped, or could not be told', () => {
    const index: ExecutionIndex = {
      tests: [
        { id: 'a.test.ts > one', file: 'a.test.ts', name: 'one', stopped: true },
        { id: 'a.test.ts > two', file: 'a.test.ts', name: 'two', stopped: false },
        { id: 'a.test.ts > three', file: 'a.test.ts', name: 'three' },
      ],
      modules: [],
    };
    expect(decodeExecutionIndex(encodeExecutionIndex(index)).tests).toEqual(index.tests);
  });

  it('keeps the difference between an unsaid loading and a denied one', () => {
    const index: ExecutionIndex = {
      tests: [{ id: 'a.test.ts > one', file: 'a.test.ts', name: 'one' }],
      modules: [
        {
          file: 'src/a.ts',
          blocks: [
            {
              kind: 'module',
              name: 'src/a.ts',
              path: 'src/a.ts',
              startLine: 1,
              endLine: 9,
              source: true,
              crossings: [
                { test: 0, distance: 0 },
                { test: 0, distance: 1, loaded: false },
                { test: 0, distance: 2, loaded: true },
              ],
            },
          ],
        },
      ],
    };

    const back = decodeExecutionIndex(encodeExecutionIndex(index));
    expect(back).toEqual(index);
    expect('loaded' in back.modules[0]!.blocks[0]!.crossings[0]!).toBe(false);
  });

  it('keeps a region flagged as having run while its module evaluated', () => {
    const index: ExecutionIndex = {
      tests: [{ id: 'a.test.ts > one', file: 'a.test.ts', name: 'one' }],
      modules: [{
        file: 'src/a.ts',
        blocks: [
          { kind: 'statement', name: 'RATE', path: 'statement#0', startLine: 1, endLine: 1, source: true, loaded: true, crossings: [] },
          { kind: 'function', name: 'total', path: 'total', startLine: 3, endLine: 5, source: true, crossings: [{ test: 0, distance: 0 }] },
        ],
      }],
    };

    const back = decodeExecutionIndex(encodeExecutionIndex(index));
    expect(back).toEqual(index);
    expect('loaded' in back.modules[0]!.blocks[1]!).toBe(false);
  });

  it('reads rows written before a region carried the flag as flagging nothing', () => {
    const index: ExecutionIndex = {
      tests: [{ id: 'a.test.ts > one', file: 'a.test.ts', name: 'one' }],
      modules: [{
        file: 'src/a.ts',
        blocks: [{ kind: 'function', name: 'total', path: 'total', startLine: 3, endLine: 5, source: true, crossings: [{ test: 0, distance: 0, loaded: true }] }],
      }],
    };
    const bytes = encodeExecutionIndex(index);
    const headerLength = bytes.readUInt32LE(0);
    const header = JSON.parse(bytes.toString('utf8', 4, 4 + headerLength).replace(/\0+$/u, '')) as { version: number };
    const older = Buffer.from(JSON.stringify({ ...header, version: 1 }).padEnd(headerLength, '\0'), 'utf8');
    expect(older.length).toBe(headerLength);

    expect(decodeExecutionIndex(Buffer.concat([bytes.subarray(0, 4), older, bytes.subarray(4 + headerLength)])))
      .toEqual(index);
  });

  it('holds a module with no regions and a region nothing crossed', () => {
    const index: ExecutionIndex = {
      tests: [],
      modules: [
        { file: 'src/empty.ts', blocks: [] },
        {
          file: 'src/cold.ts',
          blocks: [
            { kind: 'function', name: 'cold', path: 'src/cold.ts', startLine: 2, endLine: 4, source: false, crossings: [] },
          ],
        },
      ],
    };
    expect(decodeExecutionIndex(encodeExecutionIndex(index))).toEqual(index);
  });

  it('costs a fraction of the JSON spelling of the same relation', () => {
    const index = manyCrossings();
    const json = Buffer.byteLength(JSON.stringify(index));
    expect(encodeExecutionIndex(index).byteLength).toBeLessThan(json / 10);
  });

  it('tells its own bytes from a JSON index', () => {
    expect(isEncodedExecutionIndex(encodeExecutionIndex(representative()))).toBe(true);
    expect(isEncodedExecutionIndex(Buffer.from(JSON.stringify(representative()), 'utf8'))).toBe(false);
    expect(isEncodedExecutionIndex(Buffer.from('\n  {"tests":[]}', 'utf8'))).toBe(false);
  });

  it('writes JSON to a name that asked for it', () => {
    const index = representative();
    expect(JSON.parse(executionIndexBytes('cases.json', index).toString('utf8'))).toEqual(index);
    expect(isEncodedExecutionIndex(executionIndexBytes('coverage.bin.cases.bin', index))).toBe(true);
  });

  it('refuses a file it did not write', () => {
    expect(() => decodeExecutionIndex(Buffer.from('not an index'))).toThrow();
    const encoded = encodeExecutionIndex(representative());
    expect(() => decodeExecutionIndex(encoded.subarray(0, encoded.length - 32))).toThrow();
  });

  function representative(): ExecutionIndex {
    return {
      tests: [
        { id: 'a.test.ts > adds', file: 'a.test.ts', name: 'adds' },
        { id: 'a.test.ts > adds #2', file: 'a.test.ts', name: 'adds #2' },
        { id: 'b.test.ts > renders «ü»', file: 'b.test.ts', name: 'renders «ü»' },
      ],
      modules: [
        {
          file: 'src/add.ts',
          blocks: [
            {
              kind: 'module',
              name: 'src/add.ts',
              path: 'src/add.ts',
              startLine: 1,
              endLine: 12,
              source: true,
              crossings: [
                { test: 0, distance: 0, loaded: true },
                { test: 1, distance: 0, loaded: false },
              ],
            },
            {
              kind: 'function',
              name: 'add',
              path: 'src/add.ts',
              startLine: 3,
              endLine: 5,
              source: true,
              crossings: [{ test: 0, distance: 0 }],
            },
          ],
        },
        {
          file: 'src/render.tsx',
          blocks: [
            {
              kind: 'branch',
              name: 'render > if',
              path: 'src/render.tsx',
              startLine: 40,
              endLine: 44,
              source: false,
              crossings: [{ test: 2, distance: 3 }],
            },
          ],
        },
      ],
    };
  }

  function manyCrossings(): ExecutionIndex {
    const tests = Array.from({ length: 200 }, (_, at) => ({
      id: `suite/file-${at % 20}.test.ts > case ${at}`,
      file: `suite/file-${at % 20}.test.ts`,
      name: `case ${at}`,
    }));
    const modules = Array.from({ length: 50 }, (_, module) => ({
      file: `src/deep/nested/module-${module}.ts`,
      blocks: Array.from({ length: 10 }, (_, block) => ({
        kind: 'function',
        name: `member${block}`,
        path: `src/deep/nested/module-${module}.ts`,
        startLine: block * 7 + 1,
        endLine: block * 7 + 6,
        source: true,
        crossings: tests.map((_, test) => ({ test, distance: 0 })),
      })),
    }));
    return { tests, modules };
  }
});
