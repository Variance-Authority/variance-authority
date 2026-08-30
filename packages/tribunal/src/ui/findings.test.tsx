import type { FindingRecord } from '@variance-authority/report';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { SubjectView } from '../review.js';
import { Findings } from './findings.js';

/**
 * What the defect panel is allowed to say, and how many times.
 *
 * The list arrives one entry per element, because that is how a render is
 * inspected. A reviewer does not decide per element — they decide per defect —
 * so the counting done here is the difference between a column they read and a
 * column they scroll past.
 */

function subject(findings: SubjectView['findings']): SubjectView {
  return {
    subject: 'route/sneakers@390',
    verdict: 'changed',
    because: 'the rendered image differs from the baseline',
    changedPixels: 1530,
    regions: [],
    has: { before: true, after: true, diff: true },
    approvable: true,
    decision: null,
    ...(findings === undefined ? {} : { findings }),
  };
}

function nested(path: string): FindingRecord {
  return {
    rule: 'nested-interactive',
    what: 'a button is nested inside another control; only one of the two is reachable',
    path,
    where: 'link "Preview" → button "Preview"',
    component: 'Button',
    file: 'app/src/components/ui/button.tsx:41',
  };
}

describe('one defect is one row, however many elements carry it', () => {
  it('counts a repeated finding rather than printing it again', () => {
    // The listing page this came from draws twenty product cards, so the rule
    // fires twenty times on one line of one file. Twenty identical blocks is not
    // twenty decisions, and reading them is how a reviewer learns to scroll past
    // the panel entirely.
    const markup = renderToStaticMarkup(
      <Findings subject={subject([nested('0/1/0'), nested('0/1/1'), nested('0/1/2')])} />,
    );

    expect(markup.match(/va-finding-title/g)).toHaveLength(1);
    expect(markup).toContain('3 places');
  });

  it('says nothing about a count when the defect was found once', () => {
    const markup = renderToStaticMarkup(<Findings subject={subject([nested('0/1/0')])} />);

    expect(markup).not.toContain('va-times');
    expect(markup).not.toContain('1 places');
  });

  it('keeps two elements apart when the report described them differently', () => {
    // `where` is the phrase a reviewer navigates by. Two elements that read
    // differently are two things to go and look at, and folding them together
    // would hide the second behind the first one's name.
    const markup = renderToStaticMarkup(
      <Findings
        subject={subject([
          { ...nested('0/1/0'), where: 'link "Preview" → button "Preview"' },
          { ...nested('0/2/0'), where: 'link "Buy" → button "Buy"' },
        ])}
      />,
    );

    expect(markup.match(/va-finding-title/g)).toHaveLength(2);
    expect(markup).not.toContain('va-times');
  });

  it('does not fold two rules onto one row because they share a component', () => {
    const markup = renderToStaticMarkup(
      <Findings
        subject={subject([
          nested('0/1/0'),
          { ...nested('0/1/0'), rule: 'label-mismatch', what: 'the visible words disagree' },
        ])}
      />,
    );

    expect(markup.match(/va-finding-title/g)).toHaveLength(2);
  });
});

describe('inspected and clean is not the same as never looked at', () => {
  it('says a render nothing inspected has no list rather than an empty one', () => {
    const markup = renderToStaticMarkup(<Findings subject={subject(undefined)} />);

    expect(markup).toContain('was not inspected');
  });

  it('says so when a render was inspected and had nothing to report', () => {
    const markup = renderToStaticMarkup(<Findings subject={subject([])} />);

    expect(markup).toContain('nothing to report');
  });
});

describe('the panel says what it is a report of, and whose the defect is', () => {
  it('heads the accessibility rules with the word, rather than leaving it to the slugs', () => {
    const markup = renderToStaticMarkup(
      <Findings subject={subject([{ ...nested('0/1/0'), band: 'a11y' }])} />,
    );

    expect(markup).toContain('Accessibility');
  });

  it('does not file the two rules that are not accessibility under it', () => {
    // `untranslated` and `overflows-container` band `content` and `geometry`. A
    // panel with one heading over the whole list is wrong about them, which is why
    // the heading is per band rather than per panel.
    const markup = renderToStaticMarkup(
      <Findings
        subject={subject([
          { ...nested('0/1/0'), band: 'a11y' },
          {
            ...nested('0/2/0'),
            band: 'geometry',
            rule: 'overflows-container',
            what: 'the text is wider than the box holding it',
          },
        ])}
      />,
    );

    expect(markup).toContain('Accessibility');
    expect(markup).toContain('Layout');
  });

  it('says a defect arrived with this change when the baseline did not carry it', () => {
    const markup = renderToStaticMarkup(
      <Findings subject={subject([{ ...nested('0/1/0'), standing: false }])} />,
    );

    expect(markup).toContain('arrived with this change');
    expect(markup).toContain('va-finding-new');
  });

  it('says a defect was already there rather than putting it beside a new one', () => {
    const markup = renderToStaticMarkup(
      <Findings subject={subject([{ ...nested('0/1/0'), standing: true }])} />,
    );

    expect(markup).toContain('already in the baseline');
    expect(markup).not.toContain('va-finding-new');
  });

  it('refuses to date a finding the record left undated', () => {
    // The reading that has to survive every future edit to this file. A page that
    // guessed here would tell a reviewer they introduced every standing defect in
    // the suite, on the first run after an upgrade.
    const markup = renderToStaticMarkup(<Findings subject={subject([nested('0/1/0')])} />);

    expect(markup).toContain('none of them can be dated to this change');
    expect(markup).not.toContain('arrived with this change');
  });

  it('keeps an inherited defect and a new one apart when the same rule fired on both', () => {
    // Folding by rule and component would report the newly-added control under the
    // date of the one that was always broken.
    const markup = renderToStaticMarkup(
      <Findings
        subject={subject([
          { ...nested('0/1/0'), standing: true },
          { ...nested('0/2/0'), standing: false },
        ])}
      />,
    );

    expect(markup.match(/va-finding-title/g)).toHaveLength(2);
    expect(markup).toContain('already in the baseline');
    expect(markup).toContain('arrived with this change');
  });
});

describe('what this change brought comes first, and the rest is shut', () => {
  it('opens on the arrival and puts the total last, where it cannot lead', () => {
    // The panel used to open on `42 defects read from this render, with no
    // baseline compared`, then count the dates as equal clauses. That is a
    // reviewer's whole afternoon of somebody else's work, offered before their
    // own, on the one screen where they are trying to finish a change.
    const markup = renderToStaticMarkup(
      <Findings
        subject={subject([
          { ...nested('0/1/0'), standing: true },
          { ...nested('0/2/0'), standing: false },
        ])}
      />,
    );

    expect(markup).toMatch(/^<p class="va-findings-lead[^"]*">1 defect arrived with this change/);
    expect(markup.indexOf('read from this render')).toBeGreaterThan(
      markup.indexOf('already in the baseline'),
    );
  });

  it('folds the inherited defects behind their count rather than listing them', () => {
    const markup = renderToStaticMarkup(
      <Findings
        subject={subject([
          { ...nested('0/1/0'), standing: false },
          { ...nested('0/2/0'), standing: true },
          { ...nested('0/3/0'), standing: true },
        ])}
      />,
    );

    // Shut: `<details>` with no `open`, so three rows are one line until asked.
    expect(markup).toContain('<details class="va-findings-rest"><summary>2 already in the baseline');
    expect(markup).not.toContain('<details class="va-findings-rest" open');
  });

  it('leaves an undated list open, because there is no split to make', () => {
    // `arrived` is empty here too, and folding on that alone would hide every
    // defect in the render on the one run with no baseline to inherit from.
    const markup = renderToStaticMarkup(
      <Findings
        subject={subject([
          nested('0/1/0'),
          { ...nested('0/2/0'), rule: 'label-mismatch', what: 'the visible words disagree' },
        ])}
      />,
    );

    expect(markup).not.toContain('va-findings-rest');
    expect(markup.match(/va-finding-title/g)).toHaveLength(2);
  });

  it('drops the date from a row whose whole list already says it', () => {
    const markup = renderToStaticMarkup(
      <Findings subject={subject([{ ...nested('0/1/0'), standing: false }])} />,
    );

    expect(markup).not.toContain('va-age');
    expect(markup).toContain('va-finding-new');
  });
});
