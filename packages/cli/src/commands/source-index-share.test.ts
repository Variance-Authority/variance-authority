import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  readPublishedSources,
  SOURCE_INDEX_VERSION,
  sourceIndexChain,
  sourceIndexPath,
  sourceIndexWrittenIn,
  updateSourceIndex,
} from '@variance-authority/sense';
import { testCoverageFile } from '@variance-authority/sense/test-selection';
import { indexOutput } from './index-command.js';
import { BEFORE, DISCOUNTS, PUSH, cloneOf, collectedBoth, git, originAndCi, ranWhole, recordIn } from './mainline-fixture.js';
import { suiteBase } from './suite-base.js';
import { publishSuite } from './suite-share.js';

/**
 * A release that changes the source index's format, met by a checkout whose
 * repository opted in to carrying CI's index beside the mainline's record.
 */

const asked = vi.hoisted(() => ({ names: [] as string[] }));
vi.mock('./mainline-entry.js', async (actual) => {
  const real = await actual<typeof import('./mainline-entry.js')>();
  return {
    ...real,
    // The share as it is, with every entry it is asked for written down.
    mainlineEntry: (...args: Parameters<typeof real.mainlineEntry>) => {
      asked.names.push(String(args[1]));
      return real.mainlineEntry(...args);
    },
  };
});

let home: string;
const cwd = process.cwd();
const OLDER = SOURCE_INDEX_VERSION - 1;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'variance-source-index-share-'));
  asked.names = [];
});

afterEach(async () => {
  process.chdir(cwd);
  vi.unstubAllEnvs();
  await rm(home, { recursive: true, force: true });
});

/** Five modules that import one another, the record's `src/total.ts` among them. */
const SOURCES: Readonly<Record<string, string>> = {
  'src/total.ts': BEFORE,
  'src/a.ts': "import { applyDiscount } from './total';\nexport const a = applyDiscount(10);\n",
  'src/b.ts': "import { a } from './a';\nexport const b = a + 1;\n",
  'src/c.ts': "import { b } from './b';\nexport const c = b + 1;\n",
  'src/d.ts': "import { c } from './c';\nexport const d = c + 1;\n",
  'test/total.test.ts': "import { applyDiscount } from '../src/total';\nit('discounts', () => applyDiscount(1));\n",
  'test/other.test.ts': "it('stands alone', () => {});\n",
};

/**
 * CI on `main`: `variance index`, then the whole suite's record published by
 * `share --suite` to a directory share, which carries the index when `opted`.
 */
async function mainlinePublished(opted: boolean) {
  const { origin, ci } = await originAndCi(home);
  for (const [file, text] of Object.entries(SOURCES)) {
    await mkdir(join(ci, file, '..'), { recursive: true });
    await writeFile(join(ci, file), text);
  }
  const share = { kind: 'directory', root: join(home, 'share'), mainlines: ['main'], ...(opted ? { sourceIndex: true } : {}) };
  await writeFile(join(ci, 'variance.config.json'), JSON.stringify({ suites: { unit: { kind: 'unit', carry: 'share' } }, share }));
  await git(ci, 'add', '-A');
  await git(ci, 'commit', '--quiet', '-m', 'first');
  const first = await git(ci, 'rev-parse', 'HEAD');
  await git(ci, 'remote', 'add', 'origin', origin);
  await git(ci, 'push', '--quiet', 'origin', 'main');
  await git(ci, 'fetch', '--quiet', 'origin');

  vi.stubEnv('VARIANCE_AUTHORITY_CACHE', join(home, 'ci-cache'));
  await updateSourceIndex(ci);
  await recordIn(ci, first, ['test/total.test.ts'], [DISCOUNTS]);
  await ranWhole(testCoverageFile(ci, { suite: 'unit' }), first);
  const done = await publishSuite(ci, 'unit', { env: PUSH }, { collected: await collectedBoth(home) });
  return { ci, origin, first, written: 'published' in done ? done.published.written : [] };
}

/**
 * A clone of `origin` with one module edited, whose index an earlier release
 * built. `before` changes it before anything reads it: the root config is read
 * once per process.
 */
async function laptopOnOlderRelease(origin: string, before: (clone: string) => Promise<void> = async () => undefined) {
  const clone = await cloneOf(home, origin);
  await before(clone);
  vi.stubEnv('VARIANCE_AUTHORITY_CACHE', join(home, 'clone-cache'));
  await writeFile(join(clone, 'src/c.ts'), "import { b } from './b';\nexport const c = b + 2;\n");
  await updateSourceIndex(clone);
  await asOlderRelease(sourceIndexPath(clone));
  process.chdir(clone);
  return clone;
}

/**
 * The index at `path` as the release before this one wrote it: each segment's
 * header names the older format version, and every digest is its bytes' own.
 */
async function asOlderRelease(path: string): Promise<void> {
  const chain = await sourceIndexChain(path);
  if (chain === undefined) throw new Error(`no index at ${path}`);
  const length = chain.manifest.readUInt32LE(8);
  const manifest = JSON.parse(chain.manifest.subarray(12, 12 + length).toString('utf8')) as { segments: { digest: string; length: number }[] };
  const current = `"version":${String(SOURCE_INDEX_VERSION)},`;
  manifest.segments = [];
  for (const segment of chain.segments) {
    const bytes = await readFile(segment.path);
    const at = bytes.indexOf(current);
    expect(at).toBeGreaterThan(0);
    const older = Buffer.concat([bytes.subarray(0, at), Buffer.from(`"version":${String(OLDER)},`), bytes.subarray(at + current.length)]);
    const digest = `v1:${createHash('sha256').update(older).digest('hex').slice(0, 32)}`;
    await writeFile(join(`${path}.segments`, `${digest.replace(':', '-')}.bin`), older);
    await rm(segment.path);
    manifest.segments.push({ digest, length: older.length });
  }
  const json = Buffer.from(JSON.stringify(manifest), 'utf8');
  const head = Buffer.alloc(4);
  head.writeUInt32LE(json.length);
  await writeFile(path, Buffer.concat([chain.manifest.subarray(0, 8), head, json]));
  expect(await sourceIndexWrittenIn(path)).toBe(OLDER);
}

/** The records an index built from nothing holds for `root`. */
async function coldRecords(root: string) {
  const cold = join(home, 'cold', 'source-index.bin');
  await mkdir(join(home, 'cold'), { recursive: true });
  await updateSourceIndex(root, { index: cold });
  return (await readPublishedSources(cold)).records;
}

describe('`variance index` over an index another release wrote', () => {
  it('starts from the index the mainline published beside its record, and reads again only the module that differs from it', async () => {
    const { origin, first, written } = await mainlinePublished(true);
    expect(written).toEqual(['suite-v1/unit', `source-index-v${String(SOURCE_INDEX_VERSION)}`]);
    const clone = await laptopOnOlderRelease(origin);

    const out = await indexOutput({ cwd: clone });

    const path = sourceIndexPath(clone);
    expect(out.split('\n')[0]).toBe(
      `source index rebuilt from the one fetched, main's at ${first.slice(0, 12)} over one written in format version ${String(OLDER)}: ` +
        `${String(Object.keys(SOURCES).length)} files, 1 read again, at ${path}`,
    );
    expect(await sourceIndexWrittenIn(path)).toBe(SOURCE_INDEX_VERSION);
    expect(await sourceIndexChain(`${path}.fetched`)).toBeUndefined();
    expect((await readPublishedSources(path)).records).toEqual(await coldRecords(clone));
  });

  it('publishes no index for a repository that did not opt in', async () => {
    const { written } = await mainlinePublished(false);

    expect(written).toEqual(['suite-v1/unit']);
    const held = await readdir(join(home, 'share'), { recursive: true });
    expect(held.filter((name) => name.includes('source-index'))).toEqual([]);
  });

  it('fetches nothing for a checkout whose configuration does not opt in, though the share holds an index, and reads every file', async () => {
    const { origin, written } = await mainlinePublished(true);
    expect(written).toContain(`source-index-v${String(SOURCE_INDEX_VERSION)}`);
    const clone = await laptopOnOlderRelease(origin, async (at) => {
      const config = JSON.parse(await readFile(join(at, 'variance.config.json'), 'utf8')) as { share: Record<string, unknown> };
      delete config.share.sourceIndex;
      await writeFile(join(at, 'variance.config.json'), JSON.stringify(config));
    });
    asked.names = [];

    const out = await indexOutput({ cwd: clone });

    expect(asked.names.filter((name) => name.startsWith('source-index-'))).toEqual([]);
    const path = sourceIndexPath(clone);
    const files = Object.keys(SOURCES).length;
    expect(out.split('\n')[0]).toBe(
      `source index rebuilt over one written in format version ${String(OLDER)}: ${String(files)} files, ${String(files)} read again, at ${path}`,
    );
    expect(await sourceIndexChain(`${path}.fetched`)).toBeUndefined();
  });

  it('reads the mainline record without asking the share for the index, which only an update fetches', async () => {
    const { origin, first } = await mainlinePublished(true);
    const clone = await laptopOnOlderRelease(origin);
    asked.names = [];

    const base = await suiteBase(clone, { env: {} });

    expect(base).toMatchObject({ mainline: { mainline: 'main', commit: first } });
    expect(asked.names.filter((name) => name.startsWith('source-index-'))).toEqual([]);
    expect(await sourceIndexWrittenIn(sourceIndexPath(clone))).toBe(OLDER);
  });
});
