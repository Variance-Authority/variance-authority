import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { digestString } from '@variance-authority/core/format';
import { DAY, HOUR, PAY, iso, recordFixture } from './covering-record.fixture.js';

/**
 * A run that ran a test file only in part (`-t`, `.only`, a filter) names the
 * cases it ran, so each case a `covering` answer names is dated by the run that
 * last ran it, and judged against the text that run ran over.
 */

const { checkout, ask } = recordFixture();

/** The runs at the record's commit: one that finished `src/pay.test.ts` three days ago, then one an hour ago that ran only its `refunds`, over `texts`. */
const inPart = (now: number, texts: Record<string, string>) => (_: string, recorded: string | undefined) => ({
  commit: recorded,
  first: iso(now - 3 * DAY),
  latest: iso(now - HOUR),
  runs: 2,
  files: ['src/pay.test.ts'],
  landings: [
    { files: ['src/pay.test.ts'], first: iso(now - 3 * DAY), latest: iso(now - 3 * DAY), runs: 1, texts: {} },
    { files: [], partly: ['src/pay.test.ts'], cases: { 'src/pay.test.ts': ['r'] }, first: iso(now - HOUR), latest: iso(now - HOUR), runs: 1, texts },
  ],
});

describe('a covering answer dates each case it names by the run that last ran it', () => {
  it('dates a case by the run that ran it, not by a later run that ran only other cases of its file', async () => {
    const now = Date.now();
    const { at, commit } = await checkout({ refunds: 'idle', runs: inPart(now, {}) });
    const { text, json } = await ask(at, '--file', 'src/pay.ts', '--function', 'pay');

    expect(json['ran']).toEqual({
      stands: [{ commit, tests: ['src/pay.test.ts'], landed: { first: iso(now - 3 * DAY), latest: iso(now - 3 * DAY), runs: 1 }, text: 'held' }],
    });
    expect(text).toContain('src/pay.ts is the text the test file named here ran over, in a run that landed 3 days ago.\n');
  });

  it('compares a line no case ran by the cases that entered its file, not by a later run over another text that ran none of them', async () => {
    const now = Date.now();
    const dirty = PAY.replace('return amount;', 'return amount + 0;');
    const { at, commit } = await checkout({ refunds: 'idle', ranOver: dirty, runs: inPart(now, { 'src/pay.ts': digestString(dirty) }) });
    await writeFile(join(at, 'src/pay.ts'), dirty);
    const { text, json } = await ask(at, '--file', 'src/pay.ts', '--line', '3');

    expect(json['ran']).toEqual({
      named: 'entered',
      stands: [{
        commit, tests: ['src/pay.test.ts'], landed: { first: iso(now - 3 * DAY), latest: iso(now - 3 * DAY), runs: 1 },
        text: 'other', other: ['src/pay.ts'], region: 'same',
      }],
    });
    expect(text).toContain('src/pay.test.ts ran over another text of src/pay.ts, in a run that landed 3 days ago; line 3 is the same in both.\n');
  });

  it('never says a line a case ran the text of was written since, when a later run in part over another text wrote the record', async () => {
    const now = Date.now();
    const dirty = PAY.replace('return amount;', 'return amount + 0;');
    const { at, commit } = await checkout({ refunds: 'enters', ranOver: dirty, kept: true, runs: inPart(now, { 'src/pay.ts': digestString(dirty) }) });
    await writeFile(join(at, 'src/pay.ts'), dirty);
    // `charges once` last ran over the committed text, which is the one asked; `refunds` then ran over the edit, and wrote the record.
    await writeFile(join(at, 'held.ts'), PAY);
    const said = [await ask(at, '--file', 'src/pay.ts', '--text', join(at, 'held.ts'), '--line', '5')];
    await writeFile(join(at, 'src/pay.ts'), PAY);
    said.push(await ask(at, '--file', 'src/pay.ts', '--line', '5'));

    for (const { text, json } of said) {
      expect(json).toMatchObject({ tests: [], overwritten: [{ startLine: 5, endLine: 5 }] });
      expect(json).not.toHaveProperty('written');
      expect(json['ran']).toEqual({
        named: 'entered',
        stands: [
          { commit, tests: ['src/pay.test.ts'], cases: ['charges once'], landed: { first: iso(now - 3 * DAY), latest: iso(now - 3 * DAY), runs: 1 }, text: 'held' },
          {
            commit, tests: ['src/pay.test.ts'], cases: ['refunds'], landed: { first: iso(now - HOUR), latest: iso(now - HOUR), runs: 1 },
            text: 'other', other: ['src/pay.ts'], region: 'changed',
          },
        ],
      });
      expect(json['gap']).toMatchObject({
        remedy: 'record',
        known: "line 5 is in a text a case ran over, but the record's lines are numbered in another",
      });
      expect(text).toContain("Line 5 of src/pay.ts is in a text a case ran over, but the record's lines are numbered in another, so which case ran it is not known.\n");
      expect(text).not.toContain('written since');
    }
  });

  it('says each part of a test file a later run ran in part, by the text its cases ran over and when', async () => {
    const now = Date.now();
    const dirty = `${PAY}export const fee = 0;\n`;
    const { at, commit } = await checkout({ refunds: 'enters', ranOver: dirty, runs: inPart(now, { 'src/pay.ts': digestString(dirty) }) });
    await writeFile(join(at, 'src/pay.ts'), dirty);
    const { text, json } = await ask(at, '--file', 'src/pay.ts', '--function', 'pay');

    expect(json['ran']).toEqual({
      stands: [
        {
          commit, tests: ['src/pay.test.ts'], cases: ['charges once'], landed: { first: iso(now - 3 * DAY), latest: iso(now - 3 * DAY), runs: 1 },
          text: 'other', other: ['src/pay.ts'], region: 'same',
        },
        { commit, tests: ['src/pay.test.ts'], cases: ['refunds'], landed: { first: iso(now - HOUR), latest: iso(now - HOUR), runs: 1 }, text: 'held' },
      ],
    });
    expect(text).toContain(
      "src/pay.test.ts ran 'refunds' over this text, in a run that landed 1 hour ago, and its 1 other case named here over another text of src/pay.ts, in a run that landed 3 days ago, in which `pay` is the same.\n",
    );
  });

  it('reads a precondition by the text each case ran over, not by the digest a later run in part left for its test file', async () => {
    const now = Date.now();
    const setup = 'export const setup = 1;\n';
    const later = 'export const setup = 2;\n';
    const { at, commit } = await checkout({ setup, setupRanOver: later, refunds: 'enters', runs: inPart(now, { 'src/setup.ts': digestString(later) }) });
    const { text, json } = await ask(at, '--file', 'src/setup.ts');

    expect(json).toMatchObject({ preconditionOf: ['src/pay.test.ts'] });
    expect(json['ran']).toEqual({
      stands: [
        { commit, tests: ['src/pay.test.ts'], cases: ['charges once'], landed: { first: iso(now - 3 * DAY), latest: iso(now - 3 * DAY), runs: 1 }, text: 'held' },
        {
          commit, tests: ['src/pay.test.ts'], cases: ['refunds'], landed: { first: iso(now - HOUR), latest: iso(now - HOUR), runs: 1 },
          text: 'other', other: ['src/setup.ts'],
        },
      ],
    });
    expect(text).toContain(
      "src/pay.test.ts ran 'refunds' over another text of src/setup.ts, in a run that landed 1 hour ago, and its 1 other case named here over this text, in a run that landed 3 days ago.\n",
    );
  });
});
