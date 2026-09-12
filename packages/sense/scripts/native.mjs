#!/usr/bin/env node

/**
 * Where the record path's milliseconds actually are: ours, or already native.
 *
 * [ADR-0004](../../../docs/context/adr/0004-defer-native-acceleration.md) admits
 * native code only against a recorded benchmark, and "this is slow, rewrite it
 * in Rust" is not one. The question a rewrite has to answer first is how much of
 * the clock it could even reach — a stage that is two thirds brotli has a third
 * on offer, and a probe that runs inside somebody else's V8 has none.
 *
 * So every stage is profiled and its self time attributed by **ancestry**, not
 * by the name on the frame. Brotli surfaces as `writeSync` and `close` with no
 * url at all; what identifies it is that its parent chain passes through
 * `node:zlib`. Keyed on names, the largest native cost in the encoder reads as
 * half a per cent of it.
 *
 * Nothing is dropped except the profiler's own stop. A bucket that quietly
 * discards a dependency's JavaScript reports a smaller denominator and flatters
 * whatever is left.
 *
 * The stages:
 *
 *   instrument — parse and cut regions over this repository's own product
 *                source. The one stage a build pays per changed file.
 *   encode     — the whole snapshot to bytes, which is what a run ends with.
 *   decode     — the same bytes back as the logical model.
 *   layer      — a run merged onto the index it found, the shape of every run
 *                after the first.
 *
 * Run:  node scripts/native.mjs
 *       node scripts/native.mjs 5000
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Session } from 'node:inspector/promises';
import { parseSync, rawTransferSupported } from 'oxc-parser';
import { digestString as portableDigest } from '@variance-authority/core/format';
import { instrument } from '../dist/instrument/index.js';
import { walkBlocks } from '../dist/instrument/blocks.js';
import { digestString } from '../dist/digest.js';
import { decodeTestCoverage, encodeTestCoverage } from '../dist/test-selection/format.js';
import { mergeCoverage } from '../dist/test-selection/merge.js';
import { ROOT, corpusOf, instrumentedSources, tracked } from './coverage-corpus.mjs';

// The encode of a large index wants more heap than the default ceiling allows,
// and a profiler running beside it wants a little more again.
if (!process.execArgv.some((flag) => flag.startsWith('--max-old-space-size'))) {
  const { status } = spawnSync(
    process.execPath,
    ['--max-old-space-size=16384', fileURLToPath(import.meta.url), ...process.argv.slice(2)],
    { stdio: 'inherit' },
  );
  process.exit(status ?? 1);
}

const MODULES = Number(process.argv[2] ?? 20_000);

/**
 * Self time per stack, bucketed by what the whole chain says the work is.
 *
 * `Profiler` samples at 100 us, which over a stage measured in hundreds of
 * milliseconds is a few thousand samples — enough for a share and not for a
 * ranking of frames within a per cent of each other.
 */
async function profile(run) {
  const session = new Session();
  session.connect();
  await session.post('Profiler.enable');
  await session.post('Profiler.setSamplingInterval', { interval: 100 });
  await session.post('Profiler.start');
  const from = process.hrtime.bigint();
  const answer = run();
  const spent = Number(process.hrtime.bigint() - from) / 1e6;
  const { profile: sampled } = await session.post('Profiler.stop');
  session.disconnect();
  return { spent, split: split(sampled), answer };
}

/** What each bucket is, in the order a reader should meet them. */
const NATIVE = new Set(['brotli', 'SHA-256', 'the parser', 'V8 and the collector']);

function split(profile) {
  const self = new Map();
  for (const [at, id] of profile.samples.entries()) {
    self.set(id, (self.get(id) ?? 0) + (profile.timeDeltas[at] ?? 0));
  }
  const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
  const parent = new Map();
  for (const node of profile.nodes) for (const child of node.children ?? []) parent.set(child, node.id);
  const chain = (id) => {
    const frames = [];
    for (let at = id; at !== undefined; at = parent.get(at)) frames.push(nodes.get(at).callFrame);
    return frames;
  };

  const buckets = new Map();
  let total = 0;
  for (const [id, spent] of self) {
    const frames = chain(id);
    const url = frames[0].url ?? '';
    const name = frames[0].functionName || '';
    const under = (needle) => frames.some((frame) => (frame.url ?? '').includes(needle));
    // The profiler's own `Profiler.stop` runs inside the measured window.
    if (under('node:inspector')) continue;
    let where;
    if (under('node:zlib')) where = 'brotli';
    else if (under('node:internal/crypto')) where = 'SHA-256';
    else if (name === '(garbage collector)') where = 'V8 and the collector';
    else if (name === '(program)' || name === '(idle)' || name === '(root)') where = 'V8 and the collector';
    else if (url.includes('/node_modules/oxc-parser/')) where = "the parser's JavaScript";
    else if (url.includes('/packages/') && !url.includes('/node_modules/')) where = 'ours';
    else if (url.startsWith('node:')) where = 'the Node runtime';
    else if (url === '' && under('/node_modules/oxc-parser/')) where = 'the parser';
    else if (url === '') where = 'V8 and the collector';
    else where = 'ours';
    buckets.set(where, (buckets.get(where) ?? 0) + spent);
    total += spent;
  }
  return { buckets, total };
}

function report(stage, spent, { buckets, total }) {
  const rows = [...buckets].sort((left, right) => right[1] - left[1]);
  const share = (us) => (us / total) * 100;
  const native = rows.filter(([where]) => NATIVE.has(where)).reduce((sum, [, us]) => sum + us, 0);
  console.log(`\n${stage}, ${spent.toFixed(0)} ms`);
  for (const [where, us] of rows) {
    if (share(us) < 0.5) continue;
    console.log(`  ${(us / 1000).toFixed(0).padStart(5)} ms  ${share(us).toFixed(1).padStart(5)}%  ${where}`);
  }
  console.log(
    `  ${'—'.repeat(5)}\n` +
      `  ${share(native).toFixed(1).padStart(12)}%  already native, and out of a rewrite's reach\n` +
      `  ${share(total - native).toFixed(1).padStart(12)}%  JavaScript, which is what one could reclaim`,
  );
}

const { transformSync } = await import(pathToFileURL(join(ROOT, 'node_modules/esbuild/lib/main.js')));
const sources = [];
for (const file of tracked()) {
  try {
    sources.push([file, transformSync(readFileSync(join(ROOT, file), 'utf8'), {
      loader: 'ts',
      format: 'esm',
      target: 'es2022',
    }).code]);
  } catch {
    continue;
  }
}
const bytes = sources.reduce((sum, [, code]) => sum + Buffer.byteLength(code), 0);

const cutting = () => {
  let regions = 0;
  for (const [file, code] of sources) regions += instrument(code, file, file)?.blocks.length ?? 0;
  return regions;
};
cutting();
const cut = await profile(cutting);
console.log(
  `${sources.length} modules, ${(bytes / 1_048_576).toFixed(1)} MB of source, ${cut.answer} regions`,
);
report('instrument', cut.spent, cut.split);

/** Median of five, because a single timing of a 50 ms stage is a coin toss. */
function median(run) {
  const times = [];
  for (let trial = 0; trial < 5; trial += 1) {
    const from = process.hrtime.bigint();
    run();
    times.push(Number(process.hrtime.bigint() - from) / 1e6);
  }
  return times.sort((left, right) => left - right)[2];
}

/**
 * The two places this stage stopped being JavaScript, each still measurable
 * because the path it replaced is still in the tree and still runs.
 *
 * Neither was a rewrite. One is a call to an algorithm the platform already
 * compiled in; the other is an option on a parser this package already had.
 */
const hashed = median(() => {
  for (const [, code] of sources) digestString(code);
});
const portable = median(() => {
  for (const [, code] of sources) portableDigest(code);
});
const probes = { hit: (at) => `__va(${at})`, around: (at) => [`__vaA(${at},`, ')'] };
const walking = (options) => () => {
  for (const [file, code] of sources) walkBlocks(parseSync(file, code, options).program, code, probes);
};
const raw = median(walking({ experimentalRawTransfer: rawTransferSupported() }));
const json = median(walking(undefined));

console.log(
  `\nthe two decisions, over the same ${(bytes / 1_048_576).toFixed(1)} MB\n` +
    `  SHA-256   ${(bytes / 1_048_576 / (portable / 1000)).toFixed(0).padStart(4)} MB/s portable` +
    `   ->  ${(bytes / 1_048_576 / (hashed / 1000)).toFixed(0)} MB/s from node:crypto` +
    `  (${(portable / hashed).toFixed(1)}x)\n` +
    `  transfer  ${json.toFixed(0).padStart(4)} ms serialized   ->  ${raw.toFixed(0)} ms raw` +
    `  (${(json / raw).toFixed(1)}x)`,
);

const built = await instrumentedSources();
const { coverage } = corpusOf(MODULES, built);
const regions = coverage.modules.reduce((sum, module) => sum + module.blocks.length, 0);
console.log(`\n${MODULES} modules, ${regions} regions`);

const encoded = await profile(() => encodeTestCoverage(coverage));
report('encode', encoded.spent, encoded.split);

const decoded = await profile(() => decodeTestCoverage(encoded.answer));
if (decoded.answer.modules.length !== MODULES) throw new Error('decode lost modules');
report('decode', decoded.spent, decoded.split);

// Ten modules re-transpiled and recorded over the index, which is what a build
// that changed ten files out of two hundred thousand hands the reporter.
const recut = coverage.modules.slice(0, 10);
const ran = new Set(recut.flatMap((module) => module.blocks.flatMap((block) => block.testFiles)));
const layer = {
  version: coverage.version,
  instrumentation: coverage.instrumentation,
  commit: 'b'.repeat(40),
  tests: coverage.tests.filter((test) => ran.has(test.file)),
  modules: recut.map((module) => ({
    ...module,
    blocks: module.blocks.map((block) => ({ ...block, testFiles: [...block.testFiles] })),
  })),
};
const layered = await profile(() => mergeCoverage(coverage, layer));
if (layered.answer.modules.length !== MODULES) throw new Error('layering lost modules');
report('layer', layered.spent, layered.split);
