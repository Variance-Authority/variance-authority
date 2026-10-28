import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { digestString } from '@variance-authority/core/format';
import { commitRunsFile, testCoverageFile, type ExecutionIndex } from '@variance-authority/sense/test-selection';
import { namedTestFiles } from './covering-ran.js';
import { ASSUMED, DAY, HOUR, MINUTE, PAY, iso, recordFixture, unplaced } from './covering-record.fixture.js';

/**
 * Where and when each test file a `covering` answer names last ran, and
 * whether it ran over the asked text: read from the runs record beside the
 * snapshot, by the time those runs landed and the digest of the text they ran
 * over, never by counting or dating commits.
 */

const { checkout, ask } = recordFixture();

describe('a covering answer says when the test files it names last ran, and over which text', () => {
  it('dates the answer by when its test file\'s runs landed, not by a later partial run that stamped the record', async () => {
    const now = Date.now();
    const { at, commit, first } = await checkout({
      committed: now - (9 * HOUR + 30 * MINUTE),
      second: { committed: now - (6 * MINUTE + 30_000) },
      runs: (base, recorded) => ({
        commit: recorded, over: base, first: iso(now - 6 * MINUTE), latest: iso(now - 6 * MINUTE), runs: 1, files: ['src/other.test.ts'], texts: {},
        standing: [{ commit: base, files: ['src/pay.test.ts'], first: iso(now - 9 * HOUR - MINUTE), latest: iso(now - 9 * HOUR - MINUTE), runs: 1, texts: {} }],
      }),
    });
    const { text, json } = await ask(at, '--file', 'src/pay.ts');

    expect(json).toMatchObject({ at: commit, frame: 'recorded', ran: { stands: [{ commit: first, tests: ['src/pay.test.ts'], landed: { runs: 1 }, text: 'held' }] } });
    expect(json['ran']).not.toHaveProperty('assumed');
    expect(text).toContain('src/pay.ts is the text the test file named here ran over, in a run that landed 9 hours ago.\n');
    expect(text).not.toContain('minute');
    expect(text).not.toContain(first.slice(0, 12));
  });

  it('says a test file ran over another text when the file changed after its run, and whether the asked function is the same in both', async () => {
    const now = Date.now();
    const { at, first } = await checkout({
      committed: now - (9 * HOUR + 30 * MINUTE),
      second: { committed: now - (6 * MINUTE + 30_000), pay: `${PAY}export const fee = 0;\n` },
      runs: (base, recorded) => ({
        commit: recorded, over: base, first: iso(now - 6 * MINUTE), latest: iso(now - 6 * MINUTE), runs: 1, files: ['src/other.test.ts'], texts: {},
        standing: [{ commit: base, files: ['src/pay.test.ts'], first: iso(now - 9 * HOUR - MINUTE), latest: iso(now - 9 * HOUR - MINUTE), runs: 1, texts: {} }],
      }),
    });
    const file = await ask(at, '--file', 'src/pay.ts');
    const named = await ask(at, '--file', 'src/pay.ts', '--function', 'pay');

    expect(file.json).toMatchObject({ frame: 'recorded', ran: { stands: [{ commit: first, text: 'other', other: ['src/pay.ts'] }] } });
    expect(file.text).toContain('src/pay.test.ts ran over another text of src/pay.ts, in a run that landed 9 hours ago.\n');
    expect(named.json).toMatchObject({ ran: { stands: [{ text: 'other', region: 'same' }] } });
    expect(named.text).toContain('src/pay.test.ts ran over another text of src/pay.ts, in a run that landed 9 hours ago; `pay` is the same in both.\n');
  });

  it('says the asked function is not in the file as it is now when an edit removed every block of it, never that it is the same', async () => {
    const now = Date.now();
    const fee = 'export const fee = 0;\n';
    const { at } = await checkout({
      committed: now - (9 * HOUR + 30 * MINUTE),
      second: { committed: now - (6 * MINUTE + 30_000), pay: `${PAY}${fee}` },
      runs: (base, recorded) => ({
        commit: recorded, over: base, first: iso(now - 6 * MINUTE), latest: iso(now - 6 * MINUTE), runs: 1, files: ['src/other.test.ts'], texts: {},
        standing: [{ commit: base, files: ['src/pay.test.ts'], first: iso(now - 9 * HOUR - MINUTE), latest: iso(now - 9 * HOUR - MINUTE), runs: 1, texts: {} }],
      }),
    });
    await writeFile(join(at, 'src/pay.ts'), fee);
    const { text, json } = await ask(at, '--file', 'src/pay.ts', '--function', 'pay');

    expect(json).toMatchObject({ frame: 'mapped', ran: { stands: [{ text: 'other', region: 'gone' }] } });
    expect(text).toContain('src/pay.test.ts ran over another text of src/pay.ts, in a run that landed 9 hours ago; `pay` is not in src/pay.ts as it is now.\n');
  });

  it('says which text a test file a later run ran in part ran over is not known when the two runs ran over different texts, naming both times', async () => {
    const now = Date.now();
    const { at, commit, first } = await checkout({
      committed: now - (9 * HOUR + 30 * MINUTE),
      second: { committed: now - (6 * MINUTE + 30_000), pay: `${PAY}export const fee = 0;\n` },
      runs: (base, recorded) => ({
        commit: recorded, over: base, first: iso(now - 6 * MINUTE), latest: iso(now - 6 * MINUTE), runs: 1, files: ['src/other.test.ts'], texts: {},
        landings: [{ files: ['src/other.test.ts'], partly: ['src/pay.test.ts'], first: iso(now - 6 * MINUTE), latest: iso(now - 6 * MINUTE), runs: 1, texts: {} }],
        standing: [{ commit: base, files: ['src/pay.test.ts'], first: iso(now - 9 * HOUR - MINUTE), latest: iso(now - 9 * HOUR - MINUTE), runs: 1, texts: {} }],
      }),
    });
    const { text, json } = await ask(at, '--file', 'src/pay.ts');
    const why = 'its cases ran in runs over different texts of src/pay.ts, and the runs record does not say which case ran in which';

    expect(json['ran']).toMatchObject({ stands: [{ commit: first, tests: ['src/pay.test.ts'], partly: [{ commit, landed: { runs: 1 } }], unknown: why }] });
    expect(text).toContain(`Whether src/pay.test.ts ran over src/pay.ts as it is now, in runs that landed from 9 hours ago to 6 minutes ago, is not known: ${why}.\n`);
  });

  it('says the same of a run in part over an uncommitted text, and that the file ran over another text when both runs did', async () => {
    const now = Date.now();
    const dirty = `${PAY}export const dirty = 1;\n`;
    const { at } = await checkout({
      committed: now - (9 * HOUR + 30 * MINUTE),
      second: { committed: now - (6 * MINUTE + 30_000) },
      runs: (base, recorded) => ({
        commit: recorded, over: base, first: iso(now - 6 * MINUTE), latest: iso(now - 6 * MINUTE), runs: 1, files: ['src/other.test.ts'],
        landings: [{ files: ['src/other.test.ts'], partly: ['src/pay.test.ts'], first: iso(now - 6 * MINUTE), latest: iso(now - 6 * MINUTE), runs: 1, texts: { 'src/pay.ts': digestString(dirty) } }],
        standing: [{ commit: base, files: ['src/pay.test.ts'], first: iso(now - 9 * HOUR - MINUTE), latest: iso(now - 9 * HOUR - MINUTE), runs: 1, texts: {} }],
      }),
    });
    const mixed = await ask(at, '--file', 'src/pay.ts');
    await writeFile(join(at, 'src/pay.ts'), `${PAY}export const fee = 0;\n`);
    const both = await ask(at, '--file', 'src/pay.ts', '--function', 'pay');

    expect(mixed.json['ran']).toMatchObject({ stands: [{ tests: ['src/pay.test.ts'], unknown: expect.stringContaining('its cases ran in runs over different texts of src/pay.ts') }] });
    expect(both.json['ran']).toMatchObject({ stands: [{ tests: ['src/pay.test.ts'], text: 'other', region: { unknown: 'the text of src/pay.ts that run ran over is neither kept nor committed' } }] });
    expect(both.text).toContain(
      'src/pay.test.ts ran over another text of src/pay.ts, in runs that landed from 9 hours ago to 6 minutes ago; whether `pay` differs is not known: the text of src/pay.ts that run ran over is neither kept nor committed.\n',
    );
  });

  it('says whether a test file ran the asked text is not known for a stand the record holds no text for', async () => {
    const { at } = await checkout({
      second: { committed: Date.now() - MINUTE },
      runs: (base, recorded) => ({ commit: recorded, over: base, first: iso(Date.now()), latest: iso(Date.now()), runs: 1, files: ['src/other.test.ts'], standing: [{ commit: base, files: ['src/pay.test.ts'] }] }),
    });
    const { text, json } = await ask(at, '--file', 'src/pay.ts');

    expect(json['ran']).toMatchObject({ stands: [{ unknown: 'the runs record does not say which text of src/pay.ts its runs there ran over' }] });
    expect(json['ran']).not.toMatchObject({ stands: [{ landed: {} }] });
    expect(text).toContain(
      'Whether src/pay.test.ts ran over src/pay.ts as it is now, at a time the record does not hold, is not known: the runs record does not say which text of src/pay.ts its runs there ran over.\n',
    );
  });

  it('gives the span the runs at the record\'s commit landed over, for a test file they ran', async () => {
    const now = Date.now();
    const { at, commit } = await checkout({
      runs: (_, recorded) => ({ commit: recorded, first: iso(now - (3 * HOUR + MINUTE)), latest: iso(now - (6 * MINUTE + 30_000)), runs: 2, files: ['src/pay.test.ts'], texts: {} }),
    });
    const { text, json } = await ask(at, '--file', 'src/pay.ts', '--function', 'pay');

    expect(json).toMatchObject({ ran: { stands: [{ commit, landed: { runs: 2 }, text: 'held' }] } });
    expect(text).toContain('src/pay.ts is the text the test file named here ran over, in runs that landed from 3 hours ago to 6 minutes ago.\n');
  });

  it('reads a test file the runs at the record\'s commit did not observe as having run there, and says that is assumed', async () => {
    const { at, commit } = await checkout({
      runs: (_, recorded) => ({ commit: recorded, first: iso(Date.now()), latest: iso(Date.now()), runs: 1, files: ['src/other.test.ts'], texts: {} }),
    });
    const { text, json } = await ask(at, '--file', 'src/pay.ts');

    expect(json).toMatchObject({ ran: { stands: [{ commit, assumed: true, text: 'held' }], assumed: expect.stringContaining('does not say where 1 test(s) last ran') } });
    expect(text).toContain('src/pay.ts is the text the test file named here ran over, at a time the record does not hold.\n');
    expect(text).toContain(ASSUMED);
  });

  it('says the same when no runs record lies beside the snapshot, and names where in the JSON', async () => {
    const { at, commit } = await checkout();
    const { text, json } = await ask(at, '--file', 'src/pay.ts');

    expect(json).toMatchObject({ ran: { stands: [{ commit, tests: ['src/pay.test.ts'] }], assumed: unplaced(commit) } });
    expect(text).toContain(ASSUMED);
    expect(text).not.toContain(unplaced(commit));
  });

  it('leaves only the stand whose commit this clone does not hold unknown', async () => {
    const now = Date.now();
    const foreign = 'f'.repeat(40);
    const { at } = await checkout({
      fee: true,
      runs: (_, recorded) => ({
        commit: recorded, first: iso(now - 6 * MINUTE), latest: iso(now - 6 * MINUTE), runs: 1, files: ['src/fee.test.ts'], texts: {},
        standing: [{ commit: foreign, files: ['src/pay.test.ts'], first: iso(now - 2 * HOUR), latest: iso(now - 2 * HOUR), runs: 1, texts: {} }],
      }),
    });
    const { text, json } = await ask(at, '--file', 'src/pay.ts');

    expect(json['ran']).toMatchObject({
      stands: [
        { commit: foreign, tests: ['src/pay.test.ts'], unknown: 'this clone holds no committed text of src/pay.ts where that run stood' },
        { tests: ['src/fee.test.ts'], text: 'held' },
      ],
    });
    expect(text).toContain([
      'Whether src/pay.test.ts ran over src/pay.ts as it is now, in a run that landed 2 hours ago, is not known: this clone holds no committed text of src/pay.ts where that run stood.',
      'src/pay.ts is the text the other test file named here ran over, in a run that landed 6 minutes ago.',
    ].join('\n  '));
  });

  it('dates a record of a run outside a checkout by when it landed, and reads its text from the snapshot it wrote', async () => {
    const now = Date.now();
    const landed = iso(now - 6 * MINUTE);
    const { at } = await checkout({
      recordedAt: null,
      runs: () => ({ first: landed, latest: landed, runs: 1, files: ['src/pay.test.ts'], landings: [{ files: ['src/pay.test.ts'], first: landed, latest: landed, runs: 1 }] }),
    });
    const held = await ask(at, '--file', 'src/pay.ts');
    await writeFile(join(at, 'src/pay.ts'), PAY.replace('return amount;', 'return amount + 0;'));
    const edited = await ask(at, '--file', 'src/pay.ts');

    expect(held.json).not.toHaveProperty('at');
    expect(held.json['ran']).toEqual({ stands: [{ tests: ['src/pay.test.ts'], landed: { first: landed, latest: landed, runs: 1 }, text: 'held' }] });
    expect(held.text).toContain('src/pay.ts is the text the test file named here ran over, in a run that landed 6 minutes ago.\n');
    expect(edited.json['ran']).toMatchObject({ stands: [{ text: 'other', other: ['src/pay.ts'] }] });
    expect(edited.text).toContain('src/pay.test.ts ran over another text of src/pay.ts, in a run that landed 6 minutes ago.\n');
  });

  it('reads a record that names no commit, with no runs beside it, as its own run\'s', async () => {
    const { at } = await checkout({ recordedAt: null });
    const { text, json } = await ask(at, '--file', 'src/pay.ts');

    expect(json['ran']).toEqual({
      stands: [{ assumed: true, tests: ['src/pay.test.ts'], text: 'held' }],
      assumed: 'no runs record lies beside the snapshot, so every test is read as though it last ran where the snapshot was recorded',
    });
    expect(text).toContain(ASSUMED);
    expect(text).toContain('src/pay.ts is the text the test file named here ran over, at a time the record does not hold.\n');
  });

  it('says why when the runs record beside the snapshot cannot be read', async () => {
    const { at } = await checkout({ runs: () => 'not json' });
    const { text } = await ask(at, '--file', 'src/pay.ts');

    expect(text).toContain(`Where and when the test file named here last ran is not known: the runs record at ${commitRunsFile(testCoverageFile(at, { suite: 'unit' }))} is not JSON`);
  });

  it('gives the landing time itself when it is later than this machine\'s clock', async () => {
    const later = iso(Date.now() + 2 * DAY);
    const { at } = await checkout({ runs: (_, recorded) => ({ commit: recorded, first: later, latest: later, runs: 1, files: ['src/pay.test.ts'], texts: {} }) });
    const { text } = await ask(at, '--file', 'src/pay.ts');

    expect(text).toContain(`src/pay.ts is the text the test file named here ran over, in a run that landed at ${later}, later than this machine's clock.\n`);
  });

  it('dates a line no case ran by the test files that entered the file', async () => {
    const { at } = await checkout();
    const { text, json } = await ask(at, '--file', 'src/pay.ts', '--line', '3');

    expect(json).toMatchObject({ tests: [], ran: { named: 'entered', stands: [{ tests: ['src/pay.test.ts'], text: 'held' }] } });
    expect(text).toContain('src/pay.ts is the text the test file that entered it ran over, at a time the record does not hold.\n');
  });

  it('dates the review reading by where the test files of its regions last ran, over the changed file\'s text', async () => {
    const { at, commit } = await checkout();
    await writeFile(join(at, 'src/pay.ts'), PAY.replace('return amount;', 'return amount + 0;'));
    // `--since` reads its diff in the working directory, which is the checkout the record is of.
    const cwd = process.cwd();
    process.chdir(at);
    const { text, json } = await ask(at, '--since', 'HEAD').finally(() => process.chdir(cwd));

    expect(json).toMatchObject({ at: commit, ran: { stands: [{ commit, text: 'other', other: ['src/pay.ts'] }] } });
    expect(text).toContain(`Read from ${String(json['from'])}, recorded at ${commit!}.\n`);
    expect(text).toContain('src/pay.test.ts ran over another text of src/pay.ts, at a time the record does not hold.\n');
  });

  it('claims no text of a changed file that is not on disk, and says it is not', async () => {
    const edited = PAY.replace('return amount;', 'return amount + 0;');
    const { at } = await checkout({ ranOver: edited, setup: 'export const setup = 1;\n' });
    await writeFile(join(at, 'src/pay.ts'), edited);
    await rm(join(at, 'src/setup.ts'));
    const cwd = process.cwd();
    process.chdir(at);
    const { text, json } = await ask(at, '--since', 'HEAD').finally(() => process.chdir(cwd));

    expect(json).toMatchObject({ ran: { unheld: ['src/setup.ts'], stands: [{ tests: ['src/pay.test.ts'], text: 'held' }] } });
    expect(text).toContain('src/setup.ts is not on disk, so no text of it is held.\n');
    expect(text).toContain('src/pay.ts is the text the test file named here ran over, at a time the record does not hold.\n');
  });

  it('says in the review reading\'s heading that the record names no commit', async () => {
    const { at } = await checkout({ recordedAt: null });
    await writeFile(join(at, 'src/pay.ts'), PAY.replace('return amount;', 'return amount + 0;'));
    const cwd = process.cwd();
    process.chdir(at);
    const { text, json } = await ask(at, '--since', 'HEAD').finally(() => process.chdir(cwd));

    expect(json).not.toHaveProperty('at');
    expect(text).toContain(`Read from ${String(json['from'])}; the record names no commit.\n`);
  });
});

describe('namedTestFiles', () => {
  const tests = [
    { id: 'p', file: 'src/pay.test.ts', name: 'charges once' },
    { id: 'f', file: 'src/fee.test.ts', name: 'charges a fee' },
  ];
  const whole = {
    tests,
    modules: [
      { file: 'src/pay.ts', blocks: [{ kind: 'function', name: 'pay', path: 'entry', startLine: 1, endLine: 6, source: true, crossings: [{ test: 0, distance: 0 }] }] },
      { file: 'src/idle.ts', blocks: [{ kind: 'function', name: 'idle', path: 'entry', startLine: 1, endLine: 2, source: true, crossings: [] }] },
    ],
  } as unknown as ExecutionIndex;

  it('names the test files of the cases an answer lists, and of those that stopped before it', () => {
    expect(namedTestFiles({ file: 'src/pay.ts', tests: [tests[1]!], stopped: [tests[0]!] }, whole)).toEqual({ tests: ['src/fee.test.ts', 'src/pay.test.ts'] });
  });

  it('dates an answer naming none by the test files that entered its file, else by those of every case it was read from', () => {
    expect(namedTestFiles({ file: 'src/pay.ts', tests: [] }, whole)).toEqual({ tests: ['src/pay.test.ts'], named: 'entered' });
    expect(namedTestFiles({ file: 'src/idle.ts', tests: [] }, whole)).toEqual({ tests: ['src/fee.test.ts', 'src/pay.test.ts'], named: 'read' });
    expect(namedTestFiles({ changed: [] }, whole)).toEqual({ tests: ['src/fee.test.ts', 'src/pay.test.ts'], named: 'read' });
  });
});
