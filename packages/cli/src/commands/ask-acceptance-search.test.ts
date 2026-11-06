import { describe, expect, it } from 'vitest';
import { indexAcceptance } from './ask-acceptance.fixture.js';
import { search } from './ask-facts.fixture.js';

/** `variance ask search` held to spec 0104: a name found by what it does. */

indexAcceptance('search');

describe('ask search', () => {
  it('finds a name by the words it is spelled with', async () => {
    expect((await search('png size')).hits[0]).toEqual({ name: 'pngSize', file: 'packages/core/src/png.ts', visibility: 'published' });
  });

  it('finds a name by the words of its documentation', async () => {
    expect((await search('repository relative path')).hits.map((hit) => hit.name)).toEqual(['CheckoutPath']);
  });

  it('finds nothing for a word nothing carries', async () => {
    expect((await search('zzqx')).hits).toEqual([]);
  });

  it.todo('answers one ranked list, each hit with its file, line and visibility — needs the tiers folded into one list ranked by one score');
  it.todo('ranks a rare word above a common one, and a short name above a long document — needs a score that weighs each word by how few declarations carry it');
  it.todo('finds an unexported name and a member, ranked below what is published — needs unexported and member declarations in the search index');
  it.todo('answers a third-party name only when narrowed to its package — needs third-party hits answered through `--package` instead of a tier of their own');
  it.todo('opens on its first hit, never on "nothing matches" while partial hits follow — needs the renderer to open on the list, not on the empty tiers');
  it.todo('names the word of the query nothing carries — needs the words that matched nothing carried to the answer');
  it.todo('exits 1 when nothing matches — needs the exit code chosen from the answer instead of always 0');
});
