import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { MARKDOWN, ROOT, lineOf, prose } from './markdown.js';

/**
 * A number in the documentation is re-derived, or it is not a number.
 *
 * Every other rule in this directory checks a *claim* — a command exists, an
 * option is named, a link resolves. None of them has ever checked a figure, and
 * the consequence is the failure mode figures have: `docs/specs/README.md` said
 * `9,961 probes over 301 product files` while the script that produces it said
 * 10,219 over 308, and it said so for as long as nobody re-ran the script. The
 * doc was not wrong when it was written. It rotted, silently, in the one
 * direction a reader cannot detect.
 *
 * So the rule is not "this number is correct" — nothing here can know that. It
 * is **this number has a producer, and the producer still says it**. A figure
 * whose producer is a markdown file is outside this rule by construction, which
 * is the honest boundary: those are transcriptions and the repository has many.
 * This file covers the ones that can be re-run, and the set only grows by
 * somebody writing a producer.
 *
 * Failing is cheap to satisfy. `yarn workspace @variance-authority/sense census`
 * prints every figure below; a file added to a package moves the counts, and
 * refreshing the doc is the point rather than the cost.
 */

/** One figure, and the command that still has to agree with it. */
interface Figure {
  /** What the number is, in the failure message. */
  readonly name: string;
  /** Producer, run from the repository root. */
  readonly command: readonly string[];
  /** Reads the figure out of the producer's stdout. */
  readonly produces: (output: string) => string;
  /**
   * Finds every place the documentation states it.
   *
   * A figure the documentation does not state is a producer nobody quotes, and
   * that is a different problem from a stale number — so the rule below demands
   * at least one site rather than treating zero as a pass.
   */
  readonly stated: RegExp;
}

const CENSUS = ['packages/sense/scripts/census.mjs'] as const;

const after = (label: RegExp) => (output: string): string => {
  const found = label.exec(output);
  if (!found?.[1]) throw new Error(`producer printed nothing for ${String(label)}`);
  return found[1];
};

const FIGURES: readonly Figure[] = [
  {
    name: 'probes the instrument inserts over this repository',
    command: CENSUS,
    produces: after(/^ {2}TOTAL\s+(\d+)$/m),
    // Written with a thousands separator in prose and without one in a table.
    stated: /\b(\d{1,3}),?(\d{3}) probes\b/g,
  },
  {
    name: 'product files the census reads',
    command: CENSUS,
    produces: after(/^(\d+) product files\b/m),
    stated: /\b(\d{3}) product files\b/g,
  },
  {
    name: "Istanbul's statement sites on the same trees",
    command: CENSUS,
    produces: after(/^ {4}statements\s+(\d+)$/m),
    stated: /\b(\d{1,3}),?(\d{3}) statements collapse\b/g,
  },
  {
    name: 'continuation regions they collapse to',
    command: CENSUS,
    produces: after(/^ {2}continuation\s+(\d+)/m),
    stated: /collapse (?:in)?to (\d),?(\d{3}) continuation/g,
  },
];

/** Prose *and* tables: a figure in a table row is the case that rotted. */
const DOCUMENTATION = MARKDOWN.filter(
  // Journals are dated records of what was true when they were written, and a
  // rule that made them track the present would delete the only account of how
  // a number moved. Everything else is present-tense product material.
  (file) => file.startsWith('docs/') && !file.startsWith('docs/context/journal/'),
);

const run = (command: readonly string[]): string =>
  execFileSync('node', [...command], { cwd: ROOT, encoding: 'utf8', timeout: 120_000 });

const OUTPUT = new Map<string, string>();
const outputOf = (command: readonly string[]): string => {
  const key = command.join(' ');
  const held = OUTPUT.get(key) ?? run(command);
  OUTPUT.set(key, held);
  return held;
};

interface Site {
  readonly file: string;
  readonly line: number;
  readonly text: string;
}

function sitesOf(figure: Figure): readonly Site[] {
  const found: Site[] = [];
  for (const file of DOCUMENTATION) {
    const text = prose(file);
    for (const match of text.matchAll(figure.stated)) {
      found.push({ file, line: lineOf(text, match.index), text: match.slice(1).join('') });
    }
  }
  return found;
}

describe('a figure with a producer still matches it', () => {
  it.each(FIGURES.map((figure) => [figure.name, figure] as const))(
    '%s is quoted somewhere',
    (_name, figure) => {
      // A producer nobody quotes is a script that has stopped being read, which
      // is how the last one rotted — nobody noticed because nobody looked.
      expect(sitesOf(figure).length).toBeGreaterThan(0);
    },
  );

  it.each(FIGURES.map((figure) => [figure.name, figure] as const))(
    '%s says what the producer says',
    (_name, figure) => {
      const expected = figure.produces(outputOf(figure.command));
      const wrong = sitesOf(figure)
        .filter((site) => site.text !== expected)
        .map((site) => `${site.file}:${site.line} says ${site.text}, producer says ${expected}`);

      expect(wrong).toEqual([]);
    },
  );
});
