import { describe, expect, it } from 'vitest';
import { encodeExecutionIndex, type ExecutionIndex } from '@variance-authority/sense/test-selection';
import { executionIndexOf } from './execution-input.js';

const INDEX: ExecutionIndex = {
  tests: [{ id: 'a.test.ts > adds', file: 'a.test.ts', name: 'adds' }],
  modules: [
    {
      file: 'src/add.ts',
      blocks: [
        {
          kind: 'function',
          name: 'add',
          path: 'src/add.ts',
          startLine: 1,
          endLine: 3,
          source: true,
          crossings: [{ test: 0, distance: 1 }],
        },
      ],
    },
  ],
};

describe('an execution index in either spelling', () => {
  it('reads JSON that opens on a tab, a carriage return or a byte order mark', () => {
    for (const lead of ['\t', '\r\n', '﻿', '﻿\t']) {
      expect(executionIndexOf(Buffer.from(lead + JSON.stringify(INDEX), 'utf8'))).toEqual(INDEX);
    }
  });

  it('reads the columns a run wrote', () => {
    expect(executionIndexOf(encodeExecutionIndex(INDEX))).toEqual(INDEX);
  });
});
