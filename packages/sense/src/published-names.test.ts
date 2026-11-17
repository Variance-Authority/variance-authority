import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openImmutableLog } from './immutable-log.js';
import { publishedNames, readPublishedNames } from './published-names.js';
import { SourceIndexUnpublished, updateSourceIndex } from './test-support/published.js';

/**
 * The names the published index gives a few files' texts, read off its record
 * columns alone: the same names a whole read gives them, over every layer.
 */

describe('the names the published source index gives some files', () => {
  let root: string;
  let cache: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'variance-published-names-'));
    cache = await mkdtemp(join(tmpdir(), 'variance-published-names-index-'));
    await write('package.json', '{ "name": "fixture" }');
    await write('app/index.ts', "import { unit } from '../lib/unit.js';\nexport const app = unit;\n");
    await write('lib/unit.ts', 'export const unit = 1;\n');
    await write('lib/alone.ts', 'export const alone = 2;\n');
    git('init', '--quiet');
    git('add', '.');
    git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--quiet', '-m', 'fixture');
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(cache, { recursive: true, force: true });
  });

  async function write(file: string, text: string): Promise<void> {
    await mkdir(dirname(join(root, file)), { recursive: true });
    await writeFile(join(root, file), text);
  }

  function git(...args: string[]): void {
    execFileSync('git', args, { cwd: root });
  }

  function index(name: string): string {
    return join(cache, name, 'source-index.bin');
  }

  function expectedNames(files: readonly string[]): ReadonlyMap<string, string> {
    return new Map(files.filter((file) => existsSync(join(root, file))).map((file) =>
      [file, `git:${execFileSync('git', ['hash-object', file], { cwd: root, encoding: 'utf8' }).trim()}`]));
  }

  it('names asked files by their Git identities over a layer that edits one and deletes another', async () => {
    const at = index('layered');
    await updateSourceIndex(root, { index: at });
    await write('lib/unit.ts', 'export const unit = 3;\n');
    await rm(join(root, 'lib/alone.ts'));
    try {
      await updateSourceIndex(root, { index: at });
      expect((await openImmutableLog(at)).digests.length).toBeGreaterThan(1);

      const asked = ['lib/unit.ts', 'lib/alone.ts', 'app/index.ts', 'lib/nowhere.ts'];
      const read = await readPublishedNames(at, asked);
      expect(read.state).toBe('published');
      expect(read.names).toEqual(expectedNames(asked));
      expect([...read.names.keys()].sort()).toEqual(['app/index.ts', 'lib/unit.ts']);
      expect(read.names.get('lib/unit.ts')).toBe(`git:${execFileSync('git', ['hash-object', 'lib/unit.ts'], { cwd: root, encoding: 'utf8' }).trim()}`);
    } finally {
      git('checkout', '--', 'lib/unit.ts', 'lib/alone.ts');
    }
  });

  it('returns the valid prefix and damaged status when a later segment is truncated', async () => {
    const at = index('damaged');
    await updateSourceIndex(root, { index: at });
    await write('lib/unit.ts', 'export const unit = 4;\n');
    try {
      await updateSourceIndex(root, { index: at });
    } finally {
      git('checkout', '--', 'lib/unit.ts');
    }
    const [, later] = (await openImmutableLog(at)).digests;
    await writeFile(join(`${at}.segments`, `${later!.replace(':', '-')}.bin`), 'corrupt');

    const read = await readPublishedNames(at, ['lib/unit.ts']);
    expect(read.state).toBe('damaged');
    expect(read.names).toEqual(expectedNames(['lib/unit.ts']));
  });

  it('refuses in CI when nothing is published, and builds the index on a workstation', async () => {
    const options = { step: 'variance index', announce: () => {} };
    await expect(publishedNames(root, ['lib/unit.ts'], { ...options, ci: true, index: index('refused') }))
      .rejects.toBeInstanceOf(SourceIndexUnpublished);

    const at = index('local');
    const read = await publishedNames(root, ['lib/unit.ts'], { ...options, ci: false, index: at });
    expect(read.state).toBe('published');
    expect(read.names).toEqual(expectedNames(['lib/unit.ts']));
  });
});
