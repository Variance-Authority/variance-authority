import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LEXICON_CAP, type SubjectComposition } from '@variance-authority/core/attribute';
import { readSuiteIndex } from '@variance-authority/report/file';
import { decodeSuiteIndex, encodeSuiteIndex } from '@variance-authority/report/suite-index';
import { main } from '../bin.js';
import type { Config } from '../config.js';
import { EXIT_OPERATOR } from '../exit.js';
import { composeReports } from './compose.js';
import { SOURCE, SUITE, instance } from './compose-fixture.js';
import { IDENTITY } from './run-fixture.js';
import { suitePartPath, writeCliRunReport, shardOwnedBecause, type CliRunReport } from './run-report.js';
import { publishedLine, suiteIndexPath } from './share.js';
import {
  composeSuiteIndex,
  encodeSuitePart,
  openSuitePart,
  shareOutput,
  suitePartOf,
  writeSuitePart,
  type SuitePart,
} from './suite-part.js';

/**
 * The suite index of a sharded build. The claim is parity: every shard's part,
 * composed, is the index one run holding every subject would have written —
 * including the two answers no shard can count alone.
 */

const COMMIT = '3f1c9a0e';

/** The index an unsharded run writes over these subjects. */
function whole(subjects: readonly SubjectComposition[]) {
  const { sections } = composeReports({ subjects, observations: [], source: SOURCE });
  return {
    commit: COMMIT,
    subjects: sections.composition!.subjects,
    components: sections.composition!.components,
    lexicon: sections.lexicon,
  };
}

/** Each shard's part, where `owner` places plan position `i` on a shard. */
function parts(subjects: readonly SubjectComposition[], total: number, owner: (i: number) => number): SuitePart[] {
  return Array.from({ length: total }, (_, k) => {
    const slots = subjects.map((subject, i) => (owner(i) === k + 1 ? subject : null));
    const { reading } = composeReports({ subjects: slots, observations: [], source: SOURCE });
    return suitePartOf(slots, reading, COMMIT, { index: k + 1, total });
  });
}

describe('a composed suite index', () => {
  it('is the index one run would write, though no shard held every rendering of Button', () => {
    const shards = parts(SUITE, 2, (i) => (i < 2 ? 1 : 2));
    const button = (index: ReturnType<typeof whole>) => index.components.find((c) => c.component === 'Button');

    const first = composeReports({ subjects: [SUITE[0]!, SUITE[1]!], observations: [], source: SOURCE });
    expect(first.sections.composition?.components.find((c) => c.component === 'Button')?.renderings).toBe(1);
    expect(button(whole(SUITE))?.renderings).toBe(2);

    expect(composeSuiteIndex(shards, COMMIT)).toEqual(whole(SUITE));
    expect(composeSuiteIndex([...shards].reverse(), COMMIT)).toEqual(whole(SUITE));
  });

  it('caps each lexicon field by how widely the whole suite holds a value', () => {
    const tokens = (from: number, to: number) =>
      Array.from({ length: to - from }, (_, i) => `--t${String(from + i).padStart(3, '0')}`);
    const suite: SubjectComposition[] = [
      { subject: 'story:wide', instances: [instance({ component: 'Wide', tokens: tokens(0, LEXICON_CAP + 50) })] },
      { subject: 'story:common', instances: [instance({ component: 'Common', tokens: tokens(0, LEXICON_CAP) })] },
    ];
    const composed = composeSuiteIndex(parts(suite, 2, (i) => i + 1), COMMIT);
    const kept = (index: unknown) =>
      (index as ReturnType<typeof whole>).lexicon?.subjects[0]?.terms.tokens ?? [];

    expect(composed).toEqual(whole(suite));
    // The fifty only `story:wide` holds survive the cap, which one shard could not know.
    expect(kept(composed)).toContain(`--t${String(LEXICON_CAP + 49)}`);
  });

  it('takes where a component is declared from the same shard, in whatever order the parts arrive', () => {
    const [one, two] = parts(SUITE, 2, (i) => (i < 2 ? 1 : 2));
    // Both shards rendered Button, and their engines placed it in different files.
    const a = { ...one!, declaredIn: { Button: ['src/one/Button.tsx'] } };
    const b = { ...two!, declaredIn: { Button: ['src/two/Button.tsx'] } };
    const forward = composeSuiteIndex([a, b], COMMIT);
    expect(composeSuiteIndex([b, a], COMMIT)).toEqual(forward);
    expect((forward as { lexicon?: { declaredIn?: unknown } }).lexicon?.declaredIn).toEqual({ Button: ['src/one/Button.tsx'] });
  });

  it('refuses a build with a shard missing, one cut two ways, one named twice, or one subject twice', () => {
    const [one, two] = parts(SUITE, 2, (i) => (i === 0 ? 1 : 2));
    const cutThree = parts(SUITE, 3, (i) => i + 1)[2]!;

    expect(composeSuiteIndex([one!], COMMIT)).toBe('shard 2/2 is missing');
    expect(composeSuiteIndex([one!, two!, cutThree], COMMIT)).toBe('the shards were cut 2 ways and 3 ways');
    expect(composeSuiteIndex([one!, { ...two!, shard: { index: 1, total: 2 } }], COMMIT)).toBe('shard 2/2 is missing');
    expect(composeSuiteIndex([one!, two!, two!], COMMIT)).toBe('shard 2/2 was given twice');
    expect(composeSuiteIndex([one!, { ...two!, subjects: one!.subjects }], COMMIT)).toMatch(/was composed by two shards/);
  });

  it('refuses an unsharded part beside a shard, and two unsharded parts', () => {
    const [one] = parts(SUITE, 2, (i) => (i === 0 ? 1 : 2));
    const { shard: _, ...whole } = one!;

    expect(composeSuiteIndex([one!, whole], COMMIT)).toBe('an unsharded part was given with shard 1/2; they are not one build');
    expect(composeSuiteIndex([whole, whole], COMMIT)).toBe('two unsharded parts were given; they are not one build');
  });
});

describe('share --publish over every shard', () => {
  let home: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'variance-suite-part-'));
    process.env['VARIANCE_AUTHORITY_CACHE'] = home;
  });

  afterEach(() => {
    delete process.env['VARIANCE_AUTHORITY_CACHE'];
  });

  const configOf = (root?: string): Config =>
    ({
      project: 'web',
      report: join(home, 'run.json'),
      ...(root === undefined ? {} : { share: { kind: 'directory', root, mainlines: ['main'] } }),
    }) as Config;

  /** A push to `main` in a checkout of its own, so the line is git's answer and not this worktree's. */
  async function pushed(): Promise<{ readonly env: Record<string, string>; readonly cwd: string }> {
    const cwd = await mkdtemp(join(home, 'repo-'));
    const git = (...args: string[]) => promisify(execFile)('git', args, { cwd });
    await git('init', '--quiet', '-b', 'main');
    await git('-c', 'user.email=test@example.com', '-c', 'user.name=Test', 'commit', '--quiet', '--allow-empty', '-m', 'one');
    const env = { GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: 'push', GITHUB_REF_TYPE: 'branch', GITHUB_REF_NAME: 'main' };
    return { env, cwd };
  }

  /** Shard `k` of two: it observed its subject and left the other to its owner. */
  function shardReport(k: number): CliRunReport {
    const [mine, theirs] = k === 1 ? ['story:ds-button--danger', 'story:page--default'] : ['story:page--default', 'story:ds-button--danger'];
    return {
      runVersion: 1,
      at: '2026-09-27T10:00:00.000Z',
      identity: IDENTITY,
      retention: 'durable',
      run: { id: 'build-1', commit: COMMIT },
      observations: [{ subject: mine!, verdict: 'unchanged', because: 'nothing moved', regions: [] }],
      notObserved: [{ subject: theirs!, kind: 'excluded', because: shardOwnedBecause(3 - k, 2, 'checksum') }],
    } as CliRunReport;
  }

  async function writeShards(withParts: boolean): Promise<string[]> {
    const suite = SUITE.slice(0, 2);
    const shards = parts(suite, 2, (i) => i + 1);
    return Promise.all(
      [1, 2].map(async (k) => {
        const path = join(home, `shard-${String(k)}`, 'run.json');
        await writeCliRunReport(path, shardReport(k));
        if (withParts) await writeSuitePart(path, shards[k - 1]!);
        return path;
      }),
    );
  }

  it('publishes the composed index once, under the build commit, and refuses one shard alone', async () => {
    const root = join(home, 'share');
    const reports = await writeShards(true);

    expect((await openSuitePart(suitePartPath(reports[0]!)))?.shard).toEqual({ index: 1, total: 2 });
    expect(await shareOutput(configOf(root), { publish: true, reports: [reports[0]!] })).toContainEqual(
      expect.stringMatching(/is one shard of a build/),
    );
    expect(await publishedLine(configOf(root), shardReport(1), reports[0])).toMatch(
      /not kept from one shard; its part is .*run\.suite-part\.json, for the merge/,
    );
    expect(await readdir(home)).not.toContain('share');

    const lines = await shareOutput(configOf(root), { publish: true, reports }, await pushed());
    expect(lines[0]).toMatch(/composed from 2 shard\(s\)/);
    expect(lines[1]).toMatch(/^wrote suite-index-v2 to mainline main /);
    expect(await readSuiteIndex(suiteIndexPath(configOf(), COMMIT))).toEqual(
      decodeSuiteIndex(encodeSuiteIndex(whole(SUITE.slice(0, 2)))),
    );
  });

  it('names the report whose part is missing, and publishes nothing', async () => {
    const reports = await writeShards(false);
    const lines = await shareOutput(configOf(), { publish: true, reports });
    expect(lines[0]).toBe(`nothing published: ${reports[0]} has no ${join(home, 'shard-1', 'run.suite-part.json')} beside it.`);
  });

  it('refuses a part it cannot read by its path, through the binary, and publishes nothing', async () => {
    const root = join(home, 'share');
    const reports = await writeShards(true);
    const torn = suitePartPath(reports[1]!);
    await writeFile(torn, '{"version":2,"planned":2,"subjects":[]}\n');
    const config = join(home, 'variance.config.json');
    await writeFile(
      config,
      JSON.stringify({
        project: 'web',
        profile: 'chromium',
        viewport: { width: 1280, height: 800 },
        retention: 'ephemeral',
        subjects: { kind: 'list', ids: ['story:ds-button--danger', 'story:page--default'], collector: './collector.mjs' },
        fonts: [],
        report: 'run.json',
        share: { kind: 'directory', root, mainlines: ['main'] },
      }),
    );

    let out = '';
    let err = '';
    const code = await main(['share', '--publish', ...reports, '--config', config], {
      out: (text) => (out += text),
      err: (text) => (err += text),
    });

    expect({ code, out, err: err.split('\n')[0] }).toEqual({
      code: EXIT_OPERATOR,
      out: '',
      err: `nothing published: ${torn} is not a suite part this version reads.`,
    });
    expect(await readdir(home)).not.toContain('share');
  });
});

describe('a part on disk', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'variance-suite-part-disk-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('is written canonically, so equal parts are equal bytes whoever wrote them', async () => {
    const [part] = parts(SUITE, 1, () => 1);
    const report = join(root, 'run.json');
    await writeSuitePart(report, part!);

    expect(new Uint8Array(await readFile(suitePartPath(report)))).toEqual(encodeSuitePart(part!));
    expect(await openSuitePart(suitePartPath(report))).toEqual(part);
  });

  it('refuses a torn part by its path, and reads nothing where there is none', async () => {
    const report = join(root, 'run.json');
    expect(await openSuitePart(suitePartPath(report))).toBeUndefined();

    await writeFile(suitePartPath(report), '{"version":');
    expect(await openSuitePart(suitePartPath(report))).toBe(`${suitePartPath(report)} is not JSON`);
  });
});
