import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { digestString } from '@variance-authority/core/format';
import { cutElsewhere } from './before-texts.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function committed(files: Record<string, string>): Promise<{ root: string; commit: string }> {
  const root = await mkdtemp(join(tmpdir(), 'before-texts-'));
  roots.push(root);
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  git('init', '-q');
  for (const [file, text] of Object.entries(files)) await writeFile(join(root, file), text);
  git('add', '.');
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'one');
  return { root, commit: git('rev-parse', 'HEAD') };
}

describe('cutElsewhere', () => {
  it('names a module git cannot give the text of as not compared, with git\'s reason, beside the ones it compares', async () => {
    const { root, commit } = await committed({ 'a.ts': 'a\n', 'b.ts': 'b\n', 'c.ts': 'c\n' });
    const blob = execFileSync('git', ['rev-parse', `${commit}:b.ts`], { cwd: root, encoding: 'utf8' }).trim();
    rmSync(join(root, '.git', 'objects', blob.slice(0, 2), blob.slice(2)));

    const cut = cutElsewhere(['a.ts', 'b.ts', 'c.ts'], { 'a.ts': digestString('a\n'), 'b.ts': digestString('b\n'), 'c.ts': digestString('changed\n') }, commit, root);

    expect(cut.elsewhere).toEqual(['c.ts']);
    expect([...cut.unread.keys()]).toEqual(['b.ts']);
    expect(cut.unread.get('b.ts')).toMatch(/^git could not read the files asked about at commit [0-9a-f]{12}: .*\S/s);
  });
});
