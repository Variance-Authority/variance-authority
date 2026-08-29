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
