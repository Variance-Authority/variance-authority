import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { updateSourceIndex } from '@variance-authority/sense';
import { readWorkspace } from '../read.js';
import { symbol } from './symbol.js';

const before = process.env['VARIANCE_AUTHORITY_CACHE'];
afterEach(() => {
  if (before === undefined) delete process.env['VARIANCE_AUTHORITY_CACHE'];
  else process.env['VARIANCE_AUTHORITY_CACHE'] = before;
});

async function ask(main: string, name: string): Promise<string> {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'va-symbol-unfollowed-')));
  process.env['VARIANCE_AUTHORITY_CACHE'] = mkdtempSync(join(tmpdir(), 'va-symbol-unfollowed-cache-'));
  execFileSync('git', ['init', '--quiet', root]);
  const files: Record<string, string> = {
    'package.json': JSON.stringify({ name: 'fixture', workspaces: ['packages/*'] }),
    'packages/lib/package.json': JSON.stringify({ name: '@x/lib', main }),
    'packages/lib/src/index.ts': 'export function lib(): number {\n  return 1;\n}\n',
  };
  for (const [path, value] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), value);
  }
  execFileSync('git', ['add', '-f', '.'], { cwd: root });
  await updateSourceIndex(root);
  return symbol.run(await readWorkspace(root), { name }, { root });
}

it('does not call a name unpublished when its package declares an entry no source was followed from', async () => {
  const out = await ask('dist/es5/index.js', 'lib');

  expect(out).not.toContain('without being published');
  expect(out).toContain('exported at packages/lib/src/index.ts:1 by @x/lib');
  expect(out).toContain('whether it is published is not known');
});
