import { afterEach, describe, expect, it } from 'vitest';
import { treeOf } from '@variance-authority/mcp/tools';
import { readHelp } from '@variance-authority/package/help';
import { INVENTED_PACKAGES } from '../__fixtures__/invented-packages.js';
import { inventedWorkspace } from '../__fixtures__/invented-workspace.js';
import { answerSearch, searchIndexOf } from './search.js';

/**
 * A row sharing one common word with a question is no evidence of what was
 * asked, so what a description answers holds most of the question's rarity, and
 * a concept the repository lacks is told as a plain none.
 */

const before = process.env['VARIANCE_AUTHORITY_CACHE'];
afterEach(() => {
  if (before === undefined) delete process.env['VARIANCE_AUTHORITY_CACHE'];
  else process.env['VARIANCE_AUTHORITY_CACHE'] = before;
});

const ask = async (files: Record<string, string>, query: string, from?: string): Promise<string> => {
  const root = await inventedWorkspace(INVENTED_PACKAGES, ['react'], files);
  return answerSearch(searchIndexOf(readHelp(root)), { query, ...(from === undefined ? {} : { from }) }, treeOf(from === undefined ? [] : [{ file: from }], root), root);
};

/** Thirty names holding `file`, so the word is common among what was reached. */
const FILES = {
  'src/paths.ts': Array.from({ length: 30 }, (_, at) => `export const fileAt${at} = ${at};\n`).join(''),
};

describe('a concept nothing implements', () => {
  it('is a plain none, though a common word of the question is held', async () => {
    const said = await ask(FILES, 'xylophone quantum banana file');
    expect(said).not.toContain('[holds:');
    expect(said).not.toContain('The nearest follow.');
    expect(said).not.toMatch(/fileAt\d/u);
    expect(said).toContain('`packages` lists every entrypoint');
  });

  it('counts none of the names sharing the common word', async () => {
    const said = await ask(FILES, 'xylophone quantum banana file');
    expect(said).not.toMatch(/\d+ names? (?:and files )?in this repository/u);
  });
});

describe('a question whose words are not equally rare', () => {
  const FIXTURE = {
    ...FILES,
    'src/rare.ts': '/** Weighs a xylophone against a file. */\nexport const tuned = 1;\n\n/** Plays a xylophone. */\nexport const played = 1;\n',
  };

  it('neither shows nor counts a row holding only the common word, beside a row holding the rare one', async () => {
    const said = await ask(FIXTURE, 'xylophone file');
    expect(said).toMatch(/^2 names and files in this repository hold most of `xylophone file`/mu);
    expect(said).toMatch(/^tuned .*\[holds: file, xylophone\]/mu);
    expect(said).toMatch(/^played .*\[holds: xylophone\]/mu);
    expect(said).not.toMatch(/fileAt\d/u);
  });

  it('keeps a row lacking one rare word when the rest of the question outweighs it', async () => {
    // The shape of `count probes and measure their overhead`: `census` holds
    // three of the four words, and not the rarest.
    const said = await ask({
      ...FILES,
      'src/census.ts': '/** Counts the file probes and measures them. */\nexport const census = 1;\n',
      'src/probes.ts': '/** One probe. */\nexport const probe = 1;\n\n/** Another probe. */\nexport const sonde = 1;\n',
      'src/gauges.ts': '/** One measure. */\nexport const gauge = 1;\n\n/** Another measure. */\nexport const meter = 1;\n',
      'src/overhead.ts': '/** The overhead. */\nexport const toll = 1;\n',
    }, 'file probes measure overhead');
    expect(said).toMatch(/^census .*\[holds: file, measure, probes\]/mu);
  });

  it('names the two files that measure the probes in the first ten rows of the probe census question', async () => {
    // The two files as this repository writes them, `cost.measure.ts` lacking `overhead`, among more than ten rows
    // that also pass the cut and names holding only the common words, which do not.
    const each = (count: number, line: (at: number) => string): string => Array.from({ length: count }, (_, at) => line(at)).join('');
    const said = await ask({
      'scripts/overhead.mjs': '#!/usr/bin/env node\n\n/**\n * What the probes cost, measured on a real subsystem rather than a loop.\n */\n\nconst staging = 1;\nexport { staging };\n',
      'src/cost.measure.ts': "import { describe } from 'vitest';\n\n/**\n * The cost argument, measured rather than asserted. A count is exact, and the\n * suite instruments every module it loads, so probes land in one half.\n */\n\ndescribe('cost', () => {});\n",
      'src/filler.ts': each(300, (at) => `export const filler${at} = ${at};\n`),
      'src/counts.ts': each(30, (at) => `/** Counts the lines of a file. */\nexport const counted${at} = ${at};\n`),
      'src/measures.ts': each(30, (at) => `/** Measures how wide a box is. */\nexport const measured${at} = ${at};\n`),
      'src/tally.ts': each(12, (at) => `/** Counts the boxes and measures them. */\nexport const tally${at} = ${at};\n`),
      'src/sampled.ts': each(8, (at) => `/** Measures a sample. */\nexport function sampled${at}(probes: number, count: number): number {\n  return probes + count;\n}\n`),
      'src/census.ts': each(4, (at) => `/** Counts the probes a run measures. */\nexport const census${at} = ${at};\n`),
    }, 'count probes and measure their overhead');
    const rows = said.split('\n').filter((line) => line.includes('[holds:'));
    expect(rows.length).toBeGreaterThan(10);
    expect(rows.some((row) => /^(?:counted|measured|tally)\d/u.test(row))).toBe(false);
    rows.splice(10);
    expect(rows.some((row) => row.startsWith('scripts/overhead.mjs '))).toBe(true);
    expect(rows.some((row) => row.startsWith('src/cost.measure.ts '))).toBe(true);
  });
});

describe('a question asked from an area', () => {
  const FIXTURE = {
    ...FILES,
    'src/here.ts': '/** Plays a xylophone. */\nexport const played = 1;\n\n/** Reads a file. */\nexport const opened = 1;\n',
  };

  it('cuts by how the whole repository holds the words, so a row answering it everywhere answers it here', async () => {
    const alone = {
      ...FILES,
      'src/filler.ts': Array.from({ length: 300 }, (_, at) => `export const filler${at} = ${at};\n`).join(''),
      'src/here.ts': '/** Plays a xylophone. */\nexport const played = 1;\n',
    };
    const everywhere = await ask(alone, 'xylophone file');
    expect(everywhere).toMatch(/^played .*\[holds: xylophone\]/mu);
    const here = await ask(alone, 'xylophone file', 'src/here.ts');
    expect(here).toMatch(/^played .*\[holds: xylophone\]/mu);
  });

  it('keeps out a row holding only the word the rest of the repository holds', async () => {
    const here = await ask(FIXTURE, 'xylophone file', 'src/here.ts');
    expect(here).not.toMatch(/^opened .*\[holds:/mu);
  });
});

describe('a row holding exactly half of the question', () => {
  it('stays: of two equally rare words, either one is the nearest there is', async () => {
    const said = await ask({
      'src/half.ts': '/** Plays a xylophone. */\nexport const played = 1;\n\n/** Grows a banana. */\nexport const grown = 1;\n',
    }, 'xylophone banana');
    expect(said).toMatch(/^played .*\[holds: xylophone\]/mu);
    expect(said).toMatch(/^grown .*\[holds: banana\]/mu);
  });
});

describe('the opening over a question no name writes', () => {
  it('says the nearest follow only when a row passes the cut', async () => {
    const files = { ...FILES, 'src/rare.ts': '/** Plays a xylophone. */\nexport const played = 1;\n' };
    const held = await ask(files, 'xylophone file');
    expect(held).toContain('writes `xylophone file`. The nearest follow.');
    const none = await ask(files, 'quantum banana file');
    expect(none).toContain('writes `quantum banana file`. `packages` lists every entrypoint');
  });
});

describe('a name written in two rows', () => {
  it('answers through the row carrying the question, though the ranking prefers a shorter doc', async () => {
    const said = await ask({
      'src/colours.ts': Array.from({ length: 30 }, (_, at) => `/** Holds amber. */\nexport const shade${at} = ${at};\n`).join(''),
      'src/long.ts': `/** Mixes amber with cobalt and violet, ${'at great length and over many words, '.repeat(12)}until they settle. */\nexport const pigment = 1;\n`,
      'src/short.ts': '/** Holds violet. */\nexport const pigment = 2;\n',
    }, 'amber cobalt violet quantum');
    expect(said).toMatch(/^pigment .*\[holds: (?=.*amber)(?=.*cobalt)(?=.*violet)/mu);
  });
});
