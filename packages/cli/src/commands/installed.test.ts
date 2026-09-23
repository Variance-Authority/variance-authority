import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { installDiff, installedDepends, type DiffPoint } from './installed.js';

/**
 * Reading the install at two revisions.
 *
 * The cases are the ones a file diff cannot tell apart. A lockfile that changed
 * and installed nothing, a lockfile that changed and moved one package, and a
 * lockfile this cannot read at all look identical in `git diff --name-only`,
 * and the first two must go opposite ways while the third goes loudly.
 */

const BEFORE = `# yarn lockfile v1


lodash@^4.17.21:
  version "4.17.21"
  resolved "https://registry.yarnpkg.com/lodash/-/lodash-4.17.21.tgz#abc"
  integrity sha512-aaa

jsdom@^24.0.0:
  version "24.1.0"
  resolved "https://registry.yarnpkg.com/jsdom/-/jsdom-24.1.0.tgz#def"
  integrity sha512-bbb
`;

/** The same install with one package moved, and nothing else touched. */
const BUMPED = BEFORE.replace('4.17.21"\n  resolved', '4.17.22"\n  resolved');

/** The same install written differently — a comment, as a workspace bump would be. */
const REWRITTEN = BEFORE.replace('# yarn lockfile v1', '# yarn lockfile v1\n# regenerated');

async function repository(lockfile: string): Promise<string> {
  const at = await mkdtemp(join(tmpdir(), 'va-install-'));
  await writeFile(join(at, 'yarn.lock'), lockfile, 'utf8');
  return at;
}

function pointAt(repo: string, before: string | undefined): DiffPoint {
  return { repository: repo, base: 'abc1234', at: async () => before };
}

describe('what a diff did to the install', () => {
  it('names the package whose resolution moved, and no other', async () => {
    const at = await repository(BUMPED);
    const diff = await installDiff(pointAt(at, BEFORE), [], at);

    expect(diff).toEqual({ packages: ['lodash'], manifests: ['yarn.lock', 'package.json'], moved: [] });
  });

  it('names nothing when the file was rewritten and the install is the same', async () => {
    const at = await repository(REWRITTEN);
    const diff = await installDiff(pointAt(at, BEFORE), [], at);

    // The reason the lockfile is a source and never a changed path. Read as a
    // changed file this diff repaints the suite; read as an install it is
    // nothing at all.
    expect(diff).toEqual({ packages: [], manifests: ['yarn.lock', 'package.json'], moved: [] });
  });

  it('claims the manifests either way, so they are not counted twice', async () => {
    const at = await repository(BUMPED);
    const diff = await installDiff(pointAt(at, BEFORE), [], at);

    // `package.json` is claimed by the reading rather than by the reader: a
    // range is a request, and the lockfile is where it was answered.
    expect(diff && 'manifests' in diff && diff.manifests).toContain('package.json');
  });

  it('refuses, in a sentence, when the lockfile changed and cannot be read', async () => {
    const at = await repository('__metadata:\n  version: 3\n');
    const diff = await installDiff(pointAt(at, BEFORE), [], at);

    expect(diff && 'whole' in diff && diff.whole).toContain('could not read it');
    expect(diff && 'whole' in diff && diff.whole).toContain('__metadata.version 3');
  });

  it('refuses when the base revision had no lockfile, because nothing bounds the change', async () => {
    const at = await repository(BEFORE);
    const diff = await installDiff(pointAt(at, undefined), [], at);

    expect(diff && 'whole' in diff && diff.whole).toContain('no install to compare');
  });

  it('answers nothing at all when there is no lockfile to read', async () => {
    const at = await mkdtemp(join(tmpdir(), 'va-install-'));
    // Not a refusal. A tree with no recorded install has no diff of one, so no
    // seed is missing and nothing is owed a widening.
    expect(await installDiff(pointAt(at, BEFORE), [], at)).toBeUndefined();
  });

  it('answers nothing when the revision could not be resolved', async () => {
    const at = await repository(BEFORE);
    expect(await installDiff(undefined, [], at)).toBeUndefined();
  });
});

/**
 * A `package.json` the install only half reads.
 *
 * The lockfile is byte-identical in every case here, so the install moved
 * nothing — and the three diffs still go different ways, because `exports`
 * decides which file an importer of the package loads and `scripts` decides
 * nothing any module sees.
 */
describe('which changed manifests the install does not speak for', () => {
  const MANIFEST = {
    name: '@acme/ds',
    version: '1.0.0',
    exports: { '.': './dist/index.js' },
    scripts: { build: 'tsc' },
    dependencies: { lodash: '^4.17.21' },
  };
  const text = (manifest: object): string => `${JSON.stringify(manifest, null, 2)}\n`;

  async function workspace(after: object): Promise<string> {
    const at = await repository(BEFORE);
    await mkdir(join(at, 'packages/ds'), { recursive: true });
    await writeFile(join(at, 'packages/ds/package.json'), text(after), 'utf8');
    return at;
  }

  function pointWith(repo: string, files: Readonly<Record<string, string>>): DiffPoint {
    return { repository: repo, base: 'abc1234', at: async (path) => files[path] };
  }

  const at = (repo: string) => pointWith(repo, { 'yarn.lock': BEFORE, 'packages/ds/package.json': text(MANIFEST) });

  it('carries a manifest whose `exports` moved, though the install did not', async () => {
    const repo = await workspace({ ...MANIFEST, exports: { '.': './src/index.ts' } });
    const diff = await installDiff(at(repo), ['packages/ds/package.json'], repo);

    expect(diff).toEqual({ packages: [], manifests: ['yarn.lock', 'package.json'], moved: ['packages/ds/package.json'] });
  });

  it('sets aside a manifest whose change is a script and a dependency range', async () => {
    const repo = await workspace({ ...MANIFEST, scripts: { build: 'tsc -b' }, dependencies: { lodash: '^4.17.22' } });
    const diff = await installDiff(at(repo), ['packages/ds/package.json'], repo);

    expect(diff).toEqual({ packages: [], manifests: ['yarn.lock', 'package.json'], moved: [] });
  });

  it('carries a manifest the base did not have, since it makes a package', async () => {
    const repo = await workspace(MANIFEST);
    const diff = await installDiff(pointWith(repo, { 'yarn.lock': BEFORE }), ['packages/ds/package.json'], repo);

    expect(diff && 'moved' in diff && diff.moved).toEqual(['packages/ds/package.json']);
  });
});

describe('the package edges the install contributes to the graph', () => {
  it('is what one package rests on, as pairs the graph reads left to right', async () => {
    const at = await repository(`# yarn lockfile v1


jest-environment-jsdom@^29.0.0:
  version "29.7.0"
  resolved "https://registry.yarnpkg.com/x/-/x-29.7.0.tgz#a"
  integrity sha512-a
  dependencies:
    jsdom "^20.0.0"

jsdom@^20.0.0:
  version "20.0.3"
  resolved "https://registry.yarnpkg.com/jsdom/-/jsdom-20.0.3.tgz#b"
  integrity sha512-b
`);

    // The chain the whole feature was asked for: a `jsdom` bump reaches the
    // jest environment that rests on it, which reaches the config that wires
    // it in.
    expect(await installedDepends(at)).toEqual([['jest-environment-jsdom', 'jsdom']]);
  });

  it('is empty, not a refusal, where there is no install to read', async () => {
    const at = await mkdtemp(join(tmpdir(), 'va-install-'));
    expect(await installedDepends(at)).toEqual([]);
  });
});
