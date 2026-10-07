import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { Viewport } from '@variance-authority/core/format';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { directoryDigest, evidenceIdentity, readsOf } from './evidence-identity.js';
import { configOf, VIEWPORT } from './run-fixture.js';

const run = promisify(execFile);

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'evidence-identity-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function put(path: string, text: string): Promise<void> {
  await mkdir(join(root, path, '..'), { recursive: true });
  await writeFile(join(root, path), text);
}

async function committed(): Promise<void> {
  const git = (...args: string[]) => run('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: root });
  await git('init', '-q');
  await git('add', '.');
  await git('commit', '-qm', 'base');
}

function storybookAt(dir: string) {
  return configOf({
    subjects: { kind: 'storybook', index: join(root, dir, 'index.json'), collector: join(root, 'collector.mjs') },
    source: { dirs: [join(root, 'src')] },
  });
}

describe('evidenceIdentity: the build and recipe every part of one collection must share', () => {
  it('digests a built Storybook by every file in it, whatever order the disk lists them', async () => {
    await put('sb/index.json', '{}');
    await put('sb/assets/a.js', 'a');
    const before = await directoryDigest(join(root, 'sb'));

    expect(await directoryDigest(join(root, 'sb'))).toBe(before);
    await put('sb/assets/a.js', 'b');
    expect(await directoryDigest(join(root, 'sb'))).not.toBe(before);
    await put('sb/assets/a.js', 'a');
    await put('sb/assets/new.js', '');
    expect(await directoryDigest(join(root, 'sb'))).not.toBe(before);
  });

  it('names the commit, and tells two checkouts of it apart by an edit under source.dirs', async () => {
    await put('sb/index.json', '{}');
    await put('src/Button.tsx', 'export const Button = 1;');
    await put('elsewhere.md', 'one');
    await committed();
    const clean = await evidenceIdentity(storybookAt('sb'), root, {});

    expect(clean.build.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(clean.build.storybook).toBe(await directoryDigest(join(root, 'sb')));
    expect(clean.diagnostics).toEqual([]);

    await put('elsewhere.md', 'two');
    expect((await evidenceIdentity(storybookAt('sb'), root, {})).build).toEqual(clean.build);

    await put('src/Button.tsx', 'export const Button = 2;');
    const dirty = await evidenceIdentity(storybookAt('sb'), root, {});
    expect(dirty.build.commit).toBe(clean.build.commit);
    expect(dirty.build.source).not.toBe(clean.build.source);
  });

  it('digests every file the scan reads, git-ignored ones included, and none it skips', async () => {
    await put('sb/index.json', '{}');
    await put('.gitignore', 'src/generated/\n');
    await put('src/Button.tsx', 'export const Button = 1;');
    await put('src/generated/tokens.ts', 'export const blue = 1;');
    await put('src/Button.stories.tsx', 'export default {};');
    await committed();
    const before = (await evidenceIdentity(storybookAt('sb'), root, {})).build.source;

    await put('src/Button.stories.tsx', 'export default { title: "x" };');
    expect((await evidenceIdentity(storybookAt('sb'), root, {})).build.source).toBe(before);
    await put('src/generated/tokens.ts', 'export const blue = 2;');
    expect((await evidenceIdentity(storybookAt('sb'), root, {})).build.source).not.toBe(before);
  });

  it('outside git, names no commit and says why, and still digests the source', async () => {
    await put('sb/index.json', '{}');
    await put('src/Button.tsx', 'export const Button = 1;');
    const { build, diagnostics } = await evidenceIdentity(storybookAt('sb'), root, {});

    expect(build).toEqual({ storybook: await directoryDigest(join(root, 'sb')), source: expect.stringMatching(/^v1:[0-9a-f]{32}$/) });
    expect(diagnostics.map((diagnostic) => diagnostic.message)).toEqual([expect.stringMatching(/not a git checkout/)]);
  });

  it('names the commit CI says it built, as a run does, before the checkout\'s HEAD', async () => {
    await put('sb/index.json', '{}');
    await committed();
    const sha = 'a'.repeat(40);

    const { build, diagnostics } = await evidenceIdentity(storybookAt('sb'), root, { GITHUB_RUN_ID: '7', GITHUB_SHA: sha });
    expect(build.commit).toBe(sha);
    expect(diagnostics).toEqual([]);
    // Read whole, as a run reads it: a commit with no run beside it is no CI's answer.
    expect((await evidenceIdentity(storybookAt('sb'), root, { GITHUB_SHA: sha })).build.commit).not.toBe(sha);
  });

  it('reads the recipe with paths relative to the job, so two machines agree', () => {
    const here = readsOf(storybookAt('sb'), root);
    const there = readsOf(
      configOf({
        subjects: { kind: 'storybook', index: '/ci/job/sb/index.json', collector: '/ci/job/collector.mjs' },
        source: { dirs: ['/ci/job/src'] },
      }),
      '/ci/job',
    );

    expect(there).toEqual(here);
    expect(here).toMatchObject({ subjects: { kind: 'storybook', collector: 'collector.mjs', excludeTags: [] }, source: ['src'] });
    expect(readsOf(configOf({ viewport: { width: 1, height: 1 } }), root)).not.toEqual(readsOf(configOf(), root));
  });

  it('reads a colour scheme as the semantic key does, and leaves the pixel ratio to pixels', () => {
    const at = (viewport: Partial<Viewport>) => readsOf(configOf({ viewport: { ...VIEWPORT, ...viewport } }), root);

    expect(at({ colorScheme: 'dark' })).not.toEqual(at({ colorScheme: 'light' }));
    expect(at({ deviceScaleFactor: 2 })).toEqual(at({ deviceScaleFactor: 1 }));
  });
});
