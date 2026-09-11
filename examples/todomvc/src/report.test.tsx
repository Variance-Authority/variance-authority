// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { indexSource, mergeSourceIndexes } from '@variance-authority/core/attribute';
import { diffSnapshots, type SemanticDiff } from '@variance-authority/core/compare';
import type { Viewport } from '@variance-authority/core/format';
import { adjudicate, buildDocket, summarizeAdjudication } from '@variance-authority/core/judge';
import { normalize } from '@variance-authority/core/rules';
import { collect } from '@variance-authority/dom';
import { portalContentOf, provenanceOf } from '@variance-authority/react';
import { POLICY, changesetById, mutationsOf, type Changeset } from './changesets.js';
import { renderStory } from './render.js';
import { STORIES } from './stories.js';
import { buildSourceIndex, PACKAGE_ROOT } from './source-index.js';

/**
 * The whole chain, end to end: **sense → locate → connect to file → report**.
 *
 * Each link exists to defeat one of the two ways review fails.
 *
 * *"Looks right, merge"* happens when the output is a picture. A picture can only
 * be judged by looking, looking is expensive, and a reviewer who has looked at
 * nine identical-seeming diffs will not look properly at the tenth. The answer is
 * not a better picture — it is an output that is a *sentence with a cause in it*,
 * which can be read rather than inspected.
 *
 * *"100 changes? merge"* happens when the output is as long as the change is
 * wide. One token edit produces a hundred diffs, nobody reviews a hundred of
 * anything, and the honest response to an unreviewable list is to approve it. The
 * answer is to report the *cause* once and count what it reached — and then to
 * declare intent, so the ninety-nine expected changes are silent and the
 * hundredth is the only line on the page.
 *
 * The last link is the one that turns a finding into work. `Toggle` is an
 * identifier; `src/ds/components.tsx:98` is an edit.
 */

const VIEWPORT: Viewport = { width: 1024, height: 768, deviceScaleFactor: 1, colorScheme: 'light' };
const SOURCE = buildSourceIndex();

let container: HTMLElement;

beforeEach(() => {
  document.head.innerHTML = '';
  document.body.innerHTML = '';
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => container.remove());

function report(changeset: Changeset): string {
  const diffs: SemanticDiff[] = STORIES.map((story) => {
    renderStory(container, story.id);
    const before = normalize(
      collect(container, {
        subject: { id: story.id, kind: 'story' },
        viewport: VIEWPORT,
        engine: 'jsdom@report',
        fonts: [],
        provenanceOf,
        portalsOf: portalContentOf,
      }),
    );

    renderStory(container, story.id, { mutations: mutationsOf(changeset) });
    const after = normalize(
      collect(container, {
        subject: { id: story.id, kind: 'story' },
        viewport: VIEWPORT,
        engine: 'jsdom@report',
        fonts: [],
        provenanceOf,
        portalsOf: portalContentOf,
      }),
    );

    return diffSnapshots(before, after);
  });

  return summarizeAdjudication(
    adjudicate(buildDocket(diffs), changeset.intent, POLICY),
    { source: SOURCE },
  );
}

describe('connecting a change to a file', () => {
  it('finds the design system`s components in the source tree', () => {
    expect(SOURCE['Toggle']?.[0]?.file).toBe('src/ds/components.tsx');
    expect(SOURCE['TodoFooter']?.[0]?.file).toBe('src/app/todo.tsx');
  });

  it('records a line number an editor can open', () => {
    const toggle = SOURCE['Toggle']![0]!;
    expect(toggle.line).toBeGreaterThan(0);

    const source = readFileSync(join(PACKAGE_ROOT, toggle.file), 'utf8').split('\n');
    expect(source[toggle.line - 1]).toContain('Toggle');
  });

  it('reports ambiguity rather than picking a file', () => {
    // Two components can genuinely share a name. Silently choosing the first
    // would send an agent to edit the wrong file with full confidence.
    const ambiguous = mergeSourceIndexes([
      indexSource('a/Button.tsx', 'export function Button() {}'),
      indexSource('b/Button.tsx', 'export function Button() {}'),
    ]);

    expect(ambiguous['Button']).toHaveLength(2);
  });
});

describe('orienting a change', () => {
  it('locates a finding by landmark rather than by coordinates', () => {
    // A rect moves whenever anything above it reflows, so coordinates describe
    // this build and no other. A landmark path describes the page.
    const text = report(changesetById('density-pass-with-accident'));
    expect(text).toMatch(/\bin .+/);
  });
});

describe('the report', () => {
  it('names the file for the finding', () => {
    const text = report(changesetById('rebrand-with-accident'));

    expect(text).toContain('Toggle');
    expect(text).toContain('src/ds/components.tsx:');
  });

  it('stays short when the change is wide', () => {
    // The "100 changes? merge" defence. A branch touching every story reports one
    // line per *cause*, not per screenshot — and the expected causes collapse to
    // a count, so length tracks findings rather than blast radius.
    const wide = report(changesetById('rebrand-with-accident'));
    expect(wide.split('\n').length).toBeLessThan(8);
  });

  it('says nothing at all when everything was declared', () => {
    // The other half. A clean branch produces a count and no lines, so a reviewer
    // who sees lines knows they are the point.
    const clean = report(changesetById('rebrand'));

    expect(clean).toContain('3 authorized');
    expect(clean.split('\n')).toHaveLength(1);
  });

  it('prints the reports', () => {
    for (const id of ['rebrand', 'rebrand-with-accident', 'density-pass-with-accident']) {
      console.log(`\n--- ${changesetById(id).title}  [${id}]\n${report(changesetById(id))}`);
    }

    expect(true).toBe(true);
  });
});
