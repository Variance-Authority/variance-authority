import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { prepareJourneys } from './journeys.js';
import { updateSourceIndex } from './published.js';
import { nearestTestCoverage, testCoverageFile } from './test-selection/record-location.js';
import { declaredSuites } from './test-selection/suites.js';

// compass: variance-authority.reach.relations

/**
 * The share of the functions a recorded case ran that the walk finds a caller
 * for, on three repositories whose tests reach their code in different ways:
 * this one, Material UI, and Docusaurus. The walk resolves an import through
 * the source index alone, and where that misses, the recording places the call
 * on the one function the case ran under the imported name. Nothing reads a
 * test runner's module mapping, so a share that fell here is a call the walk
 * stopped placing, and it is a count, not a time.
 *
 * Each floor is the share the walk reached on that repository's recording when
 * the floor was set, truncated to a tenth of a point. A later recording that moves it is a finding about the walk or about
 * the recording, and the floor is moved when the finding is written down.
 *
 * Neither Material UI nor Docusaurus lives in this repository, and none of the
 * three suites is run here: each is read from the recording its last run left.
 * The checkouts are read from `VARIANCE_AUTHORITY_SHARE_MUI` and
 * `VARIANCE_AUTHORITY_SHARE_DOCUSAURUS`, or from `~/dev/material-ui` and
 * `~/dev/variance-authority-examples/docusaurus`. The recording is found
 * where that checkout's own reader finds it, unless
 * `VARIANCE_AUTHORITY_SHARE_<NAME>_CACHE` names another cache. A checkout or a
 * recording that is not there is skipped and listed as a todo rather than
 * passed. The recording is copied into a cache of the measurement's own, so the
 * index and the journeys are built cold and nothing is written beside the
 * checkout's recording.
 */

const HERE = fileURLToPath(new URL('../../..', import.meta.url));
const EXAMPLES = join(homedir(), 'dev', 'variance-authority-examples');
const RECORDED = ['coverage.bin', 'coverage.bin.cases.bin', 'coverage.runs.json'] as const;

interface Corpus {
  readonly name: string;
  readonly root: string;
  readonly cache?: string | undefined;
  readonly floor: number;
  readonly needs: string;
}

const CORPORA: readonly Corpus[] = [
  { name: 'variance-authority', root: HERE, cache: process.env['VARIANCE_AUTHORITY_SHARE_VA_CACHE'], floor: 0.804, needs: "a recording of this checkout's suites, which `yarn test` writes" },
  {
    name: 'Material UI',
    root: process.env['VARIANCE_AUTHORITY_SHARE_MUI'] ?? join(homedir(), 'dev', 'material-ui'),
    cache: process.env['VARIANCE_AUTHORITY_SHARE_MUI_CACHE'],
    floor: 0.378,
    needs: 'a Material UI checkout with a recording, at `VARIANCE_AUTHORITY_SHARE_MUI` or `~/dev/material-ui`',
  },
  {
    name: 'Docusaurus',
    root: process.env['VARIANCE_AUTHORITY_SHARE_DOCUSAURUS'] ?? join(EXAMPLES, 'docusaurus'),
    cache: process.env['VARIANCE_AUTHORITY_SHARE_DOCUSAURUS_CACHE'],
    floor: 0.808,
    needs: 'a Docusaurus checkout with a recording, at `VARIANCE_AUTHORITY_SHARE_DOCUSAURUS` or `~/dev/variance-authority-examples/docusaurus`',
  },
];

/** Each declared suite's recording, as `coverage.bin` paths, read before the measurement points the cache elsewhere. */
function recordingsOf({ root, cache }: Corpus): readonly { readonly suite?: string; readonly from: string }[] {
  if (!existsSync(join(root, '.git'))) return [];
  const suites = declaredSuites(root)?.map((suite) => suite.name) ?? [undefined];
  return suites.flatMap((suite) => {
    const from = nearestTestCoverage(root, { suite, cacheRoot: cache });
    return RECORDED.every((file) => existsSync(join(dirname(from), file)))
      ? [{ ...(suite === undefined ? {} : { suite }), from }]
      : [];
  });
}

const found = CORPORA.map((corpus) => ({ corpus, recordings: recordingsOf(corpus) }));
const caches: string[] = [];
afterAll(() => {
  delete process.env['VARIANCE_AUTHORITY_CACHE'];
  for (const cache of caches) rmSync(cache, { recursive: true, force: true });
});

for (const { corpus, recordings } of found) {
  const live = recordings.length > 0 ? describe : describe.skip;
  live(`the walk's placed share on ${corpus.name}`, () => {
    it(`places a caller for at least ${(corpus.floor * 100).toFixed(1)}% of the functions its recorded cases ran`, { timeout: 600_000 }, async () => {
      const cache = mkdtempSync(join(tmpdir(), 'va-journeys-share-'));
      caches.push(cache);
      process.env['VARIANCE_AUTHORITY_CACHE'] = cache;
      for (const { suite, from } of recordings) {
        const to = testCoverageFile(corpus.root, { suite });
        mkdirSync(dirname(to), { recursive: true });
        for (const file of RECORDED) {
          copyFileSync(join(dirname(from), file), join(dirname(to), file));
        }
      }

      const scanned = await updateSourceIndex(corpus.root);
      const prepared = (await prepareJourneys(corpus.root, scanned.path, scanned)).flatMap((suite) => ('prepared' in suite ? [suite.prepared] : []));
      const placed = prepared.reduce((sum, suite) => sum + suite.placed, 0);
      const entered = prepared.reduce((sum, suite) => sum + suite.functionsEntered, 0);

      expect(entered).toBeGreaterThan(0);
      expect(placed / entered).toBeGreaterThanOrEqual(corpus.floor);
    });
  });
}

for (const { corpus, recordings } of found) {
  if (recordings.length === 0) {
it.todo(`the walk's placed share on ${corpus.name} holds its floor of ${(corpus.floor * 100).toFixed(1)}% — needs ${corpus.needs}`);
  }
}
