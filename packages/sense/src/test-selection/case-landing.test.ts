import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { landCases, lastCaseRunOf, layCases } from './case-landing.js';
import type { CaseSections } from './case-record.js';
import { CrossingSets } from './crossing-sets.js';
import { decodeExecutionIndex, encodeExecutionIndex } from './execution-format.js';
import { decodeRecordedEyes, encodeRecordedEyes, type EyesSection, type RecordedEyes } from './eyes-record.js';
import {
  encodeAsSetExecutionIndex,
  encodeSetExecutionIndex,
  openSetExecutionIndex,
  type SetExecutionModule,
} from './execution-set-format.js';
import { writeTestCoverage } from './index.js';

/** The regions of `src/shared.ts`, which every run here loads whole. */
const regions = ['alpha', 'beta', 'gamma'];

/**
 * A case index as a fold writes one: each case by id, and the regions of
 * `src/shared.ts` it called, one a line in the order `layout` names them.
 */
function index(calls: Record<string, readonly string[]>, layout: readonly string[] = regions, first = 1): Buffer {
  const cases = Object.keys(calls);
  const tests = cases.map((id) => ({ id, file: id.split(' > ')[0]!, name: id.split(' > ')[1]! }));
  const sets = new CrossingSets(tests.length);
  sets.intern([]);
  const module: SetExecutionModule = {
    file: 'src/shared.ts',
    blocks: layout.map((name, line) => ({ kind: 'function', name, path: name, startLine: line + first, endLine: line + first, source: true })),
    called: Uint32Array.from(layout, (name) => sets.intern(cases.flatMap((id, at) => (calls[id]!.includes(name) ? [at] : [])))),
    loaded: new Uint8Array(layout.length),
  };
  return encodeSetExecutionIndex({ tests, modules: [module], sets: sets.pool() });
}

/** The cases an index names, with the regions each called. */
function read(bytes: Uint8Array | undefined): Record<string, string[]> {
  const decoded = decodeExecutionIndex(bytes!);
  const calls: Record<string, string[]> = Object.fromEntries(decoded.tests.map((test) => [test.id, []]));
  for (const module of decoded.modules) {
    for (const block of module.blocks) for (const crossing of block.crossings) calls[decoded.tests[crossing.test]!.id]!.push(block.name);
  }
  return calls;
}

const whole = (file: string) => ({ file, complete: true });

/** A shard's record, carrying the cases its seam kept. */
async function shard(name: string, cases: Uint8Array, eyes?: EyesSection): Promise<string> {
  const at = join(root, name);
  await writeTestCoverage(at, { version: 3, instrumentation: 'fixture', tests: [], modules: [] }, {
    index: cases,
    ...(eyes === undefined ? {} : { eyes: encodeRecordedEyes(eyes) }),
  });
  return at;
}

let root: string;
let record: string;
/** What a local run at `l0ca1` left in the record: `a` and `b` recorded. */
let previous: CaseSections;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'variance-case-landing-'));
  for (const file of ['a.test.ts', 'b.test.ts', 'c.test.ts']) await writeFile(join(root, file), '');
  record = join(root, 'coverage.bin');
  previous = {
    index: index({ 'a.test.ts > one': ['alpha'], 'b.test.ts > two': ['beta'] }),
    last: Buffer.from(JSON.stringify({
      commit: 'l0ca1', at: '2026-09-29T00:00:00.000Z', files: ['a.test.ts', 'b.test.ts'], cases: ['a.test.ts > one', 'b.test.ts > two'],
    })),
  };
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('landCases', () => {
  it('lays each shard\'s case index over the sections the record held, as the runs they were', async () => {
    // Shard 1 re-recorded `b`, whose case now calls `gamma`; shard 2 recorded `c`, which the index never had.
    const first = await shard('shard-1.bin', index({ 'b.test.ts > two': ['gamma'] }));
    const second = await shard('shard-2.bin', index({ 'c.test.ts > three': ['alpha'] }));

    const { landing, sections } = landCases(record, previous, root, [
      { path: first, coverage: { commit: 'c0ffee', tests: [whole('b.test.ts')] } },
      { path: second, coverage: { commit: 'c0ffee', tests: [whole('c.test.ts')] } },
    ]);

    expect(landing).toEqual({ laid: record, shards: 2 });
    expect(read(sections.index)).toEqual({
      'a.test.ts > one': ['alpha'],
      'b.test.ts > two': ['gamma'],
      'c.test.ts > three': ['alpha'],
    });
    // Two shards of one run: the last run names both and every case either
    // ran, and the before layer is what the index held for their files at the
    // local run's commit.
    expect(lastCaseRunOf(sections)).toMatchObject({
      commit: 'c0ffee', before: 'l0ca1', files: ['b.test.ts', 'c.test.ts'], cases: ['b.test.ts > two', 'c.test.ts > three'],
    });
    expect(read(sections.before)).toEqual({ 'b.test.ts > two': ['beta'] });
  });

  it('names no case of the last run that a later shard retired by finishing its file again', async () => {
    // Both shards ran `c`; the second finished it without `c.test.ts > gone`, so the index no longer holds that case.
    const first = await shard('shard-1.bin', index({ 'b.test.ts > two': ['gamma'], 'c.test.ts > gone': ['beta'] }));
    const second = await shard('shard-2.bin', index({ 'c.test.ts > three': ['alpha'] }));

    const { sections } = landCases(record, previous, root, [
      { path: first, coverage: { commit: 'c0ffee', tests: [whole('b.test.ts'), whole('c.test.ts')] } },
      { path: second, coverage: { commit: 'c0ffee', tests: [whole('c.test.ts')] } },
    ]);

    expect(Object.keys(read(sections.index))).not.toContain('c.test.ts > gone');
    expect(lastCaseRunOf(sections)?.cases).toEqual(['b.test.ts > two', 'c.test.ts > three']);
  });

  it('cuts every shard\'s before layer from the index the landing began with, at the text it was cut from', async () => {
    // Both shards ran over a `src/shared.ts` that gained `delta` above the
    // rest. The first shard re-cut the module to that text; the second's
    // cases of it before the change are the base's, at the base's lines.
    const head = ['delta', ...regions];
    const changed = [{ file: 'src/shared.ts', sourceDigest: 'v1:head' }];
    const first = await shard('shard-1.bin', index({ 'a.test.ts > one': ['alpha'] }, head));
    const second = await shard('shard-2.bin', index({ 'b.test.ts > two': ['beta'] }, head));

    const { sections } = landCases(record, previous, root, [
      { path: first, coverage: { commit: 'c0ffee', tests: [whole('a.test.ts')], modules: changed } },
      { path: second, coverage: { commit: 'c0ffee', tests: [whole('b.test.ts')], modules: changed } },
    ], new Map([['src/shared.ts', 'v1:base']]));

    const before = decodeExecutionIndex(sections.before!);
    expect(before.modules.map((module) => [module.file, module.blocks.map((block) => `${block.name}@${block.startLine}`)])).toEqual([
      ['src/shared.ts', ['alpha@1', 'beta@2', 'gamma@3']],
    ]);
    expect(read(sections.before)).toEqual({ 'a.test.ts > one': ['alpha'], 'b.test.ts > two': ['beta'] });
    expect(lastCaseRunOf(sections)).toMatchObject({ before: 'l0ca1', beforeTexts: { 'src/shared.ts': 'v1:base' } });
  });

  it('names the text a run at the same commit re-cut a before module to, so a reader can tell it from the base', () => {
    // Two local invocations at one commit: the second has only the index the
    // first laid, whose `src/shared.ts` is already cut to the new text.
    const head = ['delta', ...regions];
    const changed = [{ file: 'src/shared.ts', sourceDigest: 'v1:head' }];
    const once = layCases(previous, index({ 'a.test.ts > one': ['alpha'] }, head), root, {
      commit: 'c0ffee', tests: [whole('a.test.ts')], modules: changed,
    }, undefined, new Map([['src/shared.ts', 'v1:base']]));
    expect(lastCaseRunOf(once)?.beforeTexts).toEqual({ 'src/shared.ts': 'v1:base' });

    const twice = layCases(once, index({ 'b.test.ts > two': ['beta'] }, head), root, {
      commit: 'c0ffee', tests: [whole('b.test.ts')], modules: changed,
    }, undefined, new Map([['src/shared.ts', 'v1:head']]));

    expect(lastCaseRunOf(twice)?.beforeTexts).toEqual({ 'src/shared.ts': 'v1:head' });
  });

  it('keeps a before module an earlier shard re-cut at its lines when a later shard that did not record it retires cases of it', async () => {
    // The snapshot names `v1:new`, the text two lines written above the
    // module moved it to; the index still stands at the lines before them.
    // Shard 1 recorded the module from `v1:new`; shard 2 retired `b`, whose
    // case entered it in the base, without loading it.
    const changed = [{ file: 'src/shared.ts', sourceDigest: 'v1:new' }];
    const first = await shard('shard-1.bin', index({ 'a.test.ts > one': ['alpha'] }, regions, 3));
    const second = await shard('shard-2.bin', encodeSetExecutionIndex({
      tests: [{ id: 'b.test.ts > two', file: 'b.test.ts', name: 'two' }],
      modules: [],
      sets: (() => {
        const sets = new CrossingSets(1);
        sets.intern([]);
        return sets.pool();
      })(),
    }));

    const { sections } = landCases(record, previous, root, [
      { path: first, coverage: { commit: 'c0ffee', tests: [whole('a.test.ts')], modules: changed } },
      { path: second, coverage: { commit: 'c0ffee', tests: [whole('b.test.ts')], modules: [] } },
    ], new Map([['src/shared.ts', 'v1:new']]));

    const before = decodeExecutionIndex(sections.before!);
    expect(before.modules.map((module) => module.blocks.map((block) => `${block.name}@${block.startLine}`))).toEqual([
      ['alpha@3', 'beta@4', 'gamma@5'],
    ]);
    expect(read(sections.before)).toEqual({ 'a.test.ts > one': ['alpha'], 'b.test.ts > two': ['beta'] });
    expect(lastCaseRunOf(sections)?.beforeTexts).toEqual({ 'src/shared.ts': 'v1:new' });
  });

  it('names no text for a before module cut at older lines than the text it is named at, which nothing could carry', () => {
    // The snapshot names `v1:base` and the run recorded it; the index stands
    // every region a line higher, and a callback written in front renumbered them.
    const seated = { ...previous, index: index({ 'a.test.ts > one': ['anon#0'], 'b.test.ts > two': ['anon#1'] }, ['anon#0', 'anon#1']) };

    const sections = layCases(seated, index({ 'a.test.ts > one': ['anon#1'] }, ['lead', 'anon#0', 'anon#1', 'anon#2']), root, {
      commit: 'c0ffee', tests: [whole('a.test.ts')], modules: [{ file: 'src/shared.ts', sourceDigest: 'v1:base' }],
    }, undefined, new Map([['src/shared.ts', 'v1:base']]));

    expect(read(sections.before)).toEqual({ 'a.test.ts > one': ['anon#0'] });
    expect(lastCaseRunOf(sections)?.beforeTexts).toEqual({});
  });

  it('names no text for a before layer kept in the row spelling, so a reader compares it as it always did', () => {
    // A record the row-spelling seams laid at this commit: neither layer opens as sets, so this run cuts no before of its own.
    const rows = encodeExecutionIndex(decodeExecutionIndex(index({ 'a.test.ts > one': ['alpha'] })));
    const last = JSON.parse(previous.last!.toString()) as object;
    const laid = { index: rows, before: rows, last: Buffer.from(JSON.stringify({ ...last, commit: 'c0ffee' })) };

    const sections = layCases(laid, index({ 'b.test.ts > two': ['beta'] }), root, {
      commit: 'c0ffee', tests: [whole('b.test.ts')], modules: [{ file: 'src/shared.ts', sourceDigest: 'v1:head' }],
    }, undefined, new Map([['src/shared.ts', 'v1:base']]));

    expect(Buffer.from(sections.before!).equals(rows)).toBe(true);
    expect(lastCaseRunOf(sections)?.beforeTexts).toBeUndefined();
  });

  it('drops the index and both of its layers when a shard that finished a file left no index it can lay', async () => {
    const held = { ...previous, before: index({ 'a.test.ts > one': ['alpha'] }) };
    // Bytes no reader in this build can decode, so no run is laid from them.
    const first = await shard('shard-1.bin', Buffer.from('not a case index'));

    const { landing, sections } = landCases(record, held, root, [
      { path: first, coverage: { commit: 'c0ffee', tests: [whole('b.test.ts')] } },
      { path: join(root, 'shard-2.bin'), coverage: { commit: 'c0ffee', tests: [whole('c.test.ts')] } },
    ]);

    expect(landing).toEqual({ unanswered: record, shard: first, removed: true });
    expect(sections).toEqual({});
  });

  it('lays a shard index in the row spelling, which the Playwright and Storybook seams wrote before they laid their own', async () => {
    const block = (name: string, line: number) => ({ kind: 'function', name, path: name, startLine: line, endLine: line, source: true });
    const rows = await shard('shard-1.bin', encodeExecutionIndex({
      tests: [{ id: 'b.test.ts > two', file: 'b.test.ts', name: 'two' }],
      modules: [{ file: 'src/shared.ts', blocks: [
        { ...block('alpha', 1), crossings: [] },
        { ...block('beta', 2), crossings: [] },
        { ...block('gamma', 3), crossings: [{ test: 0, distance: 0 }] },
      ] }],
    }));

    const { landing, sections } = landCases(record, previous, root, [
      { path: rows, coverage: { commit: 'c0ffee', tests: [whole('b.test.ts')] } },
    ]);

    expect(landing).toEqual({ laid: record, shards: 1 });
    expect(read(sections.index)).toEqual({ 'a.test.ts > one': ['alpha'], 'b.test.ts > two': ['gamma'] });
  });

  it('spells a row index as sets without losing a case, and refuses one that records a depth', () => {
    const block = { kind: 'function', name: 'alpha', path: 'alpha', startLine: 1, endLine: 1, source: true };
    const rows = {
      tests: [{ id: 'a.test.ts > one', file: 'a.test.ts', name: 'one' }, { id: 'a.test.ts > two', file: 'a.test.ts', name: 'two' }],
      modules: [{ file: 'src/shared.ts', blocks: [
        { ...block, crossings: [{ test: 0, distance: 0 }, { test: 1, distance: 0, loaded: true }] },
        { ...block, name: 'beta', path: 'beta', loaded: true as const, crossings: [] },
      ] }],
    };

    const sets = encodeAsSetExecutionIndex(rows);

    expect(openSetExecutionIndex(sets)).toBeDefined();
    const decoded = decodeExecutionIndex(sets);
    expect(decoded.tests.map((test) => test.id)).toEqual(['a.test.ts > one', 'a.test.ts > two']);
    expect(decoded.modules[0]!.blocks.map((region) => region.crossings.map((crossing) => crossing.test))).toEqual([[0], []]);
    expect(decoded.modules[0]!.blocks.map((region) => region.loaded)).toEqual([true, true]);
    const deep = { ...rows, modules: [{ file: 'src/shared.ts', blocks: [{ ...block, crossings: [{ test: 0, distance: 2 }] }] }] };
    expect(() => encodeAsSetExecutionIndex(deep)).toThrow('src/shared.ts has a case at depth 2');
  });

  it('says there was nothing to drop when the record held no cases', () => {
    const at = join(root, 'shard-1.bin');

    const { landing, sections } = landCases(record, {}, root, [{ path: at, coverage: { tests: [whole('b.test.ts')] } }]);

    expect(landing).toEqual({ unanswered: record, shard: at, removed: false });
    expect(sections).toEqual({});
  });
});

/** A journal as Eyes closes one: what the case addressed, here a single phase. */
function journal(caseId: string, attempt: number, phase = 'act'): RecordedEyes {
  return { case: caseId, attempt, journal: { complete: true, attention: [{ kind: 'eyes-phase', phase, sequence: 0 }] } };
}

/** A run's Eyes: every case named opened a journal, and these closed one. */
function looked(...journals: RecordedEyes[]): EyesSection {
  return { watched: [...new Set(journals.map((row) => row.case))], journals };
}

describe('the Eyes journals a run lays', () => {
  it('lays each case\'s journals by case and attempt beside the index, and keeps the cases that did not run', () => {
    const held = { ...previous, eyes: encodeRecordedEyes(looked(journal('a.test.ts > one', 1), journal('b.test.ts > two', 1))) };

    const sections = layCases(held, index({ 'b.test.ts > two': ['gamma'] }), root, { commit: 'c0ffee', tests: [whole('b.test.ts')] }, looked(
      journal('b.test.ts > two', 2, 'assert'),
      journal('b.test.ts > two', 1, 'arrange'),
    ));

    expect(decodeRecordedEyes(sections.eyes!)).toEqual({
      watched: ['a.test.ts > one', 'b.test.ts > two'],
      journals: [journal('a.test.ts > one', 1), journal('b.test.ts > two', 1, 'arrange'), journal('b.test.ts > two', 2, 'assert')],
    });
  });

  it('retires a case\'s journals when it ran again without Eyes, and leaves no section when none is left', () => {
    const held = { ...previous, eyes: encodeRecordedEyes(looked(journal('b.test.ts > two', 1))) };

    const sections = layCases(held, index({ 'b.test.ts > two': ['gamma'] }), root, { commit: 'c0ffee', tests: [whole('b.test.ts')] });

    expect(sections.eyes).toBeUndefined();
  });

  it('keeps a section for a run that opened journals and closed none, so it does not read as a run without Eyes', () => {
    const sections = layCases(previous, index({ 'b.test.ts > two': ['gamma'] }), root, { commit: 'c0ffee', tests: [whole('b.test.ts')] }, {
      watched: ['b.test.ts > two'],
      journals: [],
    });

    expect(decodeRecordedEyes(sections.eyes!)).toEqual({ watched: ['b.test.ts > two'], journals: [] });
  });

  it('refuses a journal whose case the run did not record, rather than keep a reference nothing answers', () => {
    expect(() => layCases(previous, index({ 'b.test.ts > two': ['gamma'] }), root, { tests: [whole('b.test.ts')] }, looked(
      journal('b.test.ts > two (title)', 1),
    ))).toThrow('an Eyes journal names a case the run did not record: b.test.ts > two (title)');
  });

  it('lays over a section this build cannot read as over none, rather than fail every later run', () => {
    for (const eyes of [Buffer.from('not json'), Buffer.from('{"version":2,"rows":[]}\n')]) {
      const sections = layCases({ ...previous, eyes }, index({ 'b.test.ts > two': ['gamma'] }), root, { tests: [whole('b.test.ts')] }, looked(
        journal('b.test.ts > two', 1),
      ));

      expect(decodeRecordedEyes(sections.eyes!)).toEqual(looked(journal('b.test.ts > two', 1)));
    }
  });

  it('carries each shard\'s journals into the record it lands, and one journal two shards both hold once', async () => {
    const both = journal('c.test.ts > three', 1);
    const first = await shard('shard-1.bin', index({ 'b.test.ts > two': ['gamma'], 'c.test.ts > three': ['alpha'] }), looked(journal('b.test.ts > two', 1), both));
    const second = await shard('shard-2.bin', index({ 'c.test.ts > three': ['alpha'] }), looked(both));

    const { sections } = landCases(record, previous, root, [
      { path: first, coverage: { commit: 'c0ffee', tests: [whole('b.test.ts'), whole('c.test.ts')] } },
      { path: second, coverage: { commit: 'c0ffee', tests: [whole('c.test.ts')] } },
    ]);

    expect(decodeRecordedEyes(sections.eyes!)).toEqual(looked(journal('b.test.ts > two', 1), both));
  });

  it('keeps one of two different journals two shards hold for one attempt, and lands the rest', async () => {
    // Both shards ran `c`, and each closed a different journal for its first attempt.
    const acted = await shard('shard-1.bin', index({ 'c.test.ts > three': ['alpha'] }), looked(journal('c.test.ts > three', 1, 'act')));
    const carried = await shard('shard-2.bin', index({ 'b.test.ts > two': ['gamma'], 'c.test.ts > three': ['alpha'] }), looked(
      journal('b.test.ts > two', 1),
      journal('c.test.ts > three', 1, 'assert'),
    ));

    const { landing, sections } = landCases(record, previous, root, [
      { path: acted, coverage: { commit: 'c0ffee', tests: [whole('c.test.ts')] } },
      { path: carried, coverage: { commit: 'c0ffee', tests: [whole('b.test.ts'), whole('c.test.ts')] } },
    ]);

    expect(landing).toEqual({ laid: record, shards: 2 });
    expect(decodeRecordedEyes(sections.eyes!).journals.map((row) => [row.case, row.attempt])).toEqual([
      ['b.test.ts > two', 1],
      ['c.test.ts > three', 1],
    ]);
  });

  it('lands no journal a shard\'s seed carried for a case it did not run, so an older one cannot stand in for a newer', async () => {
    // Shard 1 ran `c`; shard 2 ran only `b`, and its seed holds an older `c` journal that sorts first.
    const ran = await shard('shard-1.bin', index({ 'c.test.ts > three': ['alpha'] }), looked(journal('c.test.ts > three', 1, 'assert')));
    const seeded = await shard('shard-2.bin', index({ 'b.test.ts > two': ['gamma'], 'c.test.ts > three': ['alpha'] }), {
      watched: ['b.test.ts > two', 'c.test.ts > three', 'd.test.ts > four'],
      journals: [journal('b.test.ts > two', 1), journal('c.test.ts > three', 1, 'act')],
    });

    const { sections } = landCases(record, previous, root, [
      { path: ran, coverage: { commit: 'c0ffee', tests: [whole('c.test.ts')] } },
      { path: seeded, coverage: { commit: 'c0ffee', tests: [whole('b.test.ts')] } },
    ]);

    expect(decodeRecordedEyes(sections.eyes!)).toEqual(looked(journal('b.test.ts > two', 1), journal('c.test.ts > three', 1, 'assert')));
  });

  it('keeps the same one of two journals for one attempt whichever order they are handed in', () => {
    const act = journal('c.test.ts > three', 1, 'act');
    const assert = journal('c.test.ts > three', 1, 'assert');

    expect(decodeRecordedEyes(encodeRecordedEyes(looked(act, assert)))).toEqual(decodeRecordedEyes(encodeRecordedEyes(looked(assert, act))));
    expect(decodeRecordedEyes(encodeRecordedEyes(looked(assert, act))).journals).toHaveLength(1);
  });

  it('lands a shard whose Eyes section this build cannot read as a shard that kept none', async () => {
    const at = join(root, 'shard-1.bin');
    await writeTestCoverage(at, { version: 3, instrumentation: 'fixture', tests: [], modules: [] }, {
      index: index({ 'b.test.ts > two': ['gamma'] }),
      eyes: Buffer.from('{"version":2,"journals":"elsewhere"}\n'),
    });

    const { landing, sections } = landCases(record, previous, root, [{ path: at, coverage: { commit: 'c0ffee', tests: [whole('b.test.ts')] } }]);

    expect(landing).toEqual({ laid: record, shards: 1 });
    expect(sections.eyes).toBeUndefined();
  });
});
