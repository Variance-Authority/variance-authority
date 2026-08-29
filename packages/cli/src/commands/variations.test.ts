import { describe, expect, it } from 'vitest';
import { environmentKey, profileById, type SemanticSnapshot } from '@variance-authority/core';
import type { Plan, PlannedSubject } from './collector.js';
import type { NamesConfig } from '../config-names.js';
import { resolveParents, variationsOf, variationsWanted } from './variations.js';

/**
 * The declaration, and what it is allowed to mean.
 *
 * Every collector expresses a variation differently — a story sets args, a route
 * sets a query, a fixture routes a request — so the only thing shared across
 * them is the *link*, and the link is a tag. These are about the link: whether a
 * tag names a subject, whether an ambiguous one is refused rather than guessed,
 * and whether a difference that could not be measured says so.
 */

const planned = (id: string, tags?: readonly string[]): PlannedSubject => ({
  subject: { id, kind: 'fixture' },
  ...(tags !== undefined ? { tags } : {}),
});

const planOf = (...subjects: readonly PlannedSubject[]): Plan => ({
  subjects,
  notObserved: [],
  warnings: [],
});

function snapshotOf(id: string, text: string): SemanticSnapshot {
  return {
    formatVersion: 1,
    subject: { id, kind: 'fixture' },
    profile: profileById('chromium'),
    environment: environmentKey({
      profile: 'chromium',
      engine: 'chromium@131',
      ruleset: 'test',
      allowlist: 'test',
      viewport: { width: 1280, height: 720, deviceScaleFactor: 1, colorScheme: 'light' },
      fonts: [],
      conditions: {},
      assets: {},
    }),
    // Distinct per text, so the cheap short-circuit does not settle a pair the
    // test means to have compared.
    renderHash: `v1:${text}`,
    structureHash: 'v1:s',
    styleHash: 'v1:y',
    root: {
      path: '0',
      tag: 'div',
      attributes: {},
      style: {},
      provenance: { owners: [{ name: 'Panel', propsDigest: 'v1:x' }] },
      children: [
        {
          path: '0/0',
          tag: 'span',
          attributes: {},
          style: {},
          text,
          provenance: { owners: [{ name: 'Panel', propsDigest: 'v1:x' }] },
          children: [],
        },
      ],
    },
    styleProvenance: [],
    diagnostics: [],
  };
}

describe('resolving the parent a subject declared', () => {
  it('takes a full subject id', () => {
    const plan = planOf(
      planned('fixture:panel'),
      planned('fixture:panel-flagged', ['variance-parent:fixture:panel']),
    );

    expect(resolveParents(plan).get('fixture:panel-flagged')).toEqual({
      ok: true,
      parent: 'fixture:panel',
      how: 'declared',
    });
  });

  it('takes a unique suffix, because a story knows its own id and not our prefix', () => {
    const plan = planOf(
      planned('story:components-button--primary'),
      planned('story:components-button--primary-dark', [
        'variance-parent:components-button--primary',
      ]),
    );

    expect(resolveParents(plan).get('story:components-button--primary-dark')).toEqual({
      ok: true,
      parent: 'story:components-button--primary',
      how: 'declared',
    });
  });

  it('refuses an ambiguous suffix rather than taking the first', () => {
    // Two subjects ending the same way is a plan where the tag means two things.
    // Picking one attaches the difference to the wrong parent and prints it with
    // full confidence, which is worse than printing nothing.
    const plan = planOf(
      planned('story:a--x'),
      planned('route:a--x'),
      planned('story:b', ['variance-parent:a--x']),
    );

    const link = resolveParents(plan).get('story:b');
    expect(link?.ok).toBe(false);
    expect(link).toMatchObject({ because: expect.stringContaining('2 subjects') });
  });

  it('reports a parent this run never planned', () => {
    const plan = planOf(planned('fixture:b', ['variance-parent:fixture:gone']));

    expect(resolveParents(plan).get('fixture:b')).toMatchObject({
      ok: false,
      because: expect.stringContaining('planned no such subject'),
    });
  });

  it('refuses a subject that names itself', () => {
    const plan = planOf(planned('fixture:a', ['variance-parent:fixture:a']));

    expect(resolveParents(plan).get('fixture:a')).toMatchObject({ ok: false });
  });
});

describe('the parent a name names', () => {
  const linkOf = (...ids: readonly string[]) =>
    resolveParents(planOf(...ids.map((id) => planned(id))));

  it('reads a subject that is another subject plus an axis', () => {
    expect(linkOf('story:checkout', 'story:checkout-dark').get('story:checkout-dark')).toEqual({
      ok: true,
      parent: 'story:checkout',
      how: 'named',
    });
  });

  it('takes the longest, so a chain is a chain and not a fan', () => {
    // The great green dragon rule doing its work: written in a settled order,
    // each name is its parent plus exactly one axis, and one axis is the only
    // difference worth reading.
    const links = linkOf('story:checkout', 'story:checkout-dark', 'story:checkout-dark-narrow');

    expect(links.get('story:checkout-dark-narrow')).toMatchObject({
      parent: 'story:checkout-dark',
    });
    expect(links.get('story:checkout-dark')).toMatchObject({ parent: 'story:checkout' });
    expect(links.get('story:checkout')).toBe(undefined);
  });

  it('refuses a name that merely shares a stem', () => {
    // `checkout` is not the parent of `checkouts`, and a tool that thought so
    // would attach a difference between two unrelated subjects to a flag.
    expect(linkOf('story:checkout', 'story:checkouts').get('story:checkouts')).toBe(undefined);
  });

  it('never lets a name answer for a tag that failed', () => {
    // A written declaration that resolved to nothing is a mistake to report. An
    // inference quietly substituted for it would hide the mistake behind an
    // answer shaped like the one that was asked for.
    const plan = planOf(
      planned('story:checkout'),
      planned('story:checkout-dark', ['variance-parent:story:gone']),
    );

    expect(resolveParents(plan).get('story:checkout-dark')).toMatchObject({ ok: false });
  });
});

describe('a name read through the configured grammar', () => {
  const names: NamesConfig = {
    axes: [
      { axis: 'state', values: ['default', 'empty'] },
      { axis: 'colour', values: ['green', 'glass'] },
    ],
  };

  it('links two names of the same length, which a prefix cannot', () => {
    const plan = planOf(planned('fixture:dragon-green'), planned('fixture:dragon-glass'));

    expect(resolveParents(plan, names).get('fixture:dragon-glass')).toEqual({
      ok: true,
      parent: 'fixture:dragon-green',
      how: 'named',
      step: { axis: 'colour', from: 'green', to: 'glass' },
    });
  });

  it('takes a spelled baseline for the baseline it is', () => {
    // Without the grammar `dragon--default` and `dragon--empty` are two names
    // neither of which extends the other, so nothing is compared at all.
    const plan = planOf(planned('fixture:dragon--default'), planned('fixture:dragon--empty'));

    expect(resolveParents(plan, names).get('fixture:dragon--empty')).toMatchObject({
      parent: 'fixture:dragon--default',
    });
    expect(resolveParents(plan).get('fixture:dragon--empty')).toBe(undefined);
  });

  it('replaces the prefix rule rather than backing it up', () => {
    // `dragon-tail` is a name the grammar found nothing in. Answering it by
    // prefix would print an unconfigured guess in the shape of a configured
    // reading, which is the one failure a format is written down to prevent.
    const plan = planOf(planned('fixture:dragon'), planned('fixture:dragon-tail'));

    expect(resolveParents(plan, names).get('fixture:dragon-tail')).toBe(undefined);
    expect(resolveParents(plan).get('fixture:dragon-tail')).toMatchObject({
      parent: 'fixture:dragon',
    });
  });

  it('names the axis in the sentence, so the difference is a question somebody asked', () => {
    const records = variationsOf({
      plan: planOf(planned('fixture:dragon-green'), planned('fixture:dragon-glass')),
      names,
      snapshots: new Map([
        ['fixture:dragon-green', snapshotOf('fixture:dragon-green', 'buy')],
        ['fixture:dragon-glass', snapshotOf('fixture:dragon-glass', 'buy now')],
      ]),
    });

    expect(records?.[0]?.parent).toBe('fixture:dragon-green');
    expect(records?.[0]?.because).toContain('`colour` is `glass` here and `green` there');
  });
});

describe('what the run has to hold on to', () => {
  it('wants both ends of a link and nothing else', () => {
    const plan = planOf(
      planned('fixture:a'),
      planned('fixture:unrelated'),
      planned('fixture:b', ['variance-parent:fixture:a']),
    );

    // The saving this exists for: a 300-subject run holds two trees, not 300.
    expect([...variationsWanted(plan)].sort()).toEqual(['fixture:a', 'fixture:b']);
  });

  it('wants the leaves of a named lattice, which are the parent of nothing', () => {
    const names: NamesConfig = {
      axes: [
        { axis: 'offer', values: ['control', 'sale'] },
        { axis: 'scheme', values: ['light', 'dark'] },
      ],
    };
    const plan = planOf(
      planned('story:card--control'),
      planned('story:card--sale'),
      planned('story:card--control-dark'),
      planned('story:card--sale-dark'),
    );

    // `sale-dark` is where both arms are on at once — the cell the grammar is
    // written to measure, and the one nothing is a variation of.
    expect([...variationsWanted(plan, names)]).toContain('story:card--sale-dark');
  });

  it('wants nothing when a declaration resolved to nothing', () => {
    const plan = planOf(planned('fixture:b', ['variance-parent:fixture:gone']));

    expect(variationsWanted(plan).size).toBe(0);
  });
});

describe('the records a run reports', () => {
  const plan = planOf(
    planned('fixture:panel'),
    planned('fixture:panel-flagged', ['variance-parent:fixture:panel']),
  );

  it('says nothing at all when no subject declared anything', () => {
    // Absent rather than empty: a run with no variations must not read as a run
    // that measured variations and found none.
    expect(variationsOf({ plan: planOf(planned('fixture:a')), snapshots: new Map() })).toBe(
      undefined,
    );
  });

  it('says a named pair was inferred, in the sentence itself', () => {
    const records = variationsOf({
      plan: planOf(planned('fixture:panel'), planned('fixture:panel-dark')),
      snapshots: new Map([
        ['fixture:panel', snapshotOf('fixture:panel', 'buy')],
        ['fixture:panel-dark', snapshotOf('fixture:panel-dark', 'buy now')],
      ]),
    });

    expect(records?.[0]?.how).toBe('named');
    expect(records?.[0]?.because).toContain('Nothing declared this pair');
  });

  it('describes the difference between the two', () => {
    const records = variationsOf({
      plan,
      snapshots: new Map([
        ['fixture:panel', snapshotOf('fixture:panel', 'buy')],
        ['fixture:panel-flagged', snapshotOf('fixture:panel-flagged', 'buy now')],
      ]),
    });

    expect(records).toHaveLength(1);
    expect(records?.[0]).toMatchObject({
      subject: 'fixture:panel-flagged',
      parent: 'fixture:panel',
      identical: false,
    });
    expect(records?.[0]?.digest).toBeTypeOf('string');
    expect(records?.[0]?.because).toContain('fixture:panel');
  });

  it('reports a parent that failed to render rather than dropping the entry', () => {
    // A variation nobody measured is not a variation with nothing to say. The
    // same distinction `notObserved` holds for the run as a whole.
    const records = variationsOf({
      plan,
      snapshots: new Map([
        ['fixture:panel-flagged', snapshotOf('fixture:panel-flagged', 'buy now')],
      ]),
    });

    expect(records?.[0]).toMatchObject({ subject: 'fixture:panel-flagged' });
    expect(records?.[0]?.digest).toBe(undefined);
    expect(records?.[0]?.because).toContain('no semantic snapshot');
  });

  it('keeps an unresolvable declaration in the report', () => {
    const records = variationsOf({
      plan: planOf(planned('fixture:b', ['variance-parent:fixture:gone'])),
      snapshots: new Map(),
    });

    expect(records).toHaveLength(1);
    expect(records?.[0]?.parent).toBe(undefined);
    expect(records?.[0]?.because).toContain('was not compared');
  });
});
