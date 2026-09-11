import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { distillFiles, formatDistill } from './distill.js';

describe('the CLI distillation boundary', () => {
  it('reads execution JSON without a project config and preserves missing attention', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'variance-distill-'));
    const execution = join(dir, 'execution.json');
    await writeFile(execution, JSON.stringify({
      tests: [{ id: 'plain', file: 'plain.test.ts', name: 'works' }],
      modules: [{ file: 'plain.ts', blocks: [{
        kind: 'function', name: 'work', path: 'entry', startLine: 1, endLine: 2,
        source: true, crossings: [{ test: 0, distance: 1 }],
      }] }],
    }));

    const result = await distillFiles({ test: 'plain', execution });

    expect(result.execution?.entered).toEqual([{ file: 'plain.ts', distance: 1 }]);
    expect(result.execution?.opportunities).toBeUndefined();
    expect(formatDistill(result, 'json')).toContain('"entered"');
  });
});
