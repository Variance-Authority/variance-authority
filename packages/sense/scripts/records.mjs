#!/usr/bin/env node

/**
 * What a module record costs to write, to keep, and to read back.
 *
 * [ADR-0041](../../../docs/context/adr/0041-a-request-is-the-edge-a-binding-is-the-name.md)
 * measured the same records as JSON going past the 512 MB ceiling
 * `readFile(…, 'utf8')` throws at, and moved the source index to interned strings
 * and dense columns. The module record store is that problem one structure over,
 * at the scale it was rejected for: two hundred thousand modules, ten of which a
 * build actually transformed.
 *
 * Two measurements, and only one of them is synthetic:
 *
 *   size  — every product file in this repository, instrumented for real and the
 *           record built for real, counted both ways. The block counts, the names
 *           and the paths are the ones this source produces, which matters: a
 *           record is mostly strings, and generated strings would answer a
 *           question nobody asked.
 *   scale — `[modules]` records appended through the store's own writer and read
 *           back through its own reader. The records are the ones measured above,
 *           repeated under distinct paths, because what is measured here is the
 *           store and not the parser.
 *
 * The JSON arm writes one file per module and is skipped unless asked for: at the
 * default it costs 1.5 GB of temporary files and most of a minute, which is the
 * finding rather than a cost worth paying on every run.
 *
 * Run:  node scripts/records.mjs
 *       node scripts/records.mjs 200000 --json
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { digestString } from '@variance-authority/core/format';
import { INSTRUMENTATION_ID, instrument } from '../dist/instrument/index.js';
import {
  coverageBlock,
  openRecords,
  readRecords,
  writeRecord,
} from '../dist/test-selection/instrumented-modules.js';
import { frameRecord } from '../dist/test-selection/record-format.js';
import { sourceLines } from '../dist/test-selection/source-lines.js';

const MODULES = Number(process.argv[2] ?? 200_000);
const WITH_JSON = process.argv.includes('--json');
const ASKED = 5_000;

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const mb = (bytes) => bytes / 1_048_576;
const ms = (from, to) => Number(to - from) / 1e6;

// Types stripped the way a bundler strips them before the probes land: this
// transform runs on JavaScript, and handing it TypeScript would measure the
// refusal path instead of the record.
const { transformSync } = await import(pathToFileURL(join(root, 'node_modules/esbuild/lib/main.js')));

const built = [];
for (const file of tracked()) {
  let code;
  try {
    code = transformSync(readFileSync(join(root, file), 'utf8'), {
      loader: 'ts',
      format: 'esm',
      target: 'es2022',
    }).code;
  } catch {
    continue;
  }
  const done = instrument(code, file, built.length);
  if (done === undefined) continue;
  const lineOf = sourceLines(code, undefined, file);
  built.push({
    file,
    id: built.length,
    sourceDigest: digestString(code),
    instrumented: true,
    blocks: done.blocks.map((block) => coverageBlock(code, block, lineOf)),
  });
}

if (built.length === 0) {
  console.log('no product source instrumented; run `yarn build` first');
  process.exit(1);
}

function tracked() {
  return execFileSync('git', ['ls-files', 'packages/*/src/**/*.ts', 'packages/*/src/*.ts'], {
    cwd: root,
    encoding: 'utf8',
  })
    .split('\n')
    .filter((file) => file && !file.endsWith('.test.ts') && !file.endsWith('.d.ts'));
}

/** The same records under distinct paths: the store is what is being measured. */
const pathOf = (index) => `packages/generated-${index}/src/${built[index % built.length].file}`;
const under = (index) => ({ ...built[index % built.length], file: pathOf(index), id: index });

const blocks = built.reduce((sum, module) => sum + module.blocks.length, 0);
const binaryEach = built.reduce((sum, module) => sum + frameRecord(module).byteLength, 0) / built.length;
const jsonEach =
  built.reduce(
    (sum, module) =>
      sum + Buffer.byteLength(JSON.stringify({ version: 1, instrumentation: INSTRUMENTATION_ID, module })),
    0,
  ) / built.length;
// One file per module is one allocation unit per module, whatever the text weighs.
const allocated = Math.ceil(jsonEach / 4096) * 4096;

console.log(
  `\n${built.length} modules of this repository, ${(blocks / built.length).toFixed(1)} blocks each\n` +
    `  binary  ${binaryEach.toFixed(0)} B/module\n` +
    `  json    ${jsonEach.toFixed(0)} B/module, ${allocated} B allocated as a file of its own\n` +
    `  ratio   ${(jsonEach / binaryEach).toFixed(2)}x as text, ${(allocated / binaryEach).toFixed(2)}x on disk\n\n` +
    `at ${MODULES} modules\n` +
    `  binary  ${mb(binaryEach * MODULES).toFixed(0)} MB\n` +
    `  json    ${mb(jsonEach * MODULES).toFixed(0)} MB of text, ${mb(allocated * MODULES).toFixed(0)} MB in ${MODULES} files\n`,
);

const at = mkdtempSync(join(tmpdir(), 'variance-records-'));
try {
  const store = join(at, 'binary');
  const writer = openRecords(store);
  let started = process.hrtime.bigint();
  for (let index = 0; index < MODULES; index += 1) writeRecord(writer, under(index));
  const wrote = ms(started, process.hrtime.bigint());
  const files = readdirSync(store);
  const held = files.reduce((sum, name) => sum + statSync(join(store, name)).size, 0);
  console.log(
    'binary store\n' +
      `  wrote   ${MODULES} records in ${wrote.toFixed(0)} ms (${((wrote * 1000) / MODULES).toFixed(1)} us each)\n` +
      `  holds   ${mb(held).toFixed(0)} MB in ${files.length} file${files.length === 1 ? '' : 's'}`,
  );

  const wanted = [];
  for (let index = 0; index < ASKED; index += 1) wanted.push((index * 37) % MODULES);
  started = process.hrtime.bigint();
  const found = await readRecords([store], wanted);
  console.log(
    `  read    ${found.size} of ${ASKED} records in ${ms(started, process.hrtime.bigint()).toFixed(0)} ms, ` +
      `scanning all ${MODULES} frames\n`,
  );

  if (!WITH_JSON) {
    console.log('json store skipped; pass --json to measure it\n');
  } else {
    // Names and fan-out directories before the clock starts: a store that
    // already exists is the case being measured, not one being created.
    const json = join(at, 'json');
    const names = Array.from({ length: MODULES }, (_, index) => String(index));
    for (const prefix of new Set(names.map((name) => name.slice(-2)))) {
      mkdirSync(join(json, prefix), { recursive: true });
    }
    started = process.hrtime.bigint();
    for (let index = 0; index < MODULES; index += 1) {
      writeFileSync(
        join(json, names[index].slice(-2), `${names[index]}.json`),
        JSON.stringify({ version: 1, instrumentation: INSTRUMENTATION_ID, module: under(index) }),
      );
    }
    const text = ms(started, process.hrtime.bigint());
    console.log(
      'json store\n' +
        `  wrote   ${MODULES} files in ${text.toFixed(0)} ms (${((text * 1000) / MODULES).toFixed(1)} us each), ` +
        `${(text / wrote).toFixed(1)}x the binary store\n`,
    );
  }
} finally {
  rmSync(at, { force: true, recursive: true });
}
