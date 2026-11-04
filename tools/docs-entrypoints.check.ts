import { statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { type Link, PUBLIC_MARKDOWN, ROOT, lineOf, linksIn, prose } from './markdown.js';

interface Concept {
  readonly name: string;
  readonly pattern: RegExp;
  readonly owner: string;
}

/**
 * Project vocabulary whose meaning is owned by one public page.
 *
 * This is deliberately a registry rather than a capitalization heuristic.
 * React, Vitest and Arrange–Act–Assert already belong to wider engineering
 * vocabulary; these names have meanings this project defined and a reader who
 * lands on one page cannot recover those meanings from experience alone.
 * Generic words such as composition, variation and attribution stay under the
 * human rule in docs/AGENTS.md: spelling alone cannot tell whether a sentence
 * means the product concept or the ordinary engineering word.
 */
const CONCEPTS: readonly Concept[] = [
  { name: 'Variance Authority', pattern: /\bVariance Authority\b/, owner: 'docs/README.md' },
  { name: 'Eyes', pattern: /\bEyes\b(?! Test Manager)/, owner: 'docs/eyes.md' },
  { name: 'Sense', pattern: /\bSense\b/, owner: 'packages/sense/README.md' },
  { name: 'Distill', pattern: /\bDistill\b/, owner: 'docs/distill.md' },
  { name: 'Vantage', pattern: /\bVantage\b/, owner: 'docs/vantage.md' },
  { name: 'Tribunal', pattern: /\bTribunal\b/, owner: 'packages/tribunal/README.md' },
  { name: 'evidence field', pattern: /\bevidence field\b/i, owner: 'docs/evidence-field.md' },
  { name: 'reasoning loop', pattern: /\breasoning loop\b/i, owner: 'docs/reasoning.md' },
  {
    name: 'source or subject orientation',
    pattern: /\b(?:source|subject) orientation\b/i,
    owner: 'docs/orientation.md',
  },
  { name: 'source index', pattern: /\bsource index\b/i, owner: 'docs/source-index.md' },
  { name: 'package flow', pattern: /\bpackage flows?\b/i, owner: 'docs/orientation.md' },
  { name: 'execution record', pattern: /\bexecution (?:record|index)\b/i, owner: 'docs/execution-record.md' },
  { name: 'lexicon', pattern: /\blexicon\b/i, owner: 'docs/lexicon.md' },
  { name: 'polyglot', pattern: /\bpolyglot\b/i, owner: 'docs/polyglot.md' },
  { name: 'runtime scenario', pattern: /\bruntime scenarios?\b/i, owner: 'docs/scenarios.md' },
  { name: 'great green dragon rule', pattern: /\bgreat green dragon\b/i, owner: 'docs/variations.md' },
  { name: 'case precondition', pattern: /\bcase preconditions?\b/i, owner: 'docs/case-preconditions.md' },
  { name: 'breadcrumb', pattern: /\bvarianceBreadcrumb\b/, owner: 'docs/case-preconditions.md' },
  { name: 'cadence', pattern: /\bcadence\b/i, owner: 'docs/test-level-coverage.md' },
  { name: 'FSD', pattern: /\bFSD\b/, owner: 'docs/reasoning.md' },
];

const PUBLIC_PAGES = PUBLIC_MARKDOWN.filter((file) => file.startsWith('docs/'));

function headingsBlanked(text: string): string {
  return text.replace(/^#{1,6}\s+.*$/gm, (heading) => heading.replace(/[^\n]/g, ' '));
}

function inlineCodeBlanked(text: string): string {
  return text.replace(/`[^`\n]+`/g, (code) => code.replace(/[^\n]/g, ' '));
}

/** The page a link opens: a directory opens its README. */
function opened(link: Link): string | undefined {
  if (link.inside === undefined) return undefined;
  const absolute = resolve(ROOT, link.inside);
  return statSync(absolute).isDirectory() ? `${link.inside}/README.md` : link.inside;
}

function firstMention(pattern: RegExp, text: string, links: readonly Link[]): RegExpExecArray | undefined {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  const occurrences = new RegExp(pattern.source, flags);
  let match: RegExpExecArray | null;

  while ((match = occurrences.exec(text)) !== null) {
    const inside = links.find((link) => match!.index >= link.start && match!.index < link.end);
    if (inside === undefined || (match.index >= inside.labelStart && match.index < inside.labelEnd)) {
      return match;
    }
  }
  return undefined;
}

describe('every public page introduces project vocabulary through its owner', () => {
  it.each(PUBLIC_PAGES)('%s', (file) => {
    const text = inlineCodeBlanked(headingsBlanked(prose(file)));
    const links = linksIn(file);
    const missing: string[] = [];

    for (const concept of CONCEPTS) {
      if (file === concept.owner) continue;
      const match = firstMention(concept.pattern, text, links);
      if (match === undefined) continue;

      const link = links.find(
        (candidate) => match.index >= candidate.labelStart && match.index < candidate.labelEnd,
      );
      if (link === undefined || opened(link) !== concept.owner) {
        missing.push(`${file}:${lineOf(text, match.index)} → ${concept.name} should link to ${concept.owner}`);
      }
    }

    expect(missing, missing.join('\n')).toEqual([]);
  });
});
