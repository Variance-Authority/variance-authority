import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openSourceIndexFile } from './test-support/source-index-file.js';
import { updateSourceIndex } from './test-support/published.js';
import { realPath } from './resolve.js';

const ORIGINAL = "/** Selects a side. */\nimport { side } from './left.js';\nexport const entry = side;\n";

describe('a native warm update of worktree bytes', () => {
  it.each([
    { change: 'filter', configure: false },
    { change: 'filter', configure: true },
    { change: 'CRLF', configure: false },
    { change: 'CRLF', configure: true },
  ])('matches a fresh index after $change, with configuration change=$configure', async ({ change, configure }) => {
    const root = realPath(await mkdtemp(join(tmpdir(), 'variance-worktree-identity-')));
    const cache = await mkdtemp(join(tmpdir(), 'variance-worktree-index-'));
    const git = (...args: string[]): string => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    const index = join(cache, 'warm', 'index.bin');
    try {
      await writeFile(join(root, 'package.json'), '{ "name": "fixture", "private": true }');
      await writeFile(join(root, 'entry.ts'), ORIGINAL);
      await writeFile(join(root, 'left.ts'), 'export const side = 1;\n');
      await writeFile(join(root, 'right.ts'), 'export const side = 2;\n');
      git('init', '--quiet');
      git('config', 'core.autocrlf', 'false');
      if (change === 'filter') {
        await writeFile(join(root, '.gitattributes'), 'entry.ts filter=same\n');
        git('config', 'filter.same.clean', "cat >/dev/null; printf 'export const entry = 0;\\n'");
        git('config', 'filter.same.smudge', 'cat');
      } else {
        await writeFile(join(root, '.gitattributes'), '* text=auto\n');
      }
      git('add', '.');
      git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--quiet', '-m', 'fixture');
      const oid = git('hash-object', 'entry.ts');
      await updateSourceIndex(root, { index, packs: false });

      const current = change === 'filter' ? ORIGINAL.replace('./left.js', './right.js') : ORIGINAL.replaceAll('\n', '\r\n');
      if (change === 'CRLF') git('config', 'core.autocrlf', 'true');
      await writeFile(join(root, 'entry.ts'), current);
      expect(git('hash-object', 'entry.ts')).toBe(oid);
      if (configure) await writeFile(join(root, 'tsconfig.json'), '{"compilerOptions":{"customConditions":["witness"]}}');

      await updateSourceIndex(root, { index, packs: false });
      const fresh = join(cache, 'fresh', 'index.bin');
      await updateSourceIndex(root, { index: fresh, packs: false });
      const warm = (await openSourceIndexFile(index)).stored;
      const expected = (await openSourceIndexFile(fresh)).stored;
      expect(warm.records.get('entry.ts')?.targets).toEqual([change === 'filter' ? 'right.ts' : 'left.ts']);
      const entry = [...warm.parses.values()].find((parse) => parse.requests.length > 0);
      expect(entry?.requests[0]?.value).toBe(change === 'filter' ? './right.js' : './left.js');
      expect(entry?.size?.bytes).toBe(Buffer.byteLength(current));
      expect(entry?.exports?.[0]?.signature).toEqual({ start: current.indexOf('export'), end: current.trimEnd().length });
      expect(new Map(warm.records)).toEqual(new Map(expected.records));
      expect(new Map(warm.parses)).toEqual(new Map(expected.parses));
      expect(new Map(warm.directories)).toEqual(new Map(expected.directories));
      expect(await updateSourceIndex(root, { index, packs: false })).toMatchObject({ parsed: 0 });
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(cache, { recursive: true, force: true });
    }
  });
});
