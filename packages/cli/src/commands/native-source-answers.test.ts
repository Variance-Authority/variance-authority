import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as sense from '@variance-authority/sense';
import { expect, it, vi } from 'vitest';
import { readSource } from './coverage-source.js';
import { restrictionsOutput } from './restrictions-command.js';

vi.mock('ci-info', () => ({ isCI: true }));
vi.mock('@variance-authority/sense', async (original) => {
  const actual = await original<typeof import('@variance-authority/sense')>();
  return { ...actual, publishedSources: vi.fn(actual.publishedSources) };
});

it('answers coverage and restrictions without reconstructing published source records in JavaScript', async () => {
  const root = await mkdtemp(join(tmpdir(), 'va-native-answers-'));
  await writeFile(join(root, 'value.ts'), 'export const value = 1;\n');
  await writeFile(join(root, 'entry.ts'), "import { value } from './value';\nexport const entry = value;\n");
  await writeFile(join(root, '.relations.json'), JSON.stringify([{ to: 'value.ts', type: 'restricted' }]));
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  execFileSync('git', ['add', '.'], { cwd: root });
  await sense.updateSourceIndex(root);
  vi.mocked(sense.publishedSources).mockClear();

  const source = await readSource(root, undefined);
  expect('missed' in source ? [] : source.sizes.map((size) => size.file)).toEqual(['entry.ts', 'value.ts']);
  const found = await restrictionsOutput({ command: 'restrictions', root, format: 'json' });
  expect(JSON.parse(found.out).violations).toEqual([{ from: 'entry.ts', to: 'value.ts', directory: '' }]);
  expect(sense.publishedSources).not.toHaveBeenCalled();
});
