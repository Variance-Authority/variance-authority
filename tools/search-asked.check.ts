import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { searchIndexOf, searchNames, symbol } from '@variance-authority/help/tools';
import { readHelp } from '@variance-authority/package/help';

/**
 * A declaration in this repository is found by the words a reader asks with.
 *
 * `ask search` ranks a doc by the words it holds, so a doc that says what its
 * declaration does in other words, or sits on a neighbour, is not found. Each
 * question here once missed the rows `ask search` shows, and is held to them.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const help = readHelp(ROOT, { skip: ['docs-examples'] });
const index = searchIndexOf(help);

/** The described rows `ask search` shows for `query`, as `name file [words]`. */
const shown = (query: string): readonly string[] =>
  (searchNames(index, { query }, undefined, ROOT).described?.shown ?? []).map(
    (row) => `${'name' in row ? row.name : '[file]'} ${row.at.replace(/:\d+$/, '')} [${row.words.join(', ')}]`,
  );

const ASKED: readonly (readonly [query: string, answer: RegExp])[] = [
  ['stopped state of a replaced case', /^replacedCases packages\/cli\/src\/commands\/execution-input\.ts /],
  ['vite plugin transform hook instruments each module', /^testSelectionProbes packages\/sense\/src\/test-selection\/probes\.ts /],
  ['snapshot file written by a test case', /^snapshotValue packages\/unit-test\/src\/value\.ts /],
  ['assertion expect call in a test file', /^(instrumentLocator|ConsumedLocatorAttention) packages\/eyes\/src\//],
  ['catch clause region kind', /^BlockKind packages\/sense\/src\/instrument\/spliced\.ts \[.*\bcatch\b.*\bclause\b/],
  ['stack frame to source region', /^locateSites packages\/core\/src\/attribute\/call-site\.ts /],
  ['order the ask questions are meant to be asked in', /^(ALONE|HELP_TOOLS) packages\/help\/src\/tools\.ts /],
];

describe('a question asked in the words a reader uses', () => {
  it.each(ASKED)('"%s" shows its answer among the rows', (query, answer) => {
    const rows = shown(query);
    expect(rows.find((row) => answer.test(row)), rows.join('\n')).toBeDefined();
  });

  it('reads the tool order on the list that holds it, not on the wrapper above it', () => {
    const dated = symbol.run(help, { name: 'dated' }, { root: ROOT, shell: 'variance' });
    expect(dated).toMatch(/packages\/help\/src\/tools\.ts:\d+/);
    expect(dated).not.toContain('the order they are meant to be asked in');
  });
});
