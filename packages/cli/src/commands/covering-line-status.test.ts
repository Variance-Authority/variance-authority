// compass: variance-authority.reach
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HOUR, PAY, iso, oneRun, recordFixture } from './covering-record.fixture.js';

/**
 * Each line a `covering` question asks has one status, decided once over the
 * case index and the texts the cases ran over: a case ran it, no case ran it,
 * which case ran it is not known, whether a case ran it is not known, or it was
 * written since the recording.
 * `pay` spans lines 1-6 and its branch 2-4; an edit to line 2 charges both,
 * one to 3 or 4 the branch alone. `charges once` called into `pay` and no case
 * into the branch, and `overran` is flagged where it is given.
 */

const { checkout, ask } = recordFixture();

const UNKNOWN = 'is in a text a case ran over, but a run over another text has landed there since, so which case ran it is not known.\n';
const UNKNOWNS = 'are in a text a case ran over, but a run over another text has landed there since, so which case ran them is not known.\n';
/** A runs record in which `src/pay.test.ts` last ran an hour ago over the committed text. */
const committed = (_: string, recorded: string | undefined) => ({ commit: recorded, ...oneRun(iso(Date.now() - HOUR), ['src/pay.test.ts']) });
/** The text the record holds: the committed one with line 5 edited, so the record has no place for a line 5 the committed text holds. */
const RECORDED = PAY.replace('return amount;', 'return amount + 0;');
const named = (json: Record<string, unknown>) => (json['tests'] as readonly { readonly name: string }[]).map((test) => test.name);

describe('a placed line', () => {
  it('names the case that called into it, and says nothing of it as not known', async () => {
    const { at } = await checkout();
    const { json } = await ask(at, '--file', 'src/pay.ts', '--line', '5');

    expect(named(json)).toEqual(['charges once']);
    expect(json).not.toHaveProperty('overwritten');
    expect(json).not.toHaveProperty('written');
  });

  it('says no case ran a line no case is held on', async () => {
    const { at } = await checkout();
    const { json } = await ask(at, '--file', 'src/pay.ts', '--line', '3');

    expect(json).toMatchObject({ tests: [] });
    expect(json).not.toHaveProperty('overwritten');
    expect(json).not.toHaveProperty('written');
  });

  it('says which case ran a line only a flagged case is held on is not known', async () => {
    const { at } = await checkout({ flagged: 'branch' });
    const { text, json } = await ask(at, '--file', 'src/pay.ts', '--line', '3');

    expect(json).toMatchObject({ tests: [], overwritten: [{ startLine: 3, endLine: 3 }] });
    expect(text).toContain(`Line 3 of src/pay.ts ${UNKNOWN}`);
  });

  it('names the case that called into a line beside a flagged one, and says nothing of the line as not known', async () => {
    const { at } = await checkout({ flagged: 'pay' });
    for (const asked of [['--line', '5'], ['--line', '1-6'], ['--function', 'pay']]) {
      const { text, json } = await ask(at, '--file', 'src/pay.ts', ...asked);

      expect(named(json)).toEqual(['charges once']);
      expect(json).not.toHaveProperty('overwritten');
      expect(text).not.toContain('a run over another text has landed there since');
    }
  });

  it('says a flagged branch of an asked function as not known, as it says the branch\'s line asked alone', async () => {
    const { at } = await checkout({ flagged: 'branch' });
    const { text, json } = await ask(at, '--file', 'src/pay.ts', '--function', 'pay');

    expect(named(json)).toEqual(['charges once']);
    expect(json).toMatchObject({ overwritten: [{ startLine: 3, endLine: 4 }] });
    expect(text).toContain(`Lines 3-4 ${UNKNOWNS}`);
  });
});

describe('a line the record has no place for', () => {
  it('is not known when a case ran over a known text that holds it unmoved', async () => {
    const { at } = await checkout({ ranOver: RECORDED, kept: true, runs: committed });
    // `charges once` last ran over the committed text, which holds line 5 as asked; the record's text does not.
    await writeFile(join(at, 'src/pay.ts'), PAY.replace('{\n  if', '{ // held\n  if'));
    const { text, json } = await ask(at, '--file', 'src/pay.ts', '--line', '5');

    expect(json).toMatchObject({ tests: [], overwritten: [{ startLine: 5, endLine: 5 }] });
    expect(json).not.toHaveProperty('written');
    expect(text).toContain(`Line 5 of src/pay.ts ${UNKNOWN}`);
  });

  it('is not known when the record does not say which text a case that entered the file ran over', async () => {
    // The landing names no texts, so whether `charges once` ran over the committed text, which holds line 5, is not known.
    const untold = (_: string, recorded: string | undefined) => {
      const { landings: [landing], ...run } = oneRun(iso(Date.now() - HOUR), ['src/pay.test.ts']);
      const { texts: _texts, ...named } = landing!;
      return { commit: recorded, ...run, landings: [named] };
    };
    const { at } = await checkout({ ranOver: RECORDED, kept: true, runs: untold });
    const { text, json } = await ask(at, '--file', 'src/pay.ts', '--line', '5');

    expect(json).toMatchObject({ tests: [], unknown: { lines: [{ startLine: 5, endLine: 5 }], why: 'the runs record does not say which text of src/pay.ts its runs there ran over' } });
    expect(json).not.toHaveProperty('written');
    expect(text).toContain('Whether a case has run line 5 of src/pay.ts is not known: the runs record does not say which text of src/pay.ts its runs there ran over.\n');
  });

  it('is not known when the only case that crossed the file is flagged there, and ran over the text as it is now', async () => {
    // `overran` ran `pay` over the committed text, and a run over the record's text has landed on it since; the disk holds the committed text again.
    const { at } = await checkout({ ranOver: RECORDED, kept: true, runs: committed, flagged: 'pay', unentered: true });
    const { text, json } = await ask(at, '--file', 'src/pay.ts', '--line', '5');

    expect(json).toMatchObject({ tests: [], overwritten: [{ startLine: 5, endLine: 5 }] });
    expect(json).not.toHaveProperty('written');
    expect(text).toContain(`Line 5 of src/pay.ts ${UNKNOWN}`);
  });

  it('was written since when the only text a case ran over holds it moved', async () => {
    const { at } = await checkout({ ranOver: RECORDED, kept: true, runs: committed });
    await writeFile(join(at, 'src/pay.ts'), PAY.replace('return amount;', 'return amount * 1;'));
    const { json } = await ask(at, '--file', 'src/pay.ts', '--line', '5');

    expect(json).toMatchObject({ tests: [], written: [{ startLine: 5, endLine: 5 }] });
    expect(json).not.toHaveProperty('overwritten');
  });
});

describe('a run of lines', () => {
  it('gives each line one status: ran, not known, or written since, a call outranking a flag on the same line', async () => {
    const { at } = await checkout({ flagged: 'branch', runs: committed });
    await writeFile(join(at, 'src/pay.ts'), PAY.replace('  }\n', '  }\n  const charged = amount;\n'));
    const { text, json } = await ask(at, '--file', 'src/pay.ts', '--line', '1-7');

    expect(named(json)).toEqual(['charges once']);
    // Line 2 charges `pay`, which `charges once` called, beside the flagged branch.
    expect(json).toMatchObject({ frame: 'mapped', overwritten: [{ startLine: 3, endLine: 4 }], written: [{ startLine: 5, endLine: 5 }] });
    expect(text).toContain(`Lines 3-4 ${UNKNOWNS}`);
  });
});
