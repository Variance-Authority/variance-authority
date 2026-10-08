import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  caseSectionsAt,
  commitRunsFile,
  encodeExecutionIndex,
  landRun,
  testCoverageFile,
  withCaseSections,
  type ExecutionIndex,
} from '@variance-authority/sense/test-selection';
import { main } from '../bin.js';
import { readFlags } from '../args.js';
import { parseReviewArgs } from '../review-args.js';
import { flagsFor, synopsisFor } from '../usage.js';
import { probedModule } from './mainline-fixture.js';
import { review } from './review.js';
import { formatReview, REVIEW_MARKER } from './review-text.js';
import { AFTER, DISCOUNTS, ROUNDS, block, changed, git } from './review-fixture.js';

function parse(argv: readonly string[]) {
  return parseReviewArgs(readFlags(argv, 'review', flagsFor('review'), synopsisFor('review')));
}

describe('a review of what a change did, after the run that recorded it', () => {
  const cwd = process.cwd();
  // A review reads the pull request it runs for from CI's event, so these tests run as if outside CI.
  beforeEach(() => vi.stubEnv('GITHUB_ACTIONS', ''));
  afterEach(() => {
    process.chdir(cwd);
    vi.unstubAllEnvs();
  });

  it('reads the record of the suite it is named, or of the only suite the root declares', async () => {
    const { root, first, against } = await changed({ suites: ['unit'] });
    const regions = (answer: Awaited<ReturnType<typeof review>>) =>
      answer.files.find((file) => file.file === 'src/total.ts')?.regions?.map((region) => region.name);

    expect(regions(await review(parse(['--since', first, '--against', against, '--suite', 'unit', '--root', root])))).toEqual(['applyDiscount', 'round']);
    expect(regions(await review(parse(['--since', first, '--against', against, '--root', root])))).toEqual(['applyDiscount', 'round']);
  });

  it('refuses to pick one of several declared suites for the reader', async () => {
    const { root, first } = await changed({ suites: ['unit', 'browser'] });

    await expect(review(parse(['--since', first, '--root', root]))).rejects.toThrow(/declares the suites "browser", "unit"[^]*--suite <name>/);
  });

  it('reads each edit, counts the changed regions no case covered, and names the cases added', async () => {
    const { root, first, against } = await changed();

    const answer = await review(parse(['--since', first, '--against', against, '--root', root]));

    expect(answer).toMatchObject({ from: first, record: 'ran', base: 'since', suite: 1, before: [{ file: 'config.json', tests: 1 }] });
    const total = answer.files.find((file) => file.file === 'src/total.ts');
    // A new export changes what the module's namespace holds, so the reading is `values`, not `bodies`.
    expect(total?.verdict).toBe('values');
    expect(total?.regions?.map((region) => [region.name, region.reach, region.edit, region.changedLineCases, region.called])).toEqual([
      ['applyDiscount', 'near', 'modified', 1, [{ id: 'test/total.test.ts > discounts', file: 'test/total.test.ts', name: 'discounts' }]],
      ['round', 'unwalked', 'new', 0, []],
    ]);
    expect(answer.files.find((file) => file.file === 'test/total.test.ts')?.cases).toEqual({ added: ['rounds'], removed: [] });

    const text = formatReview(answer, 'text');
    expect(text).toContain('2 changed regions in 1 file: 1 new, 1 modified.');
    expect(text).toContain('- 1 no case covered: 1 new.');
    expect(text).toContain('Cases: 1 added, 0 removed, in 1 test file.');
    expect(text).toContain('- config.json: 1 of 1 test files');
    expect(text).toContain('  src/total.ts:5-7 function round — no case covered it (new)');

    const markdown = formatReview(answer, 'markdown');
    expect(markdown.startsWith(`${REVIEW_MARKER}\n`)).toBe(true);
    expect(markdown).toContain('### 🧭 What this change did');
    expect(markdown).toContain('> [!WARNING]\n> **1 of 2 changed functions has code no case ran:** `round`.');
    expect(markdown).toContain('<details><summary>🔴 Where no case ran: 1 place in 1 function</summary>\n\n- `src/total.ts:5-7` function `round` (new)');
    expect(markdown).toContain('| 🟢 | `applyDiscount` | modified | `src/total.ts:1-3` | 1 | 1 | `test/total.test.ts` |');
    expect(markdown).toContain('🟢 a test importing the file ran it · 🟡 only tests further away ran it');
    // The diagram of the changed functions follows their table, folded.
    expect(markdown.indexOf('"🔴 round · new<br/>no case"]:::none')).toBeGreaterThan(markdown.indexOf('| 🟢 | `applyDiscount`'));
    expect(markdown).not.toContain('| **');
    // The cases a change added are read before the counts of what ran.
    expect(markdown.indexOf('✏️ Cases added and removed')).toBeLessThan(markdown.indexOf('🔴 Where no case ran'));
    // A dirty tree is no commit, so nothing is linked and the header says so.
    expect(answer.head).toEqual({ commit: first, parents: [], dirty: true });
    expect(markdown).toContain(`Reviewed the working tree over \`${first.slice(0, 12)}\`. Changes since \`${first.slice(0, 12)}\`.`);
    expect(markdown).toContain('⚙️ `config.json` changed, and the one test file loads it before any import.');
    expect(markdown).toContain('<details><summary>✏️ Cases added and removed: +1 −0 in 1 test file</summary>');
    expect(markdown).toContain('- `test/total.test.ts`\n  - + rounds');
  });

  it('names the pull request\'s commit, the base and the merge CI ran, and links each place at that merge', async () => {
    const { root, first, against } = await changed();
    // GitHub checks out a merge of the pull request into its base, and the suite runs there.
    git(root, ['checkout', '--quiet', '-b', 'topic']);
    git(root, ['add', 'src', 'test', 'config.json']);
    git(root, ['commit', '--quiet', '-m', 'change']);
    const head = git(root, ['rev-parse', 'HEAD']);
    git(root, ['checkout', '--quiet', '--detach', first]);
    git(root, ['merge', '--quiet', '--no-ff', '-m', 'merge', 'topic']);
    const merge = git(root, ['rev-parse', 'HEAD']);
    git(root, ['remote', 'add', 'origin', 'git@github.com:o/r.git']);
    const short = (commit: string) => `\`${commit.slice(0, 12)}\``;

    // A merge no pull request event names, such as one landing on main, is a commit like any other.
    const landed = formatReview(await review(parse(['--since', first, '--against', against, '--root', root])), 'markdown');
    expect(landed).toContain(`Reviewed ${short(merge)}. Changes since`);
    expect(landed).not.toContain('merged into');

    const event = join(root, '..', `${basename(root)}-event.json`);
    await writeFile(event, JSON.stringify({ pull_request: { head: { sha: head } } }));
    vi.stubEnv('GITHUB_ACTIONS', 'true');
    vi.stubEnv('GITHUB_EVENT_NAME', 'pull_request');
    vi.stubEnv('GITHUB_EVENT_PATH', event);
    const answer = await review(parse(['--since', first, '--against', against, '--root', root]));

    expect(answer.head).toEqual({ commit: merge, parents: [first, head], pull: head, blob: `https://github.com/o/r/blob/${merge}` });
    const markdown = formatReview(answer, 'markdown');
    expect(markdown).toContain(
      `Reviewed ${short(head)} (merged into ${short(first)} as ${short(merge)} for this run). Changes since ${short(first)}.`,
    );
    expect(markdown).toContain(`If the pull request's head is no longer ${short(head)}, this review describes an earlier commit.`);
    expect(markdown).toContain(`- [\`src/total.ts:5-7\`](https://github.com/o/r/blob/${merge}/src/total.ts#L5-L7) function \`round\` (new)`);
    expect(markdown).toContain(`| 🟢 | \`applyDiscount\` | modified | [\`src/total.ts:1-3\`](https://github.com/o/r/blob/${merge}/src/total.ts#L1-L3) |`);
  });

  it('says what the change might do when the record ran the changed module as other text', async () => {
    const { root, first } = await changed();
    await writeFile(join(root, 'src/total.ts'), `${AFTER}// not run yet\n`);

    const answer = await review(parse(['--since', first, '--root', root]));

    expect(answer.record).toBe('before');
    const markdown = formatReview(answer, 'markdown');
    expect(markdown).toContain('### 🧭 What this change might do');
    expect(markdown).toContain('> [!NOTE]\n> **1 of 2 changed functions has code the record holds no case for:** `round`.');
    expect(markdown).toContain('<details><summary>🧪 What the record ran for 1 changed function — 1 case in 1 test file</summary>');
    expect(markdown).not.toContain('🎯');
  });

  it('does not call a region far when the only test that covered it is one the import graph does not hold', async () => {
    const { root, first } = await changed({ gone: true });

    const answer = await review(parse(['--since', first, '--root', root]));

    const total = answer.files.find((file) => file.file === 'src/total.ts');
    expect(total?.regions?.find((region) => region.name === 'round')?.reach).toBe('unplaced');
    expect(formatReview(answer, 'text')).toContain('- 1 covered by tests the import graph does not hold, so how far is not known.');
  });

  it('starts where the recording stood before the runs at this commit, when no base is named', async () => {
    const { root, first } = await changed();
    await writeFile(commitRunsFile(testCoverageFile(root)), JSON.stringify({
      over: first, first: '2026-09-26T00:00:00.000Z', latest: '2026-09-26T00:00:00.000Z', runs: 2, files: ['test/total.test.ts'],
      standing: [{ commit: first, files: ['test/other.test.ts'] }],
    }));

    const answer = await review(parse(['--root', root]));

    expect(answer).toMatchObject({ from: first, base: 'recording', runs: { runs: 2 } });
    // Where each other test last ran is `test:since`'s reading, not the review's.
    expect(answer.runs).not.toHaveProperty('standing');
    expect(formatReview(answer, 'text')).toContain('the commit the recording was at before these runs. 2 runs recorded 1 test file.');
    const select = `\`variance select --since ${first.slice(0, 12)}\``;
    // The runs record names no commit of its own, so the comment names none either.
    expect(formatReview(answer, 'markdown')).toContain(`🎯 All 1 test file ran in these runs. ${select} lists the ones this change reaches.`);
    expect(formatReview({ ...answer, suite: 4 }, 'markdown')).toContain(
      `🎯 **1 of 4 test files ran** in these runs, 25% of the suite; the other 3 kept the rows recorded before them. ${select}`,
    );
    expect(formatReview({ ...answer, runs: { ...answer.runs!, commit: 'e'.repeat(40) } }, 'markdown')).toContain(
      `🎯 All 1 test file ran at \`eeeeeeeeeeee\`. ${select}`,
    );
  });

  /** A runs record at `commit`, laid over `over`, beside the suite's snapshot. */
  const runsOver = (root: string, commit: string, over: string) =>
    writeFile(commitRunsFile(testCoverageFile(root)), JSON.stringify({
      commit, over, first: '2026-09-26T00:00:00.000Z', latest: '2026-09-26T00:00:00.000Z', runs: 1, files: ['test/total.test.ts'],
    }));

  it('starts from the commit the runs were laid over when git says theirs descends from it', async () => {
    const { root, first } = await changed();
    git(root, ['commit', '--quiet', '--allow-empty', '-m', 'next']);
    await runsOver(root, git(root, ['rev-parse', 'HEAD']), first);

    expect(await review(parse(['--root', root]))).toMatchObject({ from: first, base: 'recording' });
  });

  it('starts at the snapshot\'s own commit after a first run there with no runs record beside it', async () => {
    // A worktree's first run at its base, a clone with a restored cache, or a
    // run after the record was deleted: the run is laid over its own commit.
    const { root, first } = await changed();
    await landRun(testCoverageFile(root), {
      version: 3,
      instrumentation: 'fixture',
      commit: first,
      tests: [{ file: 'test/total.test.ts', complete: true, preconditions: [] }],
      modules: [probedModule(['test/total.test.ts'])],
    }, root);

    const answer = await review(parse(['--root', root]));

    expect(answer).toMatchObject({ from: first, base: 'recording', runs: { commit: first, over: first, runs: 1 } });
    // From the commit it stands at, the change is the working tree's.
    expect(formatReview(answer, 'text')).toContain('2 changed regions in 1 file');
  });

  it('names no start when git says the runs\' commit does not descend from the one they were laid over', async () => {
    const { root, first } = await changed();
    // The main line's shards at `first`, landed over a branch's runs at `side`.
    const side = git(root, ['commit-tree', `${first}^{tree}`, '-p', first, '-m', 'side']);
    await runsOver(root, first, side);

    await expect(review(parse(['--root', root]))).rejects.toThrow(/name no start they descend from, so nothing records where this change starts/);
  });

  it('is refused, naming the commit to fetch, when git cannot say whether the runs descend from it', async () => {
    const { root, first } = await changed();
    const unfetched = 'd'.repeat(40);
    await runsOver(root, first, unfetched);

    const refused = review(parse(['--root', root]));
    await expect(refused).rejects.toThrow(`git cannot say whether ${first.slice(0, 12)} descends from it`);
    await expect(refused).rejects.toThrow(`Fetch ${unfetched} with the history between them`);
  });

  /**
   * The layers a run keeps in the record beside its case index, and the runs
   * at `change` listing `files`. Answers the record, which holds both layers.
   */
  async function layered(
    root: string,
    last: string | object,
    before: ExecutionIndex,
    change: string,
    files: readonly string[],
  ): Promise<string> {
    const record = testCoverageFile(root);
    const { index } = caseSectionsAt(record);
    await writeFile(record, withCaseSections(await readFile(record), {
      ...(index === undefined ? {} : { index }),
      before: encodeExecutionIndex(before),
      last: Buffer.from(typeof last === 'string' ? last : JSON.stringify(last)),
    }));
    await writeFile(commitRunsFile(record), JSON.stringify({
      commit: change, first: '2026-09-26T00:00:00.000Z', latest: '2026-09-26T00:00:00.000Z', runs: 1, files,
    }));
    return record;
  }

  const CHANGE = 'c'.repeat(40);
  const OLD_NAME = { id: 'test/total.test.ts > old name', file: 'test/total.test.ts', name: 'old name', stopped: false };
  // What the mainline's run retired before its own: a case main renamed since.
  const MAINLINE_BEFORE: ExecutionIndex = {
    tests: [OLD_NAME, DISCOUNTS],
    modules: [{ file: 'src/total.ts', blocks: [block('applyDiscount', 1, 3, [0, 1])] }],
  };

  it('compares no case against the base when no run at this commit wrote the case index', async () => {
    const { root, first } = await changed();
    // The mainline's full run wrote the layers last; the run at this commit stopped in its one file and wrote nothing.
    const mainline = { commit: first, at: '2026-09-25T00:00:00.000Z', files: ['test/total.test.ts'], cases: [DISCOUNTS.id] };
    const record = await layered(root, mainline, MAINLINE_BEFORE, CHANGE, ['test/total.test.ts']);

    const answer = await review(parse(['--since', first, '--root', root]));

    expect(answer.motion).toEqual({ base: { from: record, kind: 'before' }, unwritten: ['test/total.test.ts'] });
    // Nor are a changed test file's cases compared with the names the mainline's layer holds.
    expect(answer.files.find((file) => file.file === 'test/total.test.ts')?.cases).toBeUndefined();
    const markdown = formatReview(answer, 'markdown');
    expect(markdown).not.toContain('Lost every case');
    expect(markdown).not.toContain('old name');
    expect(markdown).toContain('No case index was written at `cccccccccccc` for the one test file run there, so no case is compared against the base.');
    expect(formatReview(answer, 'text')).toContain('Not compared, no case index was written at this commit for: test/total.test.ts.');
  });

  it('names no test file whose every case skipped, because the index holds no case of it to compare', async () => {
    const { root, first } = await changed();
    // A change no test file loads, on a machine with no browser: the only file the run
    // selected is one whose every case skips there, as it did in the mainline's run.
    const mainline = { commit: first, at: '2026-09-25T00:00:00.000Z', files: ['test/total.test.ts'], cases: [DISCOUNTS.id] };
    const record = await layered(root, mainline, MAINLINE_BEFORE, CHANGE, ['test/skipped.chromium.test.ts']);

    const answer = await review(parse(['--since', first, '--root', root]));

    expect(answer.motion).toEqual({ base: { from: record, kind: 'before' }, unwritten: [] });
    const markdown = formatReview(answer, 'markdown');
    expect(markdown).not.toContain('skipped.chromium');
    expect(markdown).not.toContain('No case index was written');
    expect(markdown).not.toContain('Cases moved against the base');
    expect(formatReview(answer, 'text')).not.toContain('Not compared');
  });

  it('says of a change to prose alone only that no record holds it', async () => {
    const { root, first } = await changed();
    // Undo the fixture's change to code, and change a document instead.
    git(root, ['checkout', first, '--', '.']);
    await writeFile(join(root, 'NOTES.md'), '# Notes\n');
    git(root, ['add', 'NOTES.md']);
    const mainline = { commit: first, at: '2026-09-25T00:00:00.000Z', files: ['test/total.test.ts'], cases: [DISCOUNTS.id] };
    await layered(root, mainline, MAINLINE_BEFORE, CHANGE, ['test/skipped.chromium.test.ts']);

    const markdown = formatReview(await review(parse(['--since', first, '--root', root])), 'markdown');

    expect(markdown).toContain('1 changed file, and no changed region the record covers.');
    expect(markdown).toContain('- `NOTES.md`');
    expect(markdown).not.toContain('skipped.chromium');
    expect(markdown).not.toContain('Cases moved against the base');
  });

  it('compares every test file the runs at this commit wrote, and names the ones they did not', async () => {
    const { root, first } = await changed();
    const before = { tests: [DISCOUNTS], modules: [{ file: 'src/total.ts', blocks: [block('applyDiscount', 1, 3, [0])] }] };
    // Two invocations at this commit wrote; the list of runs restarted after the first, so it names only the second's file.
    const last = { commit: CHANGE, before: first, at: '2026-09-26T00:00:00.000Z', files: ['test/other.test.ts', 'test/total.test.ts'], cases: [] };
    await layered(root, last, before, CHANGE, ['test/other.test.ts']);

    const written = await review(parse(['--since', first, '--root', root]));

    expect(written.motion?.moved?.counts).toEqual({ lost: 0, hidden: 0, thinned: 0, gained: 0 });
    expect(written.motion?.unwritten).toEqual([]);

    // The last writer named only the other file, so the one with cases was not written.
    await layered(root, { ...last, files: ['test/other.test.ts'] }, before, CHANGE, ['test/other.test.ts', 'test/total.test.ts']);

    const both = await review(parse(['--since', first, '--root', root]));

    expect(both.motion?.unwritten).toEqual(['test/total.test.ts']);
    expect(both.motion?.moved?.counts).toEqual({ lost: 0, hidden: 0, thinned: 0, gained: 0 });
  });

  it('compares nothing when the run that wrote the case index last cannot be read', async () => {
    const { root, first } = await changed();
    const record = await layered(root, '{not json', MAINLINE_BEFORE, CHANGE, ['test/skipped.chromium.test.ts']);

    const answer = await review(parse(['--since', first, '--root', root]));

    expect(answer.motion).toEqual({ base: { from: record, kind: 'before' }, lastRunUnread: record });
    expect(answer.files.find((file) => file.file === 'test/total.test.ts')?.cases).toBeUndefined();
    expect(formatReview(answer, 'markdown')).toContain(
      'Which test files a run at `cccccccccccc` wrote to the case index could not be read, so no case is compared against the base.',
    );
    expect(formatReview(answer, 'text')).toContain(`Not compared: ${record} could not be read`);
  });

  it('names no case a test file the change created added, when no run at this commit wrote it', async () => {
    const { root, first } = await changed();
    const created = { id: 'test/created.test.ts > counts', file: 'test/created.test.ts', name: 'counts', stopped: false };
    await writeFile(join(root, 'test/created.test.ts'), "it('counts', () => {});\n");
    git(root, ['add', '--intent-to-add', 'test/created.test.ts']);
    await writeFile(testCoverageFile(root), withCaseSections(await readFile(testCoverageFile(root)), {
      index: encodeExecutionIndex({
        tests: [DISCOUNTS, ROUNDS, created],
        modules: [{ file: 'src/total.ts', blocks: [block('applyDiscount', 1, 3, [0, 2]), block('round', 5, 7, [])] }],
      }),
    }));
    const casesOf = (answer: Awaited<ReturnType<typeof review>>) =>
      answer.files.find((file) => file.file === 'test/created.test.ts');

    await layered(root, '{not json', MAINLINE_BEFORE, CHANGE, ['test/created.test.ts']);
    const unread = casesOf(await review(parse(['--since', first, '--root', root])));

    expect(unread?.created).toBe(true);
    expect(unread?.cases).toBeUndefined();

    const last = { commit: CHANGE, before: first, at: '2026-09-26T00:00:00.000Z', files: ['test/total.test.ts'], cases: [] };
    await layered(root, last, MAINLINE_BEFORE, CHANGE, ['test/created.test.ts', 'test/total.test.ts']);
    const left = casesOf(await review(parse(['--since', first, '--root', root])));

    expect(left?.cases).toBeUndefined();

    await layered(root, { ...last, files: ['test/created.test.ts', 'test/total.test.ts'] }, MAINLINE_BEFORE, CHANGE, ['test/created.test.ts']);
    const written = casesOf(await review(parse(['--since', first, '--root', root])));

    expect(written?.cases).toEqual({ added: ['counts'], removed: [] });
  });

  it('writes the answer beside what it prints when given a directory', async () => {
    const { root, first, against } = await changed();
    const out = join(await mkdtemp(join(tmpdir(), 'variance-review-out-')), 'review');
    let printed = '';

    const code = await main(['review', '--since', first, '--against', against, '--root', root, '--out', out], {
      out: (text) => (printed += text),
      err: () => {},
    });

    expect(code).toBe(0);
    expect(printed).toContain('2 changed regions in 1 file');
    expect(JSON.parse(await readFile(join(out, 'review.json'), 'utf8')).from).toBe(first);
    expect(await readFile(join(out, 'review.md'), 'utf8')).toContain(REVIEW_MARKER);
  });

  it('carries every declared suite into the saved review when coverage is requested', async () => {
    const { root, first, against } = await changed({ suites: ['unit', 'browser'] });
    const out = join(await mkdtemp(join(tmpdir(), 'variance-review-evidence-')), 'review');
    let printed = '';
    const status = await main(['review', '--since', first, '--against', against, '--suite', 'unit', '--coverage', '--out', out, '--root', root, '--format', 'markdown'], {
      out: (text) => { printed += text; }, err: () => {},
    });
    expect(status).toBe(0);
    const saved = JSON.parse(await readFile(join(out, 'review.json'), 'utf8'));
    expect(saved.coverage.map((reading: { suite?: string; suites?: { suite: string }[] }) => reading.suites?.[0]?.suite ?? reading.suite)).toEqual(['browser', 'unit']);
    expect(printed).toContain('| `browser` | Unrecorded |');
    expect(printed).toContain('### Test evidence');
    expect(await readFile(join(out, 'review.md'), 'utf8')).toBe(printed);
  });
});
