import { describe, expect, it } from 'vitest';
import { alsoCovering, coverageOf, summarizeCoverage, type SubjectCoverage } from './coverage.js';
import type { ComponentHash } from './component-hash.js';

/**
 * Overlap, tested for what it must refuse to conclude.
 *
 * The arithmetic here is trivial and is not the risk. The risk is a tool that
 * turns "this component appears elsewhere" into "this subject is redundant" and
 * deletes real coverage on the strength of a name matching, so most of what is
 * asserted below is the shape of the answer rather than its numbers.
 */

function hash(component: string, instances = 1): ComponentHash {
  return {
    component,
    instances,
    structure: `v1:${component}-s`,
    style: `v1:${component}-y`,
  };
}

function subject(id: string, ...components: readonly ComponentHash[]): SubjectCoverage {
  return { subject: id, components };
}

const SUITE: readonly SubjectCoverage[] = [
  subject('ds/button--primary', hash('Button')),
  subject('page/checkout', hash('Button', 3), hash('Stack'), hash('Total')),
  subject('page/cart', hash('Button', 2), hash('Stack')),
];

describe('what covers what', () => {
  it('counts subjects and instances separately', () => {
    // Three subjects contain `Button`, but six boundaries do. Reporting either
    // number as the other turns "this appears everywhere" into "this appears a
    // lot in one place", which are different arguments about the same suite.
    const button = coverageOf(SUITE).components.find((c) => c.component === 'Button');

    expect(button?.subjects).toEqual(['ds/button--primary', 'page/checkout', 'page/cart']);
    expect(button?.instances).toBe(6);
  });

  it('flags a component only one subject watches', () => {
    // The fact nobody has. A widely-covered component is visible in every
    // screenshot; a component watched by exactly one subject is invisible until
    // that subject is deleted and nothing notices the breakage.
    const coverage = coverageOf(SUITE);
    const sole = coverage.components.filter((c) => c.sole).map((c) => c.component);

    expect(sole).toEqual(['Total']);
  });

  it('orders components by how many subjects watch them', () => {
    expect(coverageOf(SUITE).components.map((c) => c.component)).toEqual([
      'Button',
      'Stack',
      'Total',
    ]);
  });

  it('does not let one subject inflate its own coverage by repeating a component', () => {
    // `coverageOf` is public and takes whatever it is handed. A caller that
    // passes two entries for one component would otherwise make a sole-covered
    // component look doubly watched — by itself.
    const coverage = coverageOf([subject('s', hash('Button', 2), hash('Button', 3))]);
    const button = coverage.components[0]!;

    expect(button.subjects).toEqual(['s']);
    expect(button.instances).toBe(5);
    expect(button.sole).toBe(true);
  });
});

describe('what a subject is worth', () => {
  it('names the components a subject alone covers', () => {
    const values = coverageOf(SUITE).subjects;

    expect(values.find((v) => v.subject === 'page/checkout')?.unique).toEqual(['Total']);
  });

  it('reports an empty unique list rather than calling a subject redundant', () => {
    // `ds/button--primary` contains only `Button`, which two page subjects also
    // contain. That makes its unique list empty and says nothing about whether a
    // button renders correctly on its own — which is the question it exists to
    // ask.
    const narrow = coverageOf(SUITE).subjects.find((v) => v.subject === 'ds/button--primary');

    expect(narrow?.unique).toEqual([]);
    expect(narrow?.components).toBe(1);
  });

  it('says who would still be watching if a subject were removed', () => {
    expect(alsoCovering(coverageOf(SUITE), 'Button', 'ds/button--primary')).toEqual([
      'page/checkout',
      'page/cart',
    ]);
    expect(alsoCovering(coverageOf(SUITE), 'Total', 'page/checkout')).toEqual([]);
  });
});

describe('the summary', () => {
  it('leads with sole coverage rather than with the widest components', () => {
    const text = summarizeCoverage(coverageOf(SUITE));
    expect(text.indexOf('exactly one subject')).toBeLessThan(text.indexOf('more than one subject'));
  });

  it('refuses to present an empty unique list as a deletion recommendation', () => {
    // The sentence this module exists to avoid producing is "delete these
    // subjects". If the wording ever drifts into a recommendation, this fails.
    const text = summarizeCoverage(coverageOf(SUITE));

    expect(text).toContain('cover no component alone');
    expect(text).toContain('not a recommendation to delete them');
  });

  it('never silently truncates', () => {
    const many = Array.from({ length: 14 }, (_, index) => subject(`s${index}`, hash(`C${index}`)));
    expect(summarizeCoverage(coverageOf(many), { limit: 3 })).toContain('+11 more not listed');
  });

  it('says so plainly when there is nothing to report', () => {
    expect(summarizeCoverage(coverageOf([]))).toBe('no components covered');
  });
});
