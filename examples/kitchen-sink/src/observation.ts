/**
 * One corpus run, observed twice, reduced to one {@link Observation} per case.
 *
 * Not a test — this is the apparatus every assertion in
 * `measure.chromium.test.tsx` reads, and it was extracted so that file could get
 * under the length limit without splitting its `describe`s across processes.
 * That constraint is the whole reason for the shape here: the two profiles have
 * to be produced by *one* run against *one* set of fixtures, or P4 compares two
 * runs rather than two observers. So collection is a single pass that fills
 * module-level maps, `chromium` and `jsdom` are collected side by side inside
 * it, and a second test file calling {@link collectBothProfiles} again would be
 * launching a second browser and measuring something else.
 *
 * Requires a `document`: the `jsdom` half collects in-process through
 * `jsdom-profile.ts`, so a caller needs a jsdom environment. For that reason —
 * the same one `jsdom-profile.ts` gives — none of this is re-exported from the
 * package index.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  diffSnapshots,
  loudestBand,
  type Band,
  type SemanticDiff,
} from '@variance-authority/core/compare';
import type { SemanticSnapshot } from '@variance-authority/core/format';
import { buildDocket } from '@variance-authority/core/judge';
import { normalize } from '@variance-authority/core/rules';
import { createHarness, type Harness } from '@variance-authority/playwright';
import { CORPUS, type Verdict } from './corpus.js';
import { CORPUS_FONTS, CORPUS_VIEWPORT, jsdomSnapshot } from './jsdom-profile.js';

/**
 * Paths from the workspace root rather than from `import.meta.url`.
 *
 * Under Vitest's jsdom environment `import.meta.url` is an `http://` URL — the
 * module graph is served, not read — so the usual relative-to-this-file idiom
 * throws. Vitest runs with the config root as cwd, and the existence check below
 * turns a wrong assumption into a sentence instead of a missing page.
 */
const PACKAGE_ROOT = join(process.cwd(), 'examples', 'kitchen-sink');
const HARNESS_PAGE = join(PACKAGE_ROOT, 'page', 'harness.html');
const AGENT_BUILDER = join(PACKAGE_ROOT, 'scripts', 'agent-bundle.mjs');
const HARNESS_PAGE_URL = pathToFileURL(HARNESS_PAGE).href;

/**
 * Build the page agent in a child process and read the bytes back.
 *
 * Not `import { buildAgentBundle }`: this file runs under Vitest's jsdom
 * environment so that the `jsdom` half of the comparison can collect in-process,
 * and esbuild refuses to start there — jsdom's `TextEncoder` produces a
 * `Uint8Array` from another realm, which esbuild checks for and rejects. Building
 * out-of-process is what keeps both profiles in one file, and both profiles have
 * to be in one file or P4 is comparing two runs rather than two observers.
 */
function agentBundle(): string {
  if (!existsSync(AGENT_BUILDER)) {
    throw new Error(`expected the workspace root as cwd; ${AGENT_BUILDER} does not exist`);
  }

  const outfile = join(tmpdir(), `va-agent-${process.pid}.js`);
  try {
    execFileSync(process.execPath, [AGENT_BUILDER, outfile], { stdio: 'pipe' });
    return readFileSync(outfile, 'utf8');
  } finally {
    rmSync(outfile, { force: true });
  }
}

export interface Observation {
  readonly verdict: Verdict;
  readonly roots: number;
  /** Worst band present, which is what a blocking policy would read. */
  readonly band: Band | 'none';
  readonly bands: readonly Band[];
  /** Delta kinds observed, so a band disagreement names its own evidence. */
  readonly kinds: readonly string[];
  /** Who the report blames. See `CorpusCase.blames`. */
  readonly blames: readonly string[];
  readonly diagnostics: readonly string[];
}

/** Both snapshots of each pair, kept so the same renders can be hashed per component. */
export interface Pair {
  readonly base: SemanticSnapshot;
  readonly perturbed: SemanticSnapshot;
}

const chromiumObserved: Map<string, Observation> = new Map();
const jsdomObserved: Map<string, Observation> = new Map();
const chromiumPairs: Map<string, Pair> = new Map();
const jsdomPairs: Map<string, Pair> = new Map();

// Handed out read-only. They are filled exactly once, by the run below, and a
// consumer that could write to them could make a measurement say anything.
export const CHROMIUM: ReadonlyMap<string, Observation> = chromiumObserved;
export const JSDOM: ReadonlyMap<string, Observation> = jsdomObserved;
export const PAIR_CHROMIUM: ReadonlyMap<string, Pair> = chromiumPairs;
export const PAIR_JSDOM: ReadonlyMap<string, Pair> = jsdomPairs;

let harness: Harness | undefined;
let engine = 'chromium@unknown';

/**
 * What the harness said it was driving.
 *
 * Read from the browser rather than declared, so a test can assert the profile
 * was detected from the host instead of being told.
 */
export function engineName(): string {
  return engine;
}

function observe(before: SemanticSnapshot, after: SemanticSnapshot): Omit<Observation, 'diagnostics'> {
  const diff = diffSnapshots(before, after);
  const bands = [...new Set(diff.deltas.map((delta) => delta.band))];

  return {
    verdict: diff.identical ? 'hash-stable' : 'hash-changed',
    roots: diff.roots.length,
    band: worst(bands),
    bands,
    kinds: [...new Set(diff.deltas.map((delta) => delta.kind))],
    blames: blamedBy(diff),
  };
}

/**
 * The names the report puts in front of a reviewer.
 *
 * Read from the docket rather than from the diff, because the docket is what a
 * reader is handed and the two can disagree. A `token` root blames no component,
 * so it carries its label instead.
 */
function blamedBy(diff: SemanticDiff): readonly string[] {
  return buildDocket([diff]).entries.flatMap((entry) => {
    const components = entry.components
      .filter((component) => component.role === 'root')
      .map((component) => component.name);

    return components.length > 0 ? components : [entry.label];
  });
}

/** Loudest band present — what a blocking policy reads. `BANDS` fixes the order. */
function worst(bands: readonly Band[]): Band | 'none' {
  return loudestBand(bands) ?? 'none';
}

/**
 * Capture the whole corpus under both profiles, in one pass.
 *
 * Call once, from a `beforeAll`, and only when a browser exists. Everything the
 * assertions read is a lookup into the maps above afterwards.
 */
export async function collectBothProfiles(): Promise<void> {
  harness = await createHarness({
    url: HARNESS_PAGE_URL,
    bundle: agentBundle(),
    viewport: CORPUS_VIEWPORT,
    fonts: CORPUS_FONTS,
  });
  engine = harness.engine;

  // Every capture in the run goes through this one page. The corpus's own
  // `renderCase` contract says one case per document, and the page agent honours
  // it by tearing the previous case down — sheets, portal host, React root —
  // before installing the next. If that teardown ever leaks, the symptom is a
  // `hash-stable` verdict that means nothing, so it is worth restating: the
  // persistence is in the *browser*, never in the document's contents.
  for (const corpusCase of CORPUS) {
    const before = await harness.capture(corpusCase.subject, corpusCase.baseVariant);
    const after = await harness.capture(corpusCase.subject, corpusCase.perturbedVariant);

    const chromiumPair: Pair = { base: normalize(before), perturbed: normalize(after) };
    chromiumObserved.set(corpusCase.id, {
      ...observe(chromiumPair.base, chromiumPair.perturbed),
      diagnostics: [...before.diagnostics, ...after.diagnostics].map((d) => d.code),
    });
    chromiumPairs.set(corpusCase.id, chromiumPair);

    const jsdomPair: Pair = {
      base: jsdomSnapshot(corpusCase.subject, corpusCase.baseVariant),
      perturbed: jsdomSnapshot(corpusCase.subject, corpusCase.perturbedVariant),
    };
    jsdomObserved.set(corpusCase.id, { ...observe(jsdomPair.base, jsdomPair.perturbed), diagnostics: [] });
    jsdomPairs.set(corpusCase.id, jsdomPair);
  }
}

/** Release the browser. Safe when no run happened, which is the skipped case. */
export async function closeHarness(): Promise<void> {
  await harness?.close();
}
