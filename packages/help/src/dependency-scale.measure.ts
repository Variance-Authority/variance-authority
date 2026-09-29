import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { updateSourceIndex } from '@variance-authority/sense';
import { readDependencyLexicon, refreshDependencyLexicon } from './dependency-lexicon.js';

// compass: variance-authority.report.agent-surface

/**
 * What the dependency catalogue costs on the two large corpora the orientation
 * budget names: Kibana, and one checkout holding seven copies of Material UI.
 * Neither lives in this repository. They are read from the paths in
 * `VARIANCE_AUTHORITY_SCALE_KIBANA` and `VARIANCE_AUTHORITY_SCALE_MUI7`, or from
 * `variance-authority-examples` beside this checkout, and a corpus that is not
 * there is skipped and listed as a todo rather than passed.
 *
 * Each corpus is indexed once through the CLI into a cache of its own, so every
 * question reads a published generation the way a user's does. The catalogue is
 * then refreshed cold (no lexicon on disk), again over the unchanged install and index, and once more
 * with the record of what it was built from removed. Three answers are timed end to end, node start
 * included, and each must come in under a second warm. So is `orient` over the start point, which reads
 * the package graph, the external requests and the recorded cases. Its cost is the working-tree reading,
 * `status`, which walks every file unless the repository turns on the two accelerators
 * `docs/performance.md` names; on seven copies of Material UI that walk is 2.2 s. The orient child is
 * given those two settings through the environment, which is how a process is given a setting without a
 * repository's configuration being written, and its first run primes them.
 *
 * A refresh that finds the source index and the install where it left them does nothing. One that must
 * read again reuses every entry that has something to reuse: the ones that resolved to no declarations
 * have no entrypoint to compare, are recomputed because there is nothing to skip, and are counted apart.
 * `recomputed` is the ceiling on entries that had something to reuse and were read again anyway: 0 on both.
 * Owners whose installs resolve to one package share a reading, taken from the first of them in key order.
 */

const EXAMPLES = join(homedir(), 'dev', 'variance-authority-examples');
const CORPORA = [
  { name: 'Kibana', root: process.env['VARIANCE_AUTHORITY_SCALE_KIBANA'] ?? join(EXAMPLES, 'kibana'), pick: 'x-pack/platform/plugins/shared/actions/server/plugin.ts', word: 'logger', symbol: 'useState', recomputed: 0 },
  { name: 'Material UI x7', root: process.env['VARIANCE_AUTHORITY_SCALE_MUI7'] ?? join(EXAMPLES, 'mui7'), pick: 'copy3/packages/mui-material/src/Button/Button.js', word: 'button', symbol: 'useState', recomputed: 0 },
] as const;

const BIN = fileURLToPath(new URL('../../cli/dist/bin.js', import.meta.url));
const HELP = fileURLToPath(new URL('../dist/bin.js', import.meta.url));
const ACCELERATED = {
  GIT_CONFIG_COUNT: '2',
  GIT_CONFIG_KEY_0: 'core.fsmonitor',
  GIT_CONFIG_VALUE_0: 'true',
  GIT_CONFIG_KEY_1: 'core.untrackedCache',
  GIT_CONFIG_VALUE_1: 'true',
};
const WARM_BUDGET_MS = 1000;
const UNCHANGED_BUDGET_MS = 500;
const EDIT_BUDGET_MS = 1500;
const RUNS = 3;
const caches: string[] = [];
afterAll(() => { for (const cache of caches) rmSync(cache, { recursive: true, force: true }); });

const median = (values: readonly number[]): number => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] as number;
const cli = (root: string, cache: string, args: readonly string[]): string =>
  execFileSync(process.execPath, [BIN, ...args], { cwd: root, encoding: 'utf8', env: { ...process.env, VARIANCE_AUTHORITY_CACHE: cache }, maxBuffer: 1 << 28 });
const orient = (root: string, cache: string, file: string): string =>
  execFileSync(process.execPath, [HELP, 'orient', '--files', file, '--root', root], {
    encoding: 'utf8', env: { ...process.env, ...ACCELERATED, VARIANCE_AUTHORITY_CACHE: cache }, maxBuffer: 1 << 28,
  });
const timed = <T>(run: () => T): { value: T; ms: number } => { const start = performance.now(); const value = run(); return { value, ms: performance.now() - start }; };

for (const corpus of CORPORA) {
  const live = existsSync(join(corpus.root, '.git')) && existsSync(BIN) && existsSync(HELP) ? describe : describe.skip;
  live(corpus.name, () => {
    it('answers stack, search, symbol and orient from a start point under a second warm, and refreshes an unchanged install by reuse', async () => {
      const cache = mkdtempSync(join(tmpdir(), 'va-scale-'));
      caches.push(cache);
      process.env['VARIANCE_AUTHORITY_CACHE'] = cache;
      const index = timed(() => cli(corpus.root, cache, ['index']));
      const { path } = readDependencyLexicon(corpus.root);
      rmSync(path);
      const cold = timed(() => refreshDependencyLexicon(corpus.root));
      const nothing = timed(() => refreshDependencyLexicon(corpus.root));
      // The record of what the lexicon was built from is what lets a refresh do nothing; without it the
      // refresh reads everything again and reuses what it can, which is the path a changed install takes.
      rmSync(path.replace(/\.json$/, '.built.json'));
      const warm = timed(() => refreshDependencyLexicon(corpus.root));
      // One source file gains an import. The index gains a segment, and the refresh merges that segment
      // into what it kept; the answer must be the one a refresh from nothing gives.
      const edited = join(corpus.root, corpus.pick);
      const original = readFileSync(edited, 'utf8');
      let edit: { ms: number; value: ReturnType<typeof refreshDependencyLexicon> };
      let reindex: { ms: number };
      let merged: string;
      let full: string;
      // The lexicon is over a hundred megabytes here: hashed from a buffer past its stamp, never held as a string.
      const body = (file: string): string => { const bytes = readFileSync(file); return createHash('sha256').update(bytes.subarray(bytes.indexOf('"entries"'))).digest('hex'); };
      try {
        writeFileSync(edited, `${original}\nimport * as scaleProbe from 'react';\nvoid scaleProbe;\n`);
        const start = performance.now();
        await updateSourceIndex(corpus.root);
        reindex = { ms: performance.now() - start };
        edit = timed(() => refreshDependencyLexicon(corpus.root));
        merged = body(path);
        rmSync(path.replace(/\.json$/, '.built.json'));
        refreshDependencyLexicon(corpus.root);
        full = body(path);
      } finally {
        writeFileSync(edited, original);
      }
      const unresolved = warm.value.unresolved ?? 0;
      const asks: Record<string, readonly string[]> = {
        stack: ['ask', 'stack', '--from', corpus.pick],
        search: ['ask', 'search', '--query', corpus.word, '--from', corpus.pick],
        symbol: ['ask', 'symbol', '--name', corpus.symbol, '--from', corpus.pick],
      };
      const answers = Object.entries(asks).map(([ask, args]) => {
        const runs = Array.from({ length: RUNS }, () => timed(() => cli(corpus.root, cache, args)));
        return { ask, ms: median(runs.map((run) => run.ms)), bytes: runs[0]?.value.length ?? 0 };
      });
      orient(corpus.root, cache, corpus.pick);
      const oriented = Array.from({ length: RUNS }, () => timed(() => orient(corpus.root, cache, corpus.pick)));
      answers.push({ ask: 'orient', ms: median(oriented.map((run) => run.ms)), bytes: oriented[0]?.value.length ?? 0 });
      console.log(
        `${corpus.name}: index ${(index.ms / 1000).toFixed(1)} s; catalogue ${cold.value.entrypoints} entries, ` +
          `cold refresh ${(cold.ms / 1000).toFixed(1)} s, re-read ${(warm.ms / 1000).toFixed(1)} s, unchanged ${nothing.ms.toFixed(0)} ms, one edited file ${edit.ms.toFixed(0)} ms (index ${(reindex.ms / 1000).toFixed(1)} s) ` +
          `(${warm.value.reused} reused, ${unresolved} unresolved); warm answers ` +
          answers.map((answer) => `${answer.ask} ${answer.ms.toFixed(0)} ms`).join(', '),
      );
      expect(cold.value.reused).toBe(0);
      expect(nothing.value.unchanged, 'the unchanged refresh read nothing').toBe(true);
      expect(nothing.ms, 'unchanged refresh').toBeLessThan(UNCHANGED_BUDGET_MS);
      expect(edit.value.unchanged, 'an edit is not nothing').toBe(false);
      expect(edit.ms, 'refresh after one edited file').toBeLessThan(EDIT_BUDGET_MS);
      expect(merged, 'the merged lexicon is the one a full refresh gives').toBe(full);
      expect(warm.value.entrypoints - warm.value.reused - unresolved, 'entries recomputed on an unchanged install').toBeLessThanOrEqual(corpus.recomputed);
      for (const answer of answers) {
        expect(answer.bytes, `${answer.ask} answered`).toBeGreaterThan(200);
        expect(answer.ms, `${answer.ask} warm`).toBeLessThan(WARM_BUDGET_MS);
      }
    }, 600_000);
  });
}

for (const corpus of CORPORA) {
  if (!(existsSync(join(corpus.root, '.git')) && existsSync(BIN) && existsSync(HELP))) {
it.todo(`${corpus.name}: stack, search, symbol and orient answer from a start point under a second warm, and an unchanged catalogue refresh reuses its entries — needs the corpus installed at ${corpus.root} or named in VARIANCE_AUTHORITY_SCALE_KIBANA / VARIANCE_AUTHORITY_SCALE_MUI7, and the CLI and the help binary built`);
  }
}
