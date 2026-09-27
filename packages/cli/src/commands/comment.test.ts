import { describe, expect, it } from 'vitest';
import type { RenderIdentity } from '@variance-authority/core/format';
import type { ObservationRecord } from '@variance-authority/report';
import { DEFAULT_LIMITS as PUBLIC_DEFAULT_LIMITS } from '@variance-authority/cli';
import { COMMENT_MARKER, renderComment } from './comment.js';
import { EXIT_CLEAN, EXIT_REVIEW, exitFor } from '../exit.js';
import type { CliRunReport } from './run.js';

const IDENTITY: RenderIdentity = {
  renderer: 'playwright-chromium',
  engine: 'chromium@131',
  platform: 'linux/x64',
  deviceScaleFactor: 1,
  fonts: ['Inter/400/normal/sha256-abc'],
};

function reportOf(
  observations: readonly ObservationRecord[],
  extra: Partial<CliRunReport> = {},
): CliRunReport {
  return {
    runVersion: 1,
    at: '2026-08-01T10:00:00.000Z',
    identity: IDENTITY,
    retention: 'durable',
    observations,
    notObserved: [],
    ...extra,
  };
}

/** One token edit reaching `subjects` stories, each with collateral beside it. */
function tokenChange(subjects: number): CliRunReport {
  return reportOf(
    Array.from({ length: subjects }, (_, index) => ({
      subject: `story:s${index}`,
      verdict: 'changed' as const,
      because: '1530 pixel(s) differ across 3 region(s)',
      changedPixels: 1530,
      regions: [
        {
          x: 4,
          y: 4,
          width: 16,
          height: 16,
          pixels: 86,
          component: 'Toggle',
          where: 'main → list item 2 of 3',
          file: 'src/ds/components.tsx:107',
          cause: true,
        },
        {
          x: 0,
          y: 40,
          width: 300,
          height: 20,
          pixels: 933,
          component: 'Text',
          where: 'main → list item 2 of 3',
          file: 'src/ds/text.tsx:12',
          cause: false,
        },
        {
          x: 0,
          y: 80,
          width: 300,
          height: 40,
          pixels: 511,
          component: 'Stack',
          file: 'src/ds/stack.tsx:4',
          cause: false,
        },
      ],
    })),
  );
}

describe('renderComment', () => {
  it('publishes the default bounds used when no limits are supplied', () => {
    expect(PUBLIC_DEFAULT_LIMITS).toEqual({
      causes: 20,
      subjects: 3,
      notObserved: 20,
      drift: 10,
      characters: 65_536,
    });
  });

  it('puts the cause above the collateral count, so the review starts at the edit', () => {
    // Area measures displacement, not cause: `Text` and `Stack` moved far more
    // pixels than `Toggle`, which is the edit. A body that led with them would
    // reproduce the exact defect `rankRegions` exists to fix, one level up.
    const body = renderComment({ report: tokenChange(3) });

    expect(body.indexOf('Toggle')).toBeGreaterThan(-1);
    expect(body.indexOf('Toggle')).toBeLessThan(body.indexOf('Collateral:'));
    expect(body.indexOf('### Causes')).toBeLessThan(body.indexOf('Collateral:'));
  });

  it('renders one review item with a count for a token change reaching 300 subjects', () => {
    // The failure this whole format exists to prevent: 300 lines saying the same
    // thing, which nobody reads, instead of one line with the number 300 on it.
    const body = renderComment({ report: tokenChange(300) });

    expect(body).toContain('the cause in 300 subject(s)');
    // Three subject ids are named as examples and the rest are counted, so the
    // body must stay short enough to read — not grow with the suite.
    expect(body).toContain('and 297 other subject(s) not listed');
    expect(body).not.toContain('story:s299');
    expect(body.split('\n').length).toBeLessThan(30);
  });

  it('counts collateral regions instead of listing any of them', () => {
    // `Text` and `Stack` moved because `Toggle` did. Naming them 300 times each
    // would bury the one line a reviewer can act on.
    const body = renderComment({ report: tokenChange(300) });

    expect(body).toContain('600 further region(s)');
    expect(body).toContain('in 2 component(s)');
    expect(body).not.toContain('Stack');
    expect(body).not.toContain('Text');
  });

  it('does not publish a node path as the cause a reviewer should open', () => {
    // A page this project did not write in React has no component names, and the
    // fallback was `path`. The comment then led with **`0/1`** in code voice \u2014 a
    // child index presented as the thing to grep for \u2014 and counted the
    // path-keyed groups beside it as "1 component(s)" over a page with none.
    const body = renderComment({
      report: reportOf([
        {
          subject: 'site/about',
          verdict: 'changed',
          because: '1627 pixel(s) differ across 2 region(s)',
          changedPixels: 1627,
          regions: [
            { x: 32, y: 123, width: 478, height: 114, pixels: 1124, path: '0/1', cause: false },
            { x: 50, y: 162, width: 111, height: 24, pixels: 503, path: '0/2', cause: false },
          ],
        },
      ]),
    });

    expect(body).not.toContain('`0/1`');
    expect(body).toContain('a region at 32,123 (478\u00d7114)');
    expect(body).toContain('1 further region (503px) across 1 subject');
    expect(body).not.toContain('component(s)');
  });

  it('names the component, the file, and the landmark for each cause', () => {
    // A cause a reviewer cannot open is a cause they will not act on. The
    // landmark is the part a pixel differ cannot produce at all.
    const body = renderComment({ report: tokenChange(1) });

    expect(body).toContain('`Toggle`');
    expect(body).toContain('`src/ds/components.tsx:107`');
    expect(body).toContain('in `main → list item 2 of 3`');
  });

  it('shows the count and the leading cause first, and folds the docket whole', () => {
    // A notification is opened on a phone. The first screen answers what moved
    // and why; every cause and what painted the images stay in the body, one
    // element away, because nothing here is capped silently.
    const body = renderComment({ report: tokenChange(1) });
    const fold = body.indexOf('<details>');

    expect(body.indexOf('Cause: **`Toggle`** at `src/ds/components.tsx:107`')).toBeLessThan(fold);
    expect(body.indexOf('### Causes')).toBeGreaterThan(fold);
    expect(body.indexOf('playwright-chromium')).toBeGreaterThan(fold);
    expect(body.trimEnd().endsWith('</details>')).toBe(true);
  });

  it('carries a stable marker so the poster updates its own comment', () => {
    // Without it the poster cannot tell its previous comment from anyone else's,
    // and a new comment per run buries the current state under a history nobody
    // reads. The marker is first, so a truncated body still carries it.
    const body = renderComment({ report: tokenChange(1) });

    expect(body.startsWith(COMMENT_MARKER)).toBe(true);
    expect(COMMENT_MARKER).toMatch(/^<!--.*-->$/);
  });

  it.todo(
    '`.github/actions/variance/post-comment.mjs` finds the comment carrying `COMMENT_MARKER` and rewrites that one instead of adding a second — needs the search and the two writes exported, because today the whole script runs at module scope against `GITHUB_API_URL`, so importing it is running it (spec 0016)',
  );

  it('produces no body at all for a run where nothing needs review', () => {
    // A bot that comments on every green pull request trains the team to filter
    // it out, and the filter does not spare the red ones.
    const clean = reportOf([
      {
        subject: 'story:card',
        verdict: 'unchanged',
        because: 'no pixels differ',
        changedPixels: 0,
        regions: [],
      },
    ]);

    expect(exitFor(clean)).toBe(EXIT_CLEAN);
    expect(renderComment({ report: clean })).toBe('');
  });

  it('is non-empty exactly when the exit code says review', () => {
    // The comment's existence and the check's colour are one question. A red
    // check with no comment sends the reviewer to the log; a comment with a green
    // check teaches them the comment is advisory.
    const noObservations = reportOf([], {
      notObserved: [
        { subject: 'story:chart', kind: 'failed', because: 'the story never became ready' },
      ],
    });

    expect(exitFor(noObservations)).toBe(EXIT_REVIEW);
    expect(renderComment({ report: noObservations })).not.toBe('');
    expect(renderComment({ report: noObservations })).toContain('story:chart');
  });

  it('says coverage is unknown when the report never stated what it skipped', () => {
    // Absent is not empty. A clean-looking body over a report that never counted
    // its subjects is the tool inventing the reassurance.
    const silent: CliRunReport = reportOf([
      {
        subject: 'story:card',
        verdict: 'unchanged',
        because: 'no pixels differ',
        changedPixels: 0,
        regions: [],
      },
    ]);
    const { notObserved, ...unstated } = silent;
    void notObserved;

    const body = renderComment({ report: unstated });
    expect(body).toContain('cannot claim a clean result');
    expect(body).toContain('cannot be read as a pass');
  });

  it('reports an incomparable subject rather than letting it read as no difference', () => {
    // The comparison was refused, so nothing is known. Grouping by the reason
    // keeps 300 of these to one line without discarding the sentence.
    const body = renderComment({
      report: reportOf([
        {
          subject: 'story:a',
          verdict: 'incomparable',
          because: 'a baseline exists but was rendered by another machine',
          changedPixels: 0,
          regions: [],
        },
        {
          subject: 'story:b',
          verdict: 'incomparable',
          because: 'a baseline exists but was rendered by another machine',
          changedPixels: 0,
          regions: [],
        },
      ]),
    });

    expect(body).toContain('**incomparable** — 2 subject(s)');
    expect(body).toContain('rendered by another machine');
  });

  it('says a region was ranked by area when the semantic tier named no cause', () => {
    // With no causes supplied the ordering falls back to area, which ranks the
    // displaced above the displacer. Printing that in the voice of a cause would
    // be a confident attribution nobody made.
    const body = renderComment({
      report: reportOf([
        {
          subject: 'story:a',
          verdict: 'changed',
          because: '511 pixel(s) differ',
          changedPixels: 511,
          regions: [
            { x: 0, y: 0, width: 30, height: 20, pixels: 511, component: 'Stack', cause: false },
          ],
        },
      ]),
    });

    expect(body).toContain('`Stack`');
    expect(body).toContain('ranked by area');
    expect(body).not.toContain('the cause in');
  });

  it('states how many causes it did not list rather than capping silently', () => {
    // A truncated list that does not say so reads as complete coverage, which is
    // the failure this system exists to make impossible.
    const many = reportOf(
      Array.from({ length: 25 }, (_, index) => ({
        subject: `story:s${index}`,
        verdict: 'changed' as const,
        because: 'differs',
        changedPixels: 10,
        regions: [
          {
            x: 0,
            y: 0,
            width: 4,
            height: 4,
            pixels: 10,
            component: `C${index}`,
            cause: true,
          },
        ],
      })),
    );

    const body = renderComment({ report: many, limits: { causes: 5 } });
    expect(body).toContain('20 more cause(s) reaching 20 subject(s)');
  });

  it('cuts an over-long body to fit and states how much it cut', () => {
    // GitHub rejects an over-long comment rather than truncating it, so the real
    // choice is between a body that says what it dropped and no comment at all.
    const body = renderComment({ report: tokenChange(300), limits: { characters: 400 } });

    expect(body.length).toBeLessThanOrEqual(400);
    expect(body).toMatch(/\d+ character\(s\) of this docket are not shown/);
    // Head-truncation, so the poster can still find and update this comment.
    expect(body.startsWith(COMMENT_MARKER)).toBe(true);
  });

  it('neutralises page content interpolated into the body', () => {
    // A landmark is built from accessible names, which are whatever the product
    // renders. Unescaped, a name can open a heading, a list, or raw HTML and
    // rearrange the docket around itself.
    const body = renderComment({
      report: reportOf([
        {
          subject: 'story:a',
          verdict: 'changed',
          because: 'differs',
          changedPixels: 10,
          regions: [
            {
              x: 0,
              y: 0,
              width: 4,
              height: 4,
              pixels: 10,
              component: 'Card',
              where: 'main → region "## `x` <img src=x>"',
              cause: true,
            },
          ],
        },
      ]),
    });

    expect(body).toContain('``main → region "## `x` <img src=x>"``');
    expect(body).not.toMatch(/^## `x`/m);
  });

  it('carries a missing font into the comment, because those images are of another font', () => {
    // The metrics in a substituted render are not the product's, so approving
    // them by eye approves a screenshot of a different layout.
    const body = renderComment({
      report: reportOf([
        {
          subject: 'story:a',
          verdict: 'changed',
          because: 'differs',
          changedPixels: 10,
          regions: [
            { x: 0, y: 0, width: 4, height: 4, pixels: 10, component: 'Card', cause: true },
          ],
          missingFonts: ['Inter/400/normal/sha256-abc'],
        },
      ]),
    });

    expect(body).toContain('the renderer lacked `Inter/400/normal/sha256-abc` in 1 subject');
  });

  it('counts excluded subjects without listing them, and lists failed ones', () => {
    // An exclusion is a decision that was already reviewed; re-litigating it on
    // every pull request ends with the exclusion list deleted rather than read.
    const body = renderComment({
      report: reportOf([], {
        notObserved: [
          { subject: 'story:chart', kind: 'failed', because: 'the story never became ready' },
          { subject: 'story:docs', kind: 'excluded', because: 'tagged `!test`' },
        ],
      }),
    });

    expect(body).toContain('`story:chart` — the story never became ready');
    expect(body).toContain('1 subject excluded by configuration and not listed');
    expect(body).not.toContain('story:docs');
  });

  it('carries the run link when the operator published one, and invents none when not', () => {
    // This comment counts collateral instead of listing it, so the reader needs
    // somewhere to go — but whether anything was published at all is the
    // operator's decision, made in their workflow.
    const withLink = renderComment({
      report: tokenChange(1),
      runUrl: 'https://example.invalid/run/1',
    });
    expect(withLink).toContain('https://example.invalid/run/1');
    expect(renderComment({ report: tokenChange(1) })).not.toContain('Full report and images');
  });

  it('states the step the reviewer takes next above the fold, in the operator\'s words', () => {
    // A reviewer on a pull request has no report on disk, so the command-line
    // fallback gives way to the link, and accepting is where this repository
    // says it is. Both come before the docket, which is folded.
    const body = renderComment({
      report: tokenChange(1),
      runUrl: 'https://example.invalid/page',
      toAccept: 'dispatch **variance** on `main`',
    });
    expect(body).toContain('To accept: dispatch **variance** on `main`');
    expect(body.indexOf('To accept')).toBeLessThan(body.indexOf('<details>'));
    expect(body).not.toContain('variance report --subject');
    expect(renderComment({ report: tokenChange(1) })).toContain('variance report --subject');
    expect(renderComment({ report: tokenChange(1) })).not.toContain('To accept');
  });

  it('carries the drift total to the reviewer who is about to approve the next step', () => {
    // The finding no comparison on this pull request can reach. Each of the
    // eleven approvals was correct about the 2px it saw; the 8px is a sum, and
    // the person standing where it can still be acted on is this reviewer.
    const body = renderComment({
      report: reportOf(tokenChange(1).observations, {
        drift: {
          '--va-space-3': {
            from: '12px',
            to: '20px',
            steps: 11,
            firstAt: '2026-05-02T00:00:00.000Z',
            lastAt: '2026-08-10T00:00:00.000Z',
            quantity: { unit: 'px', net: 8, largestStep: 2, travel: 8 },
            because:
              '`--va-space-3` drifted 12px → 20px, 8px across 11 approved commit(s); the ' +
              'largest single step was 2px, so no per-change review could have seen the total',
          },
        },
      }),
    });

    expect(body).toContain('1 token moved in this run');
    expect(body).toContain('no per-change review could have seen the total');
    // Above the docket: a reviewer who has read the first cause has often left,
    // and this changes how that cause should be read.
    expect(body.indexOf('Further than any single review saw')).toBeLessThan(
      body.indexOf('### Causes'),
    );
  });

  it('says nothing about drift on the runs where nothing drifted', () => {
    // Empty on almost every run. A standing "no tokens drifted" line is a line
    // the reader learns to skip, and it is the line they must not skip.
    expect(renderComment({ report: tokenChange(1) })).not.toContain('review saw');
  });

  it('counts the drifted tokens it did not list', () => {
    const drift = Object.fromEntries(
      Array.from({ length: 12 }, (_, index) => [
        `--va-space-${index}`,
        {
          from: '2px',
          to: '4px',
          steps: 2,
          firstAt: '2026-05-02T00:00:00.000Z',
          lastAt: '2026-08-10T00:00:00.000Z',
          because: `\`--va-space-${index}\` drifted 2px → 4px`,
        },
      ]),
    );

    const body = renderComment({
      report: reportOf(tokenChange(1).observations, { drift }),
      limits: { drift: 4 },
    });

    expect(body).toContain('8 more drifted token(s) in the run report');
  });
});
