import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { testCoverageFile } from '@variance-authority/sense/test-selection';
import { main } from '../bin.js';
import { digestString } from '@variance-authority/core/format';
import { MINUTE, PAY, indexOf, iso, oneRun, recordFixture, type Fixture } from './covering-record.fixture.js';

/**
 * Every `covering` answer about a file says where the record's line numbers
 * stand in the asked text, and, apart from that, whether each test file it
 * names ran over the asked text. The two are different questions: a test file
 * can run over another text of the file than the one the lines are numbered in.
 */

const { checkout, ask } = recordFixture();
const cwd = process.cwd();
/** The runs record of one run at the record's commit that finished `src/pay.test.ts` six minutes ago, over `texts` off the commit. */
const ranHere = (texts: Record<string, string> = {}): Fixture['runs'] =>
  (_, recorded) => ({ commit: recorded, ...oneRun(iso(Date.now() - 6 * MINUTE), ['src/pay.test.ts'], texts) });

describe('a covering answer says where the record\'s line numbers stand in the asked text', () => {
  it('says nothing of the numbering when the lines are numbered in the asked text, and says the test file ran over it', async () => {
    const { at, commit } = await checkout({ runs: ranHere() });
    const file = await ask(at, '--file', 'src/pay.ts');
    const line = await ask(at, '--file', 'src/pay.ts', '--line', '1');
    const named = await ask(at, '--file', 'src/pay.ts', '--function', 'pay');

    expect(file.json).toMatchObject({ at: commit, frame: 'recorded', ran: { stands: [{ commit, tests: ['src/pay.test.ts'], text: 'held' }] } });
    expect(line.json).toMatchObject({ at: commit, frame: 'recorded' });
    expect(named.json).toMatchObject({ at: commit, frame: 'recorded', unrun: [{ kind: 'branch', startLine: 2, endLine: 4 }] });
    for (const { text } of [file, line, named]) {
      expect(text).not.toContain('numbered in');
      expect(text).toContain('src/pay.ts is the text the test file named here ran over, in a run that landed 6 minutes ago.\n');
    }
  });

  it('says once that an edited file\'s lines are placed in the text as it is now, and that its test file ran over another text', async () => {
    const { at, commit } = await checkout({ runs: ranHere() });
    await writeFile(join(at, 'src/pay.ts'), `// fees are charged by the caller\n${PAY}`);
    const { text, json } = await ask(at, '--file', 'src/pay.ts');

    expect(json).toMatchObject({ at: commit, frame: 'mapped', ran: { stands: [{ text: 'other', other: ['src/pay.ts'] }] } });
    expect(text).toContain('The recorded lines of src/pay.ts are placed in its text as it is now.\n');
    expect(text).toContain('src/pay.test.ts ran over another text of src/pay.ts, in a run that landed 6 minutes ago.\n');
    expect(text).not.toContain(', placed in the text as it is now');
  });

  it('says of an asked function in an edited file whether it is the same in the text its test file ran over, and marks each part no case ran that the edit touched', async () => {
    const { at } = await checkout({ runs: ranHere() });
    await writeFile(join(at, 'src/pay.ts'), `// fees are charged by the caller\n${PAY}`);
    const untouched = await ask(at, '--file', 'src/pay.ts', '--function', 'pay');

    expect(untouched.json).toMatchObject({ frame: 'mapped', unrun: [{ kind: 'branch', startLine: 3, endLine: 5 }], ran: { stands: [{ text: 'other', region: 'same' }] } });
    expect(untouched.json).not.toHaveProperty('moved');
    expect(untouched.json['unrun']).not.toMatchObject([{ moved: true }]);
    expect(untouched.text).toContain('src/pay.test.ts ran over another text of src/pay.ts, in a run that landed 6 minutes ago; `pay` is the same in both.\n');
    expect(untouched.text).toContain('No case ran a part of it: the branch at lines 3-5.\n');

    await writeFile(join(at, 'src/pay.ts'), PAY.replace('return 0;', 'return -1;'));
    const edited = await ask(at, '--file', 'src/pay.ts', '--function', 'pay');
    let refs = '';
    await main(['covering', '--root', at, '--file', 'src/pay.ts', '--function', 'pay', '--format', 'refs'], { out: (said) => (refs += said), err: () => {} });

    expect(edited.json).toMatchObject({ frame: 'mapped', moved: true, unrun: [{ kind: 'branch', startLine: 2, endLine: 4, moved: true }], ran: { stands: [{ region: 'changed' }] } });
    expect(edited.text).toContain('src/pay.test.ts ran over another text of src/pay.ts, in a run that landed 6 minutes ago; `pay` differs between the two.\n');
    expect(edited.text).toContain('No case ran a part of it: the edited branch at lines 2-4.\n');
    expect(refs).toMatch(/src\/pay\.ts function pay( \w+)? edited: .*; no case ran 2-4 branch( \w+)? edited$/mu);
  });

  it('calls an asked line or function the same in both texts when the edit since its run only wrote comments in it, as a count of what ran over this text does', async () => {
    const { at } = await checkout({ runs: ranHere() });
    await writeFile(join(at, 'src/pay.ts'), PAY
      .replace('  if (amount < 0) {', '  // a refund is not a payment\n  if (amount < 0) {')
      .replace('  return amount;', '  return amount; // already rounded'));
    const named = await ask(at, '--file', 'src/pay.ts', '--function', 'pay');
    const line = await ask(at, '--file', 'src/pay.ts', '--line', '6');

    expect(named.json).toMatchObject({ frame: 'mapped', ran: { stands: [{ text: 'other', region: 'same' }] } });
    expect(named.text).toContain('`pay` is the same in both.\n');
    expect(line.json).toMatchObject({ frame: 'mapped', ran: { stands: [{ text: 'other', region: 'same' }] } });
  });

  it('says no recorded line is a place in a file whose numbering text could not be found', async () => {
    const ranOver = `// never committed\n${PAY}`;
    const { at, commit } = await checkout({ ranOver, runs: ranHere({ 'src/pay.ts': digestString(ranOver) }) });
    const { text, json } = await ask(at, '--file', 'src/pay.ts');

    expect(json).toMatchObject({ at: commit, frame: 'stale' });
    expect(text).toContain('src/pay.ts is not the text the record\'s lines are numbered in, and that text could not be found, so no recorded line is a place in it.\n');
    expect(text).toContain('src/pay.test.ts ran over another text of src/pay.ts, in a run that landed 6 minutes ago.\n');
  });

  it('lists the cases of a function in such a file, and says no part of it is placed nor compared', async () => {
    const ranOver = `// never committed\n${PAY}`;
    const { at, commit } = await checkout({ ranOver, runs: ranHere({ 'src/pay.ts': digestString(ranOver) }) });
    const { text, json } = await ask(at, '--file', 'src/pay.ts', '--function', 'pay');

    expect(json).toMatchObject({ at: commit, frame: 'stale', target: { function: 'pay' }, tests: [{ id: 'p' }] });
    expect(json).not.toHaveProperty('unrun');
    expect(text).toContain('charges once [p]\n');
    expect(text).toContain('src/pay.ts is not the text the record\'s lines are numbered in, and that text could not be found, so no recorded line is a place in it. Which parts of `pay` no case ran are not said for that reason.\n');
    expect(text).toContain(
      'src/pay.test.ts ran over another text of src/pay.ts, in a run that landed 6 minutes ago; whether `pay` differs is not known: the record\'s lines of src/pay.ts are not placed in its text as it is now.\n',
    );
  });

  it('frames no file by a row the build did not instrument, as no other reader of a record does, and compares no text by it', async () => {
    // A run outside a checkout stood at no commit, so the snapshot it wrote is all that says which text it ran over.
    const landed = iso(Date.now() - 6 * MINUTE);
    const { at } = await checkout({
      row: 'loaded',
      recordedAt: null,
      runs: () => ({ latest: landed, runs: 1, landings: [{ files: ['src/pay.test.ts'], first: landed, latest: landed, runs: 1 }] }),
    });
    const { text, json } = await ask(at, '--file', 'src/pay.ts');

    expect(json).not.toHaveProperty('frame');
    expect(text).toContain('The record does not say which text of src/pay.ts its lines are numbered in, so they are given as recorded.\n');
    expect(text).toContain(
      'Whether src/pay.test.ts ran over src/pay.ts as it is now, in a run that landed 6 minutes ago, is not known: the record holds no digest of the text of src/pay.ts it ran over.\n',
    );
  });

  it('gives the lines as recorded when the record holds no row of the file', async () => {
    const { at, commit } = await checkout({ row: false });
    const { text, json } = await ask(at, '--file', 'src/pay.ts');

    expect(json).toMatchObject({ at: commit });
    expect(json).not.toHaveProperty('frame');
    expect(text).toContain('The record does not say which text of src/pay.ts its lines are numbered in, so they are given as recorded.\n');
  });

  it('frames no file the run loaded without instrumenting, and says of each test file holding it whether it ran the asked text', async () => {
    const setup = 'export const ready = true;\n';
    const { at } = await checkout({ setup, runs: ranHere() });
    const held = await ask(at, '--file', 'src/setup.ts');
    await writeFile(join(at, 'edited.ts'), `// ready once\n${setup}`);
    const edited = await ask(at, '--file', 'src/setup.ts', '--text', join(at, 'edited.ts'));
    await rm(join(at, 'src/setup.ts'));
    const gone = await ask(at, '--file', 'src/setup.ts');

    expect(held.json).toMatchObject({ preconditionOf: ['src/pay.test.ts'], held: 'loaded', ran: { stands: [{ tests: ['src/pay.test.ts'], text: 'held' }] } });
    expect(held.json).not.toHaveProperty('frame');
    expect(held.text).toContain('src/setup.ts is the text the test file named here ran over, in a run that landed 6 minutes ago.\n');
    expect(edited.json).toMatchObject({ preconditionOf: ['src/pay.test.ts'], ran: { stands: [{ text: 'other', other: ['src/setup.ts'] }] } });
    expect(edited.json).not.toHaveProperty('frame');
    expect(edited.text).toContain('src/pay.test.ts ran over another text of src/setup.ts, in a run that landed 6 minutes ago.\n');
    expect(gone.json).toMatchObject({ preconditionOf: ['src/pay.test.ts'], unheld: true });
    expect(gone.json).not.toHaveProperty('frame');
    expect(gone.text).toContain('src/setup.ts is not on disk, so no text of it is held.\n');
    expect(gone.text).toContain('The test file named here last ran in a run that landed 6 minutes ago.\n');
  });

  it('gives a journey handed in by path its lines as recorded, and says it names no commit', async () => {
    const { at } = await checkout();
    const journey = join(at, 'journey.json');
    await writeFile(journey, JSON.stringify(indexOf()));
    const { text, json } = await ask(at, '--file', 'src/pay.ts', '--execution', journey);

    expect(json).not.toHaveProperty('frame');
    expect(json).not.toHaveProperty('at');
    expect(text).toContain('The record does not say which text of src/pay.ts its lines are numbered in, so they are given as recorded.\n');
    expect(text).toContain('Where and when the test file named here last ran is not known: the record names no commit.\n');
  });

  it('dates a record handed in by path by the commit it names and the runs record beside it', async () => {
    const { at, commit } = await checkout({ runs: ranHere() });
    const { text, json } = await ask(at, '--file', 'src/pay.ts', '--execution', testCoverageFile(at, { suite: 'unit' }));
    const line = await ask(at, '--file', 'src/pay.ts', '--line', '3', '--execution', testCoverageFile(at, { suite: 'unit' }));

    expect(json).toMatchObject({ at: commit, ran: { stands: [{ commit, tests: ['src/pay.test.ts'], text: 'held' }] } });
    expect(line.json).toMatchObject({ at: commit, ran: { stands: [{ commit, tests: ['src/pay.test.ts'], text: 'held' }] } });
    expect(text).toContain('src/pay.ts is the text the test file named here ran over, in a run that landed 6 minutes ago.\n');
  });

  it('frames a record handed in by path that names a commit as it frames the record it reads itself', async () => {
    const { at, commit } = await checkout({ runs: ranHere() });
    const execution = testCoverageFile(at, { suite: 'unit' });
    const held = await ask(at, '--file', 'src/pay.ts', '--line', '3', '--execution', execution);
    await writeFile(join(at, 'src/pay.ts'), `// fees are charged by the caller\n${PAY}`);
    const edited = await ask(at, '--file', 'src/pay.ts', '--execution', execution);

    expect(held.json).toMatchObject({ at: commit, frame: 'recorded' });
    expect(held.text).not.toContain('numbered in');
    expect(edited.json).toMatchObject({ at: commit, frame: 'mapped' });
    expect(edited.text).toContain('The recorded lines of src/pay.ts are placed in its text as it is now.\n');
  });

  it('refuses a change it cannot read from the ref when the record names no commit to read it from, rather than saying nothing changed', async () => {
    const { at } = await checkout({ recordedAt: null });
    const refusal = '`--since no-such-ref` could not be read as a diff. Check the ref exists and that this is a git checkout; ' +
      'an empty answer here would read as `your change touches nothing`.';
    // `git` reads the change from the working directory, as it does for a person asking in their checkout.
    process.chdir(at);
    try {
      const { text, json } = await ask(at, '--since', 'no-such-ref');

      expect(json).toEqual({ suite: 'unit', kind: 'unit', reason: refusal });
      expect(text).toBe(`unit (unit): ${refusal}\n`);
    } finally {
      process.chdir(cwd);
    }
  });

  it('says the record\'s lines are its own when the file is not on disk', async () => {
    const { at, commit } = await checkout();
    await rm(join(at, 'src/pay.ts'));
    const { text, json } = await ask(at, '--file', 'src/pay.ts');

    expect(json).toMatchObject({ at: commit, unheld: true });
    expect(json).not.toHaveProperty('frame');
    expect(text).toContain('src/pay.ts is not on disk, so no text of it is held; its lines are the record\'s.\n');
    expect(text).toContain('The test file named here last ran at a time the record does not hold.\n');
  });
});
