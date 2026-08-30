import { describe, expect, it } from 'vitest';
import type { FindingRecord } from './finding-record.js';
import { AGE_WORDS, ageOf, bandTitle, byBand, findingTotals } from './findings.js';

/**
 * The two sentences a defect panel has to get right, held to the case where
 * getting them wrong is invisible.
 *
 * Both failures here are failures of a *default*. A band nothing recorded filed
 * under the first band reads as a fact; a date nothing recorded printed as `new`
 * reads as an accusation. Neither shows up as a crash, a blank, or a wrong
 * number — they show up as a page that is confidently wrong to the one reader
 * least able to check it.
 */

function finding(overrides: Partial<FindingRecord> = {}): FindingRecord {
  return {
    rule: 'control-without-name',
    band: 'a11y',
    what: 'a control has no accessible name, so nothing can announce or address it',
    path: '0/1/0',
    ...overrides,
  };
}

describe('the panel says what kind of report it is', () => {
  it('names the band in the words a reviewer reads, not the slug', () => {
    expect(bandTitle('a11y')).toBe('Accessibility');
    expect(bandTitle('geometry')).toBe('Layout');
  });

  it('says unclassified rather than filing an unbanded finding under the first band', () => {
    // A report written before the band was carried through the flattener. Every
    // other choice here is a claim about a row nothing classified — and the
    // cheapest wrong one, `a11y`, would put the two rules that are not
    // accessibility under a heading that says they are.
    expect(bandTitle(undefined)).toBe('Unclassified');
  });

  it('passes an unknown band through rather than swallowing it', () => {
    // A record written by a newer run than this reader. The slug is worse than a
    // word and better than a lie.
    expect(bandTitle('sonar')).toBe('sonar');
  });

  it('leads with the loudest band rather than sorting the headings alphabetically', () => {
    const mixed = [
      finding({ rule: 'untranslated', band: 'content' }),
      finding({ rule: 'overflows-container', band: 'geometry' }),
      finding(),
    ];

    expect(byBand(mixed).map((group) => group.title)).toEqual([
      'Accessibility',
      'Layout',
      'Content',
    ]);
  });

  it('does not head a band nothing fired', () => {
    // A heading over an empty list reads as a category that was checked and found
    // clean. These rules do not check bands; they check rules, and the bands are
    // where the rules landed.
    expect(byBand([finding()]).map((group) => group.title)).toEqual(['Accessibility']);
  });

  it('puts the unclassified rows last, after every band that has a name', () => {
    const groups = byBand([finding({ band: undefined }), finding()]);

    expect(groups.map((group) => group.title)).toEqual(['Accessibility', 'Unclassified']);
  });
});

describe('a defect nothing dated is not a defect somebody introduced', () => {
  it('reads a recorded true as inherited and a recorded false as arrived', () => {
    expect(ageOf(finding({ standing: true }))).toBe('standing');
    expect(ageOf(finding({ standing: false }))).toBe('new');
  });

  it('reads an absent standing as undated, which is neither', () => {
    // The bug this whole axis exists to avoid. Absent means nothing recorded what
    // the baseline contained — no baseline yet, or one written before findings
    // were kept beside it — and reading it as `false` announces every inherited
    // defect in a suite as freshly introduced on the first run after an upgrade.
    expect(ageOf(finding())).toBe('undated');
    expect(AGE_WORDS[ageOf(finding())]).not.toContain('arrived');
  });

  it('says out loud that nothing can be dated rather than printing zero of each', () => {
    const line = findingTotals([finding(), finding({ rule: 'nested-interactive' })]);

    expect(line).toContain('2 defects read from this render');
    expect(line).toContain('none of them can be dated');
    expect(line).not.toContain('arrived with this change');
  });

  it('counts the two answers separately when the baseline supplied them', () => {
    const line = findingTotals([
      finding({ standing: false }),
      finding({ rule: 'nested-interactive', standing: true }),
      finding({ rule: 'label-mismatch', standing: true }),
    ]);

    expect(line).toContain('1 arrived with this change');
    expect(line).toContain('2 already in the baseline');
    expect(line).not.toContain('cannot be dated');
  });

  it('accounts for a partly dated list rather than rounding it to one answer', () => {
    // Reachable when a rule fires on a subject the baseline carried marks for and
    // on one it did not. Silence about the third row would make the two counts
    // read as the whole list.
    const line = findingTotals([finding({ standing: false }), finding({ rule: 'contrast' })]);

    expect(line).toContain('1 arrived with this change');
    expect(line).toContain('1 the baseline does not account for');
  });

  it('leads with the method, because it is why nothing here moved the verdict', () => {
    expect(findingTotals([finding()])).toMatch(/^1 defect read from this render, with no baseline/);
  });
});
