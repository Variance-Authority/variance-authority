import { lexiconOfValues } from '@variance-authority/core/attribute';
import { describe, expect, it } from 'vitest';
import { collectEvidence } from './collect.js';
import { mergeEvidence, type Named } from './collect-merge.js';
import type { Collected, Plan } from './collector.js';
import { collecting, planOf, rendered } from './evidence-fixture.js';
import { recipeOf, type EvidencePart } from './evidence-part.js';
import { configOf } from './run-fixture.js';

const PLAN = planOf([
  ['button--primary', 'src/Button.stories.tsx'],
  ['button--quiet', 'src/Button.stories.tsx'],
  ['card--default', 'src/Card.stories.tsx'],
  ['menu--open', 'src/Menu.stories.tsx'],
  ['page--home', 'src/Page.stories.tsx'],
  ['page--away', 'src/Page.stories.tsx'],
  ['toast--shown', 'src/Toast.stories.tsx'],
]);

/**
 * `page--home` reads 201 words, one more than a subject keeps. Alone, every
 * word is as rare as the next and the cap drops the last in code-unit order,
 * `zz-only-here`. With the suite counted, `a000` is the one `toast--shown`
 * also holds, and that is the one to drop.
 */
function answer(id: string): Collected {
  if (id === 'page--home') {
    const words = Array.from({ length: 200 }, (_, i) => ({ owner: 'Page', text: `a${String(i).padStart(3, '0')}` }));
    return rendered(id, [...words, { owner: 'Page', text: 'zz-only-here' }]);
  }
  if (id === 'toast--shown') return rendered(id, [{ owner: 'Toast', text: 'a000' }]);
  const owner = id.split('--')[0]!.replace(/^./, (first) => first.toUpperCase());
  return rendered(id, [{ owner, text: `Read ${id}`, file: `src/${owner}.tsx` }, { owner: 'Icon', text: 'Close' }]);
}

async function partsOf(
  total: number | undefined,
  options: { plan?: Plan; answer?: (id: string) => Collected; scope?: string; recipe?: string; commit?: string } = {},
): Promise<Named[]> {
  const shards = total === undefined ? [undefined] : Array.from({ length: total }, (_, i) => ({ index: i + 1, total }));
  return Promise.all(
    shards.map(async (shard, i) => ({
      path: `evidence-${String(i + 1)}.json`,
      part: await collectEvidence({
        collector: collecting(options.plan ?? PLAN, options.answer ?? answer).collector,
        config: configOf({ workers: 2 }),
        ...(shard === undefined ? {} : { shard }),
        ...(options.scope === undefined ? {} : { scope: options.scope }),
        build: { commit: options.commit ?? 'c0ffee', storybook: 'sb' },
        recipe: recipeOf({ cli: options.recipe ?? 'test' }),
      }),
    })),
  );
}

function merged(parts: readonly Named[]) {
  const result = mergeEvidence(parts);
  if (result.kind === 'refused') throw new Error(result.because);
  return result;
}

function refusal(parts: readonly Named[]): string {
  const result = mergeEvidence(parts);
  if (result.kind !== 'refused') throw new Error('merged parts that should have been refused');
  return result.because;
}

const edit = (named: Named, change: (part: EvidencePart) => EvidencePart): Named => ({ ...named, part: change(named.part) });

describe('mergeEvidence: the index of the whole suite, from every shard of one collection', () => {
  it('composes the same index from one part, from four, and from four in any order', async () => {
    const whole = merged(await partsOf(undefined)).index;
    const four = await partsOf(4);

    expect(merged(four).index).toEqual(whole);
    expect(merged([four[2]!, four[0]!, four[3]!, four[1]!]).index).toEqual(whole);
    expect(merged(await partsOf(3)).index).toEqual(whole);
  });

  it('caps a subject against the whole suite, not against its own shard', async () => {
    const parts = await partsOf(4);
    const holder = parts.find((named) => named.part.subjects.some((row) => row.subject === 'page--home'))!;
    expect(holder.part.subjects.some((row) => row.subject === 'toast--shown')).toBe(false);
    const alone = lexiconOfValues(holder.part.subjects.map((row) => row.lexicon)).find((subject) => subject.subject === 'page--home')!;
    expect(alone.terms.text).not.toContain('zz-only-here');

    const page = merged(parts).index.lexicon!.subjects.find((subject) => subject.subject === 'page--home')!;
    expect(page.terms.text).toContain('zz-only-here');
    expect(page.terms.text).not.toContain('a000');
    expect(page.elided).toEqual({ text: 1 });
  });

  it('accounts for every subject, and names what the index was composed from', async () => {
    const { index } = merged(await partsOf(2));

    expect(index.commit).toBe('c0ffee');
    expect(index.coverage?.map((entry) => entry.outcome)).toEqual(Array(7).fill('collected'));
    expect(index.provenance).toMatchObject({ assignment: 'checksum', storybook: 'sb' });
    expect(index.subjects).toHaveLength(7);
  });

  it('takes where a component is declared from the scan, under what the engine located', async () => {
    const located = (id: string): Collected => {
      const collected = answer(id);
      if (!collected.ok || !id.startsWith('menu')) return collected;
      return { ...collected, source: { Menu: [{ file: 'src/menu/Menu.tsx', line: 4, via: 'engine' }] } };
    };
    const { index } = merged(await partsOf(3, { answer: located }));

    expect(index.lexicon?.declaredIn).toEqual({ Menu: ['src/menu/Menu.tsx'] });
    const menu = index.lexicon!.subjects.find((subject) => subject.subject === 'menu--open')!;
    expect(menu.terms.files).toEqual(['src/Menu.tsx', 'src/menu/Menu.tsx']);
  });

  it('composes an explicit empty index from an empty plan', async () => {
    const result = merged(await partsOf(2, { plan: planOf([]) }));

    expect(result.index).toMatchObject({ subjects: [], components: [], coverage: [] });
    expect(result.failed).toEqual([]);
  });

  it('publishes a scope as itself, with what it left out', async () => {
    const { index } = merged(await partsOf(2, { scope: 'button--*' }));

    expect(index.provenance?.scope).toBe('button--*');
    expect(index.subjects).toEqual(['button--primary', 'button--quiet']);
    expect(index.coverage?.filter((entry) => entry.outcome === 'excluded')).toHaveLength(5);
  });

  it('names a subject that failed and the shard to collect again', async () => {
    const failing = (id: string): Collected => (id === 'card--default' ? { ok: false, because: 'no theme' } : answer(id));
    const parts = await partsOf(4, { answer: failing });
    const result = merged(parts);
    const owner = parts.find((named) => named.part.outcomes.some((outcome) => outcome.subject === 'card--default'))!;

    expect(result.failed).toEqual([{ subject: 'card--default', because: 'no theme', shard: owner.part.shard }]);
    expect(result.index.coverage).toContainEqual({ subject: 'card--default', outcome: 'failed', because: 'no theme' });
  });

  describe('refuses parts that are not one collection', () => {
    it('with a shard missing, named twice, or cut a different number of ways', async () => {
      const four = await partsOf(4);
      expect(refusal(four.slice(0, 3))).toMatch(/shard 4\/4 is missing/);
      expect(refusal([...four, four[1]!])).toMatch(/shard 2\/4 was given twice/);
      expect(refusal([...(await partsOf(2)), ...four.slice(2)])).toMatch(/cut 2 ways and 4 ways/);
    });

    it('with a whole collection beside a shard of one', async () => {
      expect(refusal([...(await partsOf(undefined)), ...(await partsOf(2))])).toMatch(/an unsharded part was given with shard 1\/2/);
    });

    it('with two whole collections', async () => {
      const [whole] = await partsOf(undefined);
      expect(refusal([whole!, { ...whole!, path: 'evidence-2.json' }])).toMatch(/two unsharded parts were given/);
    });

    it('from plans of the same length that differ', async () => {
      const other = planOf(PLAN.subjects.map((planned, i) => [i === 3 ? 'menu--closed' : planned.subject.id, planned.declaredIn]));
      const [first] = await partsOf(2);
      const [, second] = await partsOf(2, { plan: other });
      expect(refusal([first!, second!])).toMatch(/plan/);
    });

    it('read under another recipe or from another build', async () => {
      const [first] = await partsOf(2);
      expect(refusal([first!, (await partsOf(2, { recipe: 'other' }))[1]!])).toMatch(/recipe/);
      expect(refusal([first!, (await partsOf(2, { commit: 'beef' }))[1]!])).toMatch(/build/);
    });

    it('claiming a subject another shard owns, or omitting one it owns', async () => {
      const [first, second] = await partsOf(2);
      const stolen = second!.part.outcomes[0]!;
      const claiming = edit(first!, (part) => ({ ...part, outcomes: [...part.outcomes, stolen].sort((l, r) => l.position - r.position) }));
      expect(refusal([claiming, second!])).toMatch(new RegExp(`${stolen.subject}, but shard 2/2 owns it`));

      const omitting = edit(first!, (part) => ({ ...part, outcomes: part.outcomes.slice(1) }));
      expect(refusal([omitting, second!])).toMatch(/says nothing of/);
    });

    it('with a subject at a position the plan gives another', async () => {
      const [first, second] = await partsOf(2);
      const swapped = edit(first!, (part) => ({
        ...part,
        outcomes: part.outcomes.map((outcome, i) => (i === 0 ? { ...outcome, subject: 'nobody--here' } : outcome)),
      }));
      expect(refusal([swapped, second!])).toMatch(/nobody--here at position/);
    });

    it('holding a field in a row it does not say it read', async () => {
      const [first, second] = await partsOf(2);
      const stray = edit(first!, (part) => ({
        ...part,
        subjects: part.subjects.map((row, i) =>
          i === 0 ? { ...row, lexicon: { ...row.lexicon, fields: { ...row.lexicon.fields, regions: ['banner'] } } } : row,
        ),
      }));
      expect(refusal([stray, second!])).toMatch(/evidence-1\.json holds regions for .*, a field it does not say it read/);
    });

    it('with no parts at all', () => {
      expect(refusal([])).toBe('no parts were given');
    });
  });
});
