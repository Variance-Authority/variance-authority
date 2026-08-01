// @vitest-environment jsdom

/**
 * Corpus integrity, not normalizer quality.
 *
 * There is no normalizer yet, so nothing here checks a hash. What it checks is
 * that the corpus is *capable* of being evidence: every declared case renders,
 * every perturbation actually perturbs, and the sheets declared inapplicable are
 * genuinely inapplicable. Each of those is a way the corpus could be quietly
 * wrong in a direction that reads as a normalizer bug later — the most expensive
 * kind of defect a measurement instrument can have.
 */

import { afterEach, describe, expect, it } from 'vitest';
import type { ProfileId } from '@variance-authority/core';
import { CONTESTED_CORPUS, CORPUS, SETTLED_CORPUS, casesFor, expectationFor } from './corpus.js';

const PROFILE_IDS: readonly ProfileId[] = ['jsdom', 'chromium'];
import { noiseSheet } from './cruft/irrelevant-css.js';
import type { NoiseSheetId } from './cruft/irrelevant-css.js';
import { renderCase } from './render.js';
import { SUBJECTS } from './subjects.js';
import { VARIANTS } from './variants.js';
import type { VariantId } from './variants.js';

function freshContainer(): HTMLElement {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

afterEach(() => {
  document.body.replaceChildren();
  document.head.replaceChildren();
});

describe('CORPUS manifest', () => {
  it('has unique case ids', () => {
    const ids = CORPUS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('names only real subjects and variants', () => {
    for (const c of CORPUS) {
      expect(SUBJECTS, c.id).toHaveProperty(c.subject);
      expect(VARIANTS, `${c.id} base`).toHaveProperty(c.baseVariant);
      expect(VARIANTS, `${c.id} perturbed`).toHaveProperty(c.perturbedVariant);
    }
  });

  it('declares a band exactly when the hash is expected to change', () => {
    for (const c of CORPUS) {
      // A `hash-changed` case with no band cannot be scored: the band is what the
      // policy layer acts on, so an unbanded expectation asserts nothing useful.
      // A `hash-stable` case with a band is a contradiction.
      expect(c.band !== undefined, c.id).toBe(c.expect === 'hash-changed');
    }
  });

  it('gives every case a rationale substantial enough to argue with', () => {
    for (const c of CORPUS) {
      expect(c.rationale.length, c.id).toBeGreaterThan(120);
      expect(c.spec.length, c.id).toBeGreaterThan(4);
    }
  });

  it('keeps both expected outcomes populated', () => {
    // A corpus of only `hash-stable` cases is passed by a normalizer that returns
    // a constant; a corpus of only `hash-changed` cases is passed by one that
    // hashes the raw bytes. Neither half is evidence without the other.
    expect(casesFor('hash-stable').length).toBeGreaterThan(10);
    expect(casesFor('hash-changed').length).toBeGreaterThan(10);
  });
});

describe('every case renders both variants', () => {
  for (const c of CORPUS) {
    it(`${c.id}`, () => {
      for (const variant of [c.baseVariant, c.perturbedVariant]) {
        const container = freshContainer();
        const rendered = renderCase(container, c.subject, variant);
        expect(container.childElementCount, `${c.id} / ${variant}`).toBeGreaterThan(0);
        rendered.unmount();
        container.remove();
      }
    });
  }
});

describe('perturbations actually perturb', () => {
  function html(subject: Parameters<typeof renderCase>[1], variant: VariantId): string {
    const container = freshContainer();
    const rendered = renderCase(container, subject, variant);
    const out = container.innerHTML;
    rendered.unmount();
    container.remove();
    return out;
  }

  it('renumbers every generated id under id-shift', () => {
    // Not "the markup differs" — the markup differs between any two renders,
    // because React's id counter is process-global and never resets. The claim is
    // that the *shape* is preserved: same tags, same references, different values.
    const before = html('field', 'base');
    const after = html('field', 'id-shift');
    expect(after).not.toBe(before);
    // Two id syntaxes, because React changed it: `:r0:` through 18.x, `_r_0_`
    // in 19.x. Worth noticing — ADR-0003 names the old spelling, and a normalizer
    // that recognised generated ids by *shape* rather than by aliasing every id it
    // finds would have silently stopped working on a minor React upgrade.
    const strip = (s: string) => s.replace(/:r[0-9a-z]+:|_r_[0-9a-z]+_/g, 'ID');
    expect(strip(after)).toBe(strip(before));
  });

  it('renames every generated class under class-churn without changing declarations', () => {
    const container = freshContainer();
    const a = renderCase(container, 'button', 'base');
    const aRules = [...a.runtime.rules()];
    const aClasses = container.querySelector('button')?.className ?? '';
    a.unmount();

    const b = renderCase(container, 'button', 'class-churn');
    const bRules = [...b.runtime.rules()];
    const bClasses = container.querySelector('button')?.className ?? '';
    b.unmount();
    container.remove();

    expect(aClasses).not.toBe(bClasses);
    expect(bRules.length).toBe(aRules.length);
    // Strip the names; what is left is the declarations, which must be identical.
    const decls = (rules: readonly string[]) => rules.map((r) => r.slice(r.indexOf('{')));
    expect(decls(bRules)).toEqual(decls(aRules));
  });

  it('grows the irrelevant CSS between base and css-accretion', () => {
    const size = (variant: VariantId) => {
      const container = freshContainer();
      const rendered = renderCase(container, 'card', variant);
      const bytes = Array.from(document.head.querySelectorAll('style')).reduce(
        (n, el) => n + (el.textContent?.length ?? 0),
        0,
      );
      rendered.unmount();
      container.remove();
      return bytes;
    };
    expect(size('css-accretion')).toBeGreaterThan(size('base') * 5);
  });

  it('inserts wrappers without changing the leaves', () => {
    const before = html('wrappers', 'base');
    const after = html('wrappers', 'wrapper-block');
    expect(after).not.toBe(before);
    expect(after.match(/ks-wrappers__leaf/g)?.length).toBe(
      before.match(/ks-wrappers__leaf/g)?.length,
    );
  });

  it('emits the same declarations for both spellings, differently spelled', () => {
    const container = freshContainer();
    const shorthand = renderCase(container, 'card', 'base');
    const shorthandRules = shorthand.runtime.rules().join('');
    shorthand.unmount();
    const longhand = renderCase(container, 'card', 'spelling-longhand');
    const longhandRules = longhand.runtime.rules().join('');
    longhand.unmount();
    container.remove();

    expect(shorthandRules).toContain('padding:');
    expect(shorthandRules).not.toContain('padding-top:');
    expect(longhandRules).toContain('padding-top:');
    expect(longhandRules).toContain('border-bottom-left-radius:');
  });

  it('portals the dialog panel outside the subject container', () => {
    // The fact this test can be written at all is the contested case: the panel is
    // reachable from the subject only through the fiber tree.
    const container = freshContainer();
    const rendered = renderCase(container, 'dialog', 'dialog-open');
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(rendered.portalHost.querySelector('[role="dialog"]')).not.toBeNull();
    rendered.unmount();
    container.remove();
  });
});

describe('noise sheets are inapplicable by construction', () => {
  // If a sheet declared irrelevant did match the subject, the `hash-stable` cases
  // built on it would be false — and would fail in a way indistinguishable from a
  // normalizer defect. Checking it here means a corpus bug is reported as a corpus
  // bug.
  const INAPPLICABLE: readonly NoiseSheetId[] = [
    'chrome',
    'dead-utilities-small',
    'dead-utilities-large',
    'stale-stories-gen1',
    'stale-stories-gen4',
  ];

  function selectorsOf(css: string): readonly string[] {
    return Array.from(css.matchAll(/([^{}@]+)\{[^{}]*\}/g))
      .map((m) => (m[1] ?? '').trim())
      .filter((s) => s.length > 0);
  }

  for (const subject of Object.keys(SUBJECTS) as (keyof typeof SUBJECTS)[]) {
    it(`${subject} matches none of them`, () => {
      const container = freshContainer();
      const rendered = renderCase(container, subject, 'css-accretion');
      const roots = [container, rendered.portalHost];
      for (const sheetId of INAPPLICABLE) {
        for (const selector of selectorsOf(noiseSheet(sheetId))) {
          for (const root of roots) {
            expect(root.querySelectorAll(selector).length, `${sheetId} :: ${selector}`).toBe(0);
          }
        }
      }
      rendered.unmount();
      container.remove();
    });
  }
});

describe('cascade fixtures behave as the corpus claims', () => {
  // The losing/winning pair is only evidence if the rules really do lose and win.
  // Getting the specificity wrong by one class would silently invert two cases, and
  // the inversion would be invisible in the manifest, which states intent rather
  // than fact. Here it is fact.
  function cardBodyColor(variant: VariantId): string {
    const container = freshContainer();
    const rendered = renderCase(container, 'card', variant);
    const body = container.querySelector('.ks-card__body');
    const color = body === null ? '' : getComputedStyle(body).color;
    rendered.unmount();
    container.remove();
    return color;
  }

  it('lets the losing rules lose', () => {
    expect(cardBodyColor('css-losing-rules')).toBe(cardBodyColor('base'));
  });

  it('lets the winning rule win', () => {
    expect(cardBodyColor('css-winning-rules')).not.toBe(cardBodyColor('base'));
    expect(cardBodyColor('css-winning-rules')).toBe('rgb(179, 38, 30)');
  });

  it('keeps the false conditional out of the cascade', () => {
    expect(cardBodyColor('css-unmatched-media')).toBe(cardBodyColor('base'));
  });

  it('documents that JSDOM cannot see the true conditional through getComputedStyle', () => {
    // Deliberately asserting the *limitation*, not the ground truth. JSDOM does not
    // evaluate `@media` while resolving styles, so the matched-media rule is invisible
    // here even though it applies in a real engine. That does not make the corpus case
    // wrong: ADR-0003 step 2 has the collector flatten conditions against the declared
    // environment by reading `CSSMediaRule.conditionText` itself, which is available in
    // JSDOM's CSSOM. It does mean a JSDOM collector built on `getComputedStyle` alone
    // will report `css-matched-media/card` as stable and be wrong. If JSDOM ever gains
    // media evaluation this test fails, which is the notification we want.
    expect(cardBodyColor('css-matched-media')).toBe(cardBodyColor('base'));
  });

  it('documents that JSDOM drops shorthands whose value is a var()', () => {
    // `padding: var(--x) var(--x)` is discarded by JSDOM's declaration parser while
    // the four longhands survive as literal text — so the two spellings the corpus
    // calls equivalent are *not* equivalent through `getComputedStyle`. They are
    // equivalent in a real engine, so `spelling/card` stands as declared; the
    // consequence is for the collector, which must expand shorthands from the
    // declared rule text rather than trusting JSDOM to have done it.
    const radius = (variant: VariantId): string => {
      const container = freshContainer();
      const rendered = renderCase(container, 'card', variant);
      const shell = container.querySelector('.ks-card');
      const value = shell === null ? '' : getComputedStyle(shell).borderTopLeftRadius;
      rendered.unmount();
      container.remove();
      return value;
    };
    expect(radius('base')).toBe('0');
    expect(radius('spelling-longhand')).toContain('var(');
  });
});

describe('contested cases', () => {
  it('are flagged loudly rather than silently decided', () => {
    // Not a threshold to satisfy. The list is printed so that anyone running the
    // suite sees which ground truths are still arguments, and the assertion only
    // guards against someone deleting the flag instead of resolving the question.
    expect(CONTESTED_CORPUS.length).toBeGreaterThan(0);
    for (const c of CONTESTED_CORPUS) {
      expect(c.contested?.length ?? 0, c.id).toBeGreaterThan(120);
    }
  });
});

describe('per-profile clauses (ADR-0008)', () => {
  it('never sit on a contested case', () => {
    // `contested` outranks the profile clause, so a case carrying both would have
    // a clause that can never be read — an answer to a question still open.
    for (const c of CORPUS) {
      if (c.byProfile === undefined) continue;
      expect(c.contested, `${c.id} declares a profile clause while contested`).toBeUndefined();
    }
  });

  it('state an argument rather than a label', () => {
    for (const c of CORPUS) {
      for (const [profile, clause] of Object.entries(c.byProfile ?? {})) {
        const text = 'undecidable' in clause ? clause.undecidable : clause.because;
        expect(text.length, `${c.id}/${profile}`).toBeGreaterThan(120);
      }
    }
  });

  it('leave every case scorable under at least one profile', () => {
    // A case no profile can decide is not a per-profile question, it is a
    // contested one, and it belongs in `contested` where a harness reports it.
    for (const c of SETTLED_CORPUS) {
      const anywhere = PROFILE_IDS.some((p) => expectationFor(c, p).kind === 'scorable');
      expect(anywhere, `${c.id} is undecidable everywhere but not flagged contested`).toBe(true);
    }
  });
});
