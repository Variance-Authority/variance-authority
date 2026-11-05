import { afterEach, describe, expect, it } from 'vitest';
import { treeOf } from '@variance-authority/mcp/tools';
import { readHelp } from '@variance-authority/package/help';
import { INVENTED_PACKAGES } from '../__fixtures__/invented-packages.js';
import { inventedWorkspace } from '../__fixtures__/invented-workspace.js';
import { answerSearch, searchIndexOf } from './search.js';

/**
 * A reader checks a row by what it prints, so a row prints the sentence of its
 * doc that holds the question, wherever in the doc that sentence is written.
 */

const before = process.env['VARIANCE_AUTHORITY_CACHE'];
afterEach(() => {
  if (before === undefined) delete process.env['VARIANCE_AUTHORITY_CACHE'];
  else process.env['VARIANCE_AUTHORITY_CACHE'] = before;
});

const ask = async (own: Readonly<Record<string, string>>, query: string): Promise<string> => {
  const root = await inventedWorkspace(INVENTED_PACKAGES, ['react'], own);
  return answerSearch(searchIndexOf(readHelp(root)), { query }, treeOf([], root), root);
};

/** The row of `name` in the section that answers a description. */
const rowOf = (said: string, name: string): string | undefined =>
  said.split('\n').find((line) => line.includes('[holds:') && line.includes(name));

const DOC = [
  '/**',
  ' * Offer entries to a line.',
  ' *',
  ' * Writes them in order. A held entry in a newer format is kept on any line,',
  ' * so an old reader cannot take the line back a version.',
  ' */',
].join('\n');

describe('a row prints the sentence that holds the question', () => {
  it('ends a sentence where a tag line starts, though no stop closes it', async () => {
    const doc = '/**\n * Offers a tuned xylophone\n * @see the grower of a banana.\n */';
    const said = await ask({ 'src/offer.ts': `${doc}\nexport const offer = 1;\n` }, 'banana grower');
    expect(rowOf(said, 'offer')).toContain('@see the grower of a banana.');
    expect(rowOf(said, 'offer')).not.toContain('xylophone');
  });

  it('prints it for an exported name, past the doc it opens with', async () => {
    const said = await ask({ 'src/offer.ts': `${DOC}\nexport const offer = 1;\n` }, 'can an old reader take the line back');
    expect(rowOf(said, 'offer')).toContain('A held entry in a newer format is kept on any line, so an old reader cannot take the line back a version.');
    expect(rowOf(said, 'offer')).not.toContain('Offer entries to a line.');
  });

  it('prints it for a name its file keeps to itself', async () => {
    const said = await ask({ 'src/offer.ts': `${DOC}\nconst offer = 1;\nexport const other = offer;\n` }, 'can an old reader take the line back');
    expect(rowOf(said, 'offer [const]')).toContain('so an old reader cannot take the line back a version.');
  });

  it('prints it for a file', async () => {
    const said = await ask({ 'src/offer.ts': `${DOC}\n\nexport const other = 1;\n` }, 'can an old reader take the line back');
    expect(rowOf(said, 'src/offer.ts [file]')).toContain('so an old reader cannot take the line back a version.');
  });

  it('takes the earliest of the sentences that hold as much', async () => {
    const said = await ask({ 'src/offer.ts': '/**\n * Opens a ledger.\n *\n * A ledger first. A ledger second.\n */\nexport const offer = 1;\n' }, 'ledger');
    expect(said).toContain('Opens a ledger.');
    expect(said).not.toContain('A ledger second.');
  });

  it('prints the opening of a doc that holds none of it', async () => {
    const said = await ask({ 'src/ledgerOffer.ts': '/**\n * Opens a book.\n *\n * Closes it after.\n */\nexport const ledgerOffer = 1;\n' }, 'ledger');
    expect(said).toContain('Opens a book.');
    expect(said).not.toContain('Closes it after.');
  });

  it('reads no code block as a sentence', async () => {
    const doc = '/**\n * Opens a book.\n *\n * ```ts\n * ledger(1);\n * ```\n */\nexport const offer = 1;\nexport const ledger = offer;\n';
    const said = await ask({ 'src/offer.ts': doc }, 'ledger');
    expect(said).not.toContain('ledger(1);');
  });
});

describe('a comment that describes a file is the file\'s', () => {
  const BANNER = '/**\n * Ephemeral mode cancels out by construction.\n */\n\nconst MAC = 1;\nexport const other = MAC;\n';

  it('holds its words for the file and for no declaration under it', async () => {
    const said = await ask({ 'src/store.ts': BANNER }, 'ephemeral mode cancels out by construction');
    expect(rowOf(said, 'src/store.ts [file]')).toContain('Ephemeral mode cancels out by construction.');
    expect(rowOf(said, 'MAC')).toBeUndefined();
  });

  it('never ranks a declaration that holds none of the words above one that states them', async () => {
    const said = await ask(
      {
        'src/store.ts': BANNER,
        'src/mode.ts': '/** Ephemeral mode cancels out by construction. */\nconst stated = 1;\nexport const held = stated;\n',
      },
      'ephemeral mode cancels out by construction',
    );
    expect(said).toContain('stated [const]');
    expect(said).not.toContain('MAC');
  });
});
