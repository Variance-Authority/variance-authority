// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { IgnoreUsage, SensitivityUsage } from '@variance-authority/report';
import type { Declarations, SubjectView } from '../review-types.js';
import { DeclarationsPanel } from './declarations.js';
import { Settled, needsReview } from './settled.js';

/**
 * The audit, held to the two ways a page can lie about one.
 *
 * It can call a rule dead on a run that measured nothing it covered, which sends
 * an operator to delete the ignore that was protecting them. And it can answer a
 * question nobody recorded — an empty table where a ledger should be, a blank
 * cell where the bands were not kept — which is the shape *audited, and clean*
 * takes when nothing was audited at all.
 */

function ignore(overrides: Partial<IgnoreUsage> = {}): IgnoreUsage {
  return {
    rule: 'clock',
    reason: 'the header clock ticks',
    pixels: 0,
    subjects: 4,
    comparedIn: 4,
    inertIn: 4,
    unresolved: false,
    unwornTags: [],
    expired: false,
    ...overrides,
  };
}

function sensitivity(overrides: Partial<SensitivityUsage> = {}): SensitivityUsage {
  return {
    rule: 'marketing-copy',
    reason: 'copy is edited weekly',
    level: 'layout',
    scoped: 9,
    absorbed: ['route/home'],
    bands: ['text'],
    unscoped: false,
    ...overrides,
  };
}

function green(
  subject: string,
  verdict: SubjectView['verdict'],
  overrides: Partial<SubjectView> = {},
): SubjectView {
  return {
    subject,
    verdict,
    because: 'the document digests to what the baseline was painted from',
    changedPixels: 0,
    regions: [],
    has: { before: true, after: true, diff: false },
    approvable: false,
    decision: null,
    ...overrides,
  };
}

function show(declarations: Partial<Declarations>): string {
  return renderToStaticMarkup(
    <DeclarationsPanel
      declarations={{ ignores: null, sensitivities: null, ...declarations }}
    />,
  );
}

function ignores(rules: readonly IgnoreUsage[], overrides = {}): string {
  return show({
    ignores: { rules, dead: [], fullyIgnored: [], totalPixels: 0, vocabulary: ['marketing'], ...overrides },
  });
}

describe('a rule is marked by what it did, in the words every other surface uses', () => {
  it('keeps *nothing was compared* apart from *nothing was absorbed*', () => {
    // The pair this whole ledger exists for. An ignore over four subjects none of
    // which was compared is a rule this run knows nothing about; the same rule
    // over four that *were* compared is a rule to delete. A table that spelt both
    // `dead` tells an operator to act on the run that proves least about it.
    expect(ignores([ignore({ comparedIn: 0 })])).toContain('>untested<');
    expect(ignores([ignore()])).toContain('>dead<');
  });

  it('asks for action on the spent rule and not on the untested one', () => {
    expect(ignores([ignore()])).toContain('va-tag va-warn');
    expect(ignores([ignore({ comparedIn: 0 })])).not.toContain('va-tag va-warn');
  });

  it('prints both counts, because one of them is a denominator', () => {
    const markup = ignores([ignore({ subjects: 9, comparedIn: 3 })]);

    expect(markup).toContain('9 <em>subj</em>');
    expect(markup).toContain('3 compared');
  });

  it('names the tags that are worn when a rule names one that is not', () => {
    const markup = ignores([ignore({ unwornTags: ['marketting'] })]);

    expect(markup).toContain('>unworn<');
    expect(markup).toContain('Tags worn in this run: marketing.');
  });

  it('counts the rules that absorbed, not the rules somebody wrote', () => {
    // The footer sits directly under the table, and the table says one of these
    // two resolved nowhere. *647 pixels absorbed by 2 rules* over a row marked
    // `unresolved` is the footer arguing with the audit it is the footer of.
    const markup = ignores(
      [ignore({ pixels: 647 }), ignore({ rule: 'promo', unresolved: true })],
      { totalPixels: 647 },
    );

    expect(markup).toContain('647 pixel(s) absorbed by 1 of 2 rule(s)');
  });

  it('does not invite a reader to look for a rule that is not missing', () => {
    const markup = ignores([ignore({ pixels: 400 }), ignore({ rule: 'promo', pixels: 247 })], {
      totalPixels: 647,
    });

    expect(markup).toContain('647 pixel(s) absorbed by 2 rule(s)');
    expect(markup).not.toContain('2 of 2');
  });

  it('says no tag was checked rather than leaving the vocabulary unmentioned', () => {
    // With no vocabulary the unworn-tag check did not run at all. A footer that
    // said nothing would read as every tag having been checked and found.
    expect(ignores([ignore()], { vocabulary: [] })).toContain(
      'no subject in this run declared a tag, so no tag was checked',
    );
  });
});

describe('a sensitivity is stated in the positive form somebody wrote it in', () => {
  it('carries the claim and the outcome, not only the outcome', () => {
    const markup = show({ sensitivities: { rules: [sensitivity()], totalAbsorbed: 1 } });

    expect(markup).toContain('asserts on layout');
    expect(markup).toContain('1 <em>of</em> 9');
    expect(markup).toContain('1 subject(s) not asserted on in full, by 1 rule(s)');
  });

  it('does not put a rule that relaxed nothing behind the count of what was relaxed', () => {
    const markup = show({
      sensitivities: { rules: [sensitivity({ absorbed: [], bands: [] })], totalAbsorbed: 0 },
    });

    expect(markup).toContain('0 subject(s) not asserted on in full, by 0 of 1 rule(s)');
  });

  it('says a rule matched nothing this run planned rather than calling it spent', () => {
    const markup = show({
      sensitivities: { rules: [sensitivity({ scoped: 0, absorbed: [], unscoped: true })], totalAbsorbed: 0 },
    });

    expect(markup).toContain('>unscoped<');
    expect(markup).toContain('nowhere');
  });

  it('says the bands were not recorded rather than drawing none of them', () => {
    // A rule that decided a verdict with no band kept is a report that lost the
    // detail, not a rule that absorbed nothing — and an empty cell says the second.
    expect(show({ sensitivities: { rules: [sensitivity({ bands: [] })], totalAbsorbed: 1 } })).toContain(
      'bands not recorded',
    );
    expect(show({ sensitivities: { rules: [sensitivity()], totalAbsorbed: 1 } })).not.toContain(
      'bands not recorded',
    );
  });
});

describe('a build that carried no ledger says so', () => {
  it('refuses to render silence where an audit would go', () => {
    const markup = show({});

    expect(markup).toContain('carried no declaration ledger');
    // Both readings, because on this format they are one absence — and neither of
    // them is the one a blank card would be read as.
    expect(markup).toContain('named no ignores');
    expect(markup).toContain('recorded before this service kept them');
  });
});

describe('the rail and the report agree on what is green', () => {
  it('keeps both green verdicts off the queue', () => {
    // The tribunal's own filter was `!== unchanged`, which put every subject an
    // ignore had already decided into the list of things awaiting a decision —
    // under a pill saying the build was settled.
    expect(['changed', 'new', 'incomparable', 'unstable'].map(needsReview)).toEqual([
      true,
      true,
      true,
      true,
    ]);
    expect(['unchanged', 'ignored'].map(needsReview)).toEqual([false, false]);
  });

  it('names the settled subjects rather than only counting them', () => {
    const markup = renderToStaticMarkup(
      <Settled
        subjects={[green('story:footer', 'unchanged'), green('route/cart', 'ignored')]}
        ignores={null}
      />,
    );

    expect(markup).toContain('story:footer');
    expect(markup).toContain('route/cart');
    expect(markup).toContain('1 subject green because a rule absorbed the difference');
  });

  it('says which rule absorbed them is not recorded rather than implying nothing did', () => {
    const absorbed = [green('route/cart', 'ignored')];

    expect(renderToStaticMarkup(<Settled subjects={absorbed} ignores={null} />)).toContain(
      'not recorded here',
    );
    expect(
      renderToStaticMarkup(
        <Settled
          subjects={absorbed}
          ignores={{ rules: [ignore()], dead: [], fullyIgnored: ['route/cart'], totalPixels: 0, vocabulary: [] }}
        />,
      ),
    ).not.toContain('not recorded here');
  });
});

describe('a green subject says which kind of green, in the report’s own words', () => {
  it('names the rule that absorbed it, and what it took here', () => {
    // The number is the one the run measured in *this* subject. The ledger's
    // total is a different figure and answers a different question; a page that
    // printed it beside a name would be attributing a run to a subject.
    const markup = renderToStaticMarkup(
      <Settled
        subjects={[
          green('story:main-nav--empty', 'ignored', {
            ignored: { pixels: 325, boxes: 1, inert: 0, byRule: { 'nav-cart-badge': 325 } },
          }),
        ]}
        ignores={null}
      />,
    );

    expect(markup).toContain('nav-cart-badge');
    expect(markup).toContain('325 px');
  });

  it('states the level a relaxed subject was asserted on, and the bands that moved', () => {
    const markup = renderToStaticMarkup(
      <Settled
        subjects={[
          green('route/cart@1280', 'ignored', {
            relaxed: { rule: 'routes-assemble', level: 'layout', bands: ['token', 'text'] },
          }),
        ]}
        ignores={null}
      />,
    );

    expect(markup).toContain('asserted on layout');
    expect(markup).toContain('token, text');
  });

  it('says a rule caught nothing here rather than leaving an unchanged subject bare', () => {
    // Green *and* watched. One run of this is ordinary; it is the same row on
    // run after run that turns a mask into the thing the ledger below is for.
    const markup = renderToStaticMarkup(
      <Settled
        subjects={[
          green('story:footer', 'unchanged', {
            ignored: { pixels: 0, boxes: 2, inert: 2, byRule: { 'promo-countdown': 0 } },
          }),
        ]}
        ignores={null}
      />,
    );

    expect(markup).toContain('masked in 2 places');
  });

  it('says the build does not record the rule rather than printing nothing', () => {
    // A build pushed before the store kept the per-subject block. The verdict
    // says a declaration absorbed it; a blank beside it reads as a difference
    // too small to have a rule.
    const markup = renderToStaticMarkup(
      <Settled subjects={[green('route/cart', 'ignored')]} ignores={null} />,
    );

    expect(markup).toContain('does not record which rule absorbed it');
  });
});
