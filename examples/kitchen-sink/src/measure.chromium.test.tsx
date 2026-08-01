// @vitest-environment jsdom
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  diffSnapshots,
  normalize,
  type Band,
  type SemanticSnapshot,
} from '@variance-authority/core';
import { createHarness, type Harness } from '@variance-authority/harness-playwright';
import {
  CONTESTED_CORPUS,
  CORPUS,
  comparableCases,
  declaresDivergence,
  expectationFor,
  scorableFor,
  undecidableFor,
  type CorpusCase,
  type Verdict,
} from './corpus.js';
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

/**
 * M0 move M5 — the corpus under `chromium`, and claim P4.
 *
 * Two measurements in one file, and they have to be in one file: P4 compares the
 * two profiles' *observations*, so both have to be produced by the same run
 * against the same fixtures. Splitting them would leave the comparison reading
 * yesterday's numbers out of a file, which is not a measurement.
 *
 * The file runs under `jsdom` because half of it collects there in-process. The
 * other half drives a real Chromium through
 * `@variance-authority/harness-playwright` — one browser, one page, no reload —
 * so adding subjects costs a `page.evaluate`, not a process launch.
 *
 * Skipped, loudly, when Chromium is not downloaded. A machine with no browser has
 * not disproved P4.
 */

const BROWSER_AVAILABLE = ((): boolean => {
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
})();

interface Observation {
  readonly verdict: Verdict;
  readonly roots: number;
  /** Worst band present, which is what a blocking policy would read. */
  readonly band: Band | 'none';
  readonly bands: readonly Band[];
  readonly diagnostics: readonly string[];
}

const CHROMIUM: Map<string, Observation> = new Map();
const JSDOM: Map<string, Observation> = new Map();

let harness: Harness | undefined;
let engine = 'chromium@unknown';

function observe(before: SemanticSnapshot, after: SemanticSnapshot): Omit<Observation, 'diagnostics'> {
  const diff = diffSnapshots(before, after);
  const bands = [...new Set(diff.deltas.map((delta) => delta.band))];

  return {
    verdict: diff.identical ? 'hash-stable' : 'hash-changed',
    roots: diff.roots.length,
    band: worst(bands),
    bands,
  };
}

/** Worst band present. A subject with one `geometry` delta is a geometry finding. */
function worst(bands: readonly Band[]): Band | 'none' {
  if (bands.includes('geometry')) return 'geometry';
  if (bands.includes('token')) return 'token';
  if (bands.includes('texture')) return 'texture';
  return 'none';
}

beforeAll(async () => {
  if (!BROWSER_AVAILABLE) return;

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

    CHROMIUM.set(corpusCase.id, {
      ...observe(normalize(before), normalize(after)),
      diagnostics: [...before.diagnostics, ...after.diagnostics].map((d) => d.code),
    });

    JSDOM.set(corpusCase.id, {
      ...observe(
        jsdomSnapshot(corpusCase.subject, corpusCase.baseVariant),
        jsdomSnapshot(corpusCase.subject, corpusCase.perturbedVariant),
      ),
      diagnostics: [],
    });
  }
}, 300_000);

afterAll(async () => {
  await harness?.close();
});

function chromiumOf(id: string): Observation {
  const observation = CHROMIUM.get(id);
  if (observation === undefined) throw new Error(`no chromium observation for ${id}`);
  return observation;
}

const SCORABLE = scorableFor('chromium');

describe.skipIf(!BROWSER_AVAILABLE)('M5 — corpus agreement (chromium)', () => {
  for (const corpusCase of SCORABLE) {
    const expectation = expectationFor(corpusCase, 'chromium');
    if (expectation.kind !== 'scorable') continue;

    it(`${corpusCase.id} — ${expectation.expect}`, () => {
      expect(
        chromiumOf(corpusCase.id).verdict,
        `${corpusCase.id}\n  expected: ${expectation.expect}\n  rationale: ${corpusCase.rationale}\n  defends: ${corpusCase.spec}`,
      ).toBe(expectation.expect);
    });
  }

  it('reports the measurement', () => {
    const missed = SCORABLE.filter((c) => {
      const expectation = expectationFor(c, 'chromium');
      return expectation.kind === 'scorable' && chromiumOf(c.id).verdict !== expectation.expect;
    });

    const falseStable = missed.filter((c) => chromiumOf(c.id).verdict === 'hash-stable');
    const falseChanged = missed.filter((c) => chromiumOf(c.id).verdict === 'hash-changed');
    const undecidable = undecidableFor('chromium');

    const declared = (verdict: Verdict): number =>
      SCORABLE.filter((c) => {
        const expectation = expectationFor(c, 'chromium');
        return expectation.kind === 'scorable' && expectation.expect === verdict;
      }).length;

    console.log(
      [
        '',
        `M5 CORPUS MEASUREMENT — chromium (${engine})`,
        `  scorable cases:       ${SCORABLE.length}  (${declared('hash-stable')} stable, ${declared('hash-changed')} changed)`,
        `  undecidable here:     ${undecidable.length}   ${undecidable.map((c) => c.id).join(', ')}`,
        `  contested (excluded): ${CONTESTED_CORPUS.length}   ${CONTESTED_CORPUS.map((c) => c.id).join(', ')}`,
        `  agreed:               ${SCORABLE.length - missed.length}/${SCORABLE.length}`,
        `  false unchanged:      ${falseStable.length}   ${falseStable.map((c) => c.id).join(', ')}`,
        `  false changed:        ${falseChanged.length}   ${falseChanged.map((c) => c.id).join(', ')}`,
        '',
      ].join('\n'),
    );

    // Asserted separately from `false changed`, and only this one is fatal. One
    // hides a regression; the other costs a review. A single pass rate would
    // average the fatal into the merely noisy.
    expect(falseStable.map((c) => c.id), 'false unchanged — a missed regression').toEqual([]);
  });
});

describe.skipIf(!BROWSER_AVAILABLE)('M5 — one root per cause under chromium (claim P2)', () => {
  for (const corpusCase of SCORABLE) {
    const expectation = expectationFor(corpusCase, 'chromium');
    if (expectation.kind !== 'scorable' || expectation.roots === undefined) continue;

    it(`${corpusCase.id} — ${expectation.roots} root(s)`, () => {
      // Real layout means real rect deltas, which the attributor must fold under
      // the root that caused them. A count that grows here relative to `jsdom` is
      // the differ reporting collateral as causes.
      expect(chromiumOf(corpusCase.id).roots, `${corpusCase.id}: ${corpusCase.rationale}`).toBe(
        expectation.roots,
      );
    });
  }
});

describe.skipIf(!BROWSER_AVAILABLE)('M5 — declared per-profile bands (ADR-0008)', () => {
  for (const corpusCase of SCORABLE) {
    const expectation = expectationFor(corpusCase, 'chromium');
    if (expectation.kind !== 'scorable' || !expectation.perProfile) continue;
    if (expectation.band === undefined) continue;

    it(`${corpusCase.id} — ${expectation.band}`, () => {
      expect(chromiumOf(corpusCase.id).band, expectation.because).toBe(expectation.band);
    });
  }
});

describe.skipIf(!BROWSER_AVAILABLE)('P4 — do the two profiles agree?', () => {
  const COMPARABLE = comparableCases('jsdom', 'chromium');

  it('reports the comparison', () => {
    const divergent = COMPARABLE.filter((c) => declaresDivergence(c, 'jsdom', 'chromium'));
    const shouldAgree = COMPARABLE.filter((c) => !declaresDivergence(c, 'jsdom', 'chromium'));

    const disagreed = shouldAgree.filter(
      (c) => JSDOM.get(c.id)?.verdict !== CHROMIUM.get(c.id)?.verdict,
    );

    const bandShift = shouldAgree.filter((c) => JSDOM.get(c.id)?.band !== CHROMIUM.get(c.id)?.band);

    console.log(
      [
        '',
        'P4 — PROFILE AGREEMENT (jsdom vs chromium)',
        `  comparable cases:      ${COMPARABLE.length}`,
        `  declared divergent:    ${divergent.length}   ${divergent.map((c) => c.id).join(', ')}`,
        `  must agree:            ${shouldAgree.length}`,
        `  observed agreement:    ${shouldAgree.length - disagreed.length}/${shouldAgree.length}`,
        `  undeclared divergence: ${disagreed.length}   ${disagreed
          .map((c) => `${c.id} (jsdom ${JSDOM.get(c.id)?.verdict}, chromium ${CHROMIUM.get(c.id)?.verdict})`)
          .join(', ')}`,
        '',
        '  band shifts (reported, not scored — the profiles observe different evidence):',
        ...bandShift.map(
          (c) => `    ${c.id}: jsdom ${JSDOM.get(c.id)?.band} → chromium ${CHROMIUM.get(c.id)?.band}`,
        ),
        '',
      ].join('\n'),
    );

    // The claim. Every case here is one the corpus says both profiles can decide
    // and should decide the same way, so a disagreement is a defect in one of
    // the two collection paths — which is the only thing P4 was ever able to
    // find, and the reason ADR-0008 insists the legitimate divergences be
    // declared in advance rather than excused afterwards.
    expect(
      disagreed.map((c) => c.id),
      'profiles disagreed where the corpus says they must not',
    ).toEqual([]);
  });

  it('never lets chromium be quieter than jsdom', () => {
    // The asymmetric guard. `chromium` observes a superset of what `jsdom` does,
    // so a case `jsdom` calls changed and `chromium` calls stable is a false
    // `unchanged` in the profile that is supposed to be more capable — the worst
    // failure this product can produce, and it would not show up as a corpus
    // miss if both were declared `hash-stable` for the wrong reason.
    const quieter = comparableCases('jsdom', 'chromium').filter(
      (c) =>
        JSDOM.get(c.id)?.verdict === 'hash-changed' && CHROMIUM.get(c.id)?.verdict === 'hash-stable',
    );

    expect(quieter.map((c) => c.id), 'chromium saw less than jsdom').toEqual([]);
  });
});

describe.skipIf(!BROWSER_AVAILABLE)('M5 — excluded cases under chromium', () => {
  for (const corpusCase of CORPUS) {
    const expectation = expectationFor(corpusCase, 'chromium');
    if (expectation.kind === 'scorable') continue;

    it(`${corpusCase.id} — ${expectation.kind}`, () => {
      const observed = chromiumOf(corpusCase.id);
      console.log(
        `  ${expectation.kind} ${corpusCase.id}: declared ${corpusCase.expect}, observed ${observed.verdict} (${observed.band}) — ${expectation.reason}`,
      );
      expect(observed.verdict).toMatch(/^hash-(stable|changed)$/);
    });
  }
});

describe.skipIf(!BROWSER_AVAILABLE)('M5 — collection under chromium', () => {
  it('reports no diagnostics, so no dimension was silently missing', () => {
    // A capture that could not resolve fonts, portals, or a stylesheet is still a
    // capture — it just quietly covers less. Under `chromium` there is no excuse
    // for any of them, so anything here is a finding rather than a limitation.
    const noisy = [...CHROMIUM.entries()].filter(([, o]) => o.diagnostics.length > 0);
    expect(noisy.map(([id, o]) => `${id}: ${o.diagnostics.join(',')}`)).toEqual([]);
  });

  it('detected the profile from the host rather than being told', () => {
    expect(engine).toMatch(/^chromium@\d+\./);
  });
});

describe.skipIf(BROWSER_AVAILABLE)('M5 — corpus under chromium', () => {
  it.skip('needs a Chromium download: npx playwright install chromium', () => {});
});
