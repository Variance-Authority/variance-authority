import { statSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MARKDOWN, ROOT, lineOf, prose } from './markdown.js';

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
  { name: 'execution record', pattern: /\bexecution (?:record|index)\b/i, owner: 'docs/execution-record.md' },
  { name: 'lexicon', pattern: /\blexicon\b/i, owner: 'docs/lexicon.md' },
  { name: 'polyglot', pattern: /\bpolyglot\b/i, owner: 'docs/polyglot.md' },
  { name: 'runtime scenario', pattern: /\bruntime scenarios?\b/i, owner: 'docs/scenarios.md' },
];

const PUBLIC_PAGES = MARKDOWN.filter((file) => /^docs\/[^/]+\.md$/.test(file))
  .filter((file) => file !== 'docs/AGENTS.md' && file !== 'docs/visual-guidelines.md');

interface Link {
  readonly start: number;
  readonly end: number;
  readonly labelStart: number;
  readonly labelEnd: number;
  readonly target: string;
}

function linksIn(text: string): readonly Link[] {
  return [...text.matchAll(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)].map((match) => ({
    start: match.index,
    end: match.index + match[0].length,
    labelStart: match.index + 1,
    labelEnd: match.index + 1 + match[1]!.length,
    target: match[2]!,
  }));
}

function headingsBlanked(text: string): string {
  return text.replace(/^#{1,6}\s+.*$/gm, (heading) => heading.replace(/[^\n]/g, ' '));
}

function inlineCodeBlanked(text: string): string {
  return text.replace(/`[^`\n]+`/g, (code) => code.replace(/[^\n]/g, ' '));
}

function targetFile(from: string, target: string): string | undefined {
  if (/^(?:https?:|mailto:)/.test(target)) return undefined;
  const [path] = target.split('#') as [string];
  let absolute = path === '' ? resolve(ROOT, from) : resolve(dirname(resolve(ROOT, from)), path);
  if (statSync(absolute).isDirectory()) absolute = resolve(absolute, 'README.md');
  return relative(ROOT, absolute).replaceAll('\\', '/');
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
    const links = linksIn(text);
    const missing: string[] = [];

    for (const concept of CONCEPTS) {
      if (file === concept.owner) continue;
      const match = firstMention(concept.pattern, text, links);
      if (match === undefined) continue;

      const link = links.find(
        (candidate) => match.index >= candidate.labelStart && match.index < candidate.labelEnd,
      );
      if (link === undefined || targetFile(file, link.target) !== concept.owner) {
        missing.push(`${file}:${lineOf(text, match.index)} → ${concept.name} should link to ${concept.owner}`);
      }
    }

    expect(missing, missing.join('\n')).toEqual([]);
  });
});
