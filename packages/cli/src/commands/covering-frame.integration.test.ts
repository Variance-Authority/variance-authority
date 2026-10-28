import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { updateSourceIndex } from '@variance-authority/sense';
import { declaredSuites, testCoverageFile } from '@variance-authority/sense/test-selection';
import { readFlags } from '../args.js';
import { parseCoveringArgs } from '../covering-args.js';
import { flagsFor, synopsisFor } from '../usage.js';
import { covering, formatCovering } from './covering.js';

// A suite recorded through the real Vitest seam, into a cache of its own, so
// the snapshot beside the index holds the digest the frame is checked against.
// The index is published the way a pipeline publishes it: under CI a reader
// refuses to build one on demand.
const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, '../../../..');
const fixture = resolve(repository, 'packages/sense/test/fixtures/cases-vitest');
const source = 'packages/sense/test/fixtures/cases-vitest/src/decide.ts';
const cases = 'packages/sense/test/fixtures/cases-vitest';
// The repository's root declares its suites, so the fixture records as the
// first of them and every question names it.
const suite = declaredSuites(repository)?.[0]?.name;
const named = suite === undefined ? [] : ['--suite', suite];
let cache: string;
let previous: string | undefined;

beforeAll(async () => {
  cache = await mkdtemp(join(tmpdir(), 'variance-covering-frame-'));
  previous = process.env['VARIANCE_AUTHORITY_CACHE'];
  process.env['VARIANCE_AUTHORITY_CACHE'] = cache;
  await promisify(execFile)(
    process.execPath,
    [resolve(repository, 'node_modules/vitest/vitest.mjs'), 'run', '--config', resolve(fixture, 'vitest.config.ts')],
    { cwd: repository, env: { ...process.env, VARIANCE_AUTHORITY_COVERAGE: testCoverageFile(repository, { suite }) } },
  );
  await updateSourceIndex(repository);
}, 60_000);

afterAll(async () => {
  if (previous === undefined) delete process.env['VARIANCE_AUTHORITY_CACHE'];
  else process.env['VARIANCE_AUTHORITY_CACHE'] = previous;
  await rm(cache, { recursive: true, force: true });
});

function parse(argv: readonly string[]) {
  return parseCoveringArgs(readFlags(argv, 'covering', flagsFor('covering'), synopsisFor('covering')));
}

/** The fixture's text with two lines written above it, as an editor would hold it unsaved. */
async function edited(): Promise<string> {
  const held = join(cache, 'held.ts');
  await writeFile(held, `// one\n// two\n${await readFile(resolve(repository, source), 'utf8')}`);
  return held;
}

describe('a file answered in the text somebody holds', () => {
  it('stands in the recorded frame when the file is the text the suite ran over', async () => {
    const answer = await covering(parse(['--file', source, '--root', repository, ...named]));

    expect(answer.frame).toBe('recorded');
    expect(answer.ranges?.slice(0, 2).map((range) => [range.startLine, range.endLine, range.state]))
      .toEqual([[1, 1, 'walked'], [2, 2, 'walked']]);
  });

  it('carries every range to where it stands in an edited text', async () => {
    const answer = await covering(parse(['--file', source, '--root', repository, ...named, '--text', await edited()]));

    expect(answer.frame).toBe('mapped');
    expect(answer.ranges?.slice(0, 2).map((range) => [range.startLine, range.endLine, range.state]))
      .toEqual([[3, 3, 'walked'], [4, 4, 'walked']]);
    expect(formatCovering(answer, 'text')).toContain('placed in the text as it is now');
  });

  it('asks a held line as the line it was, answers that the edit wrote one, and names the run that answers it now', async () => {
    const held = await edited();
    const answer = await covering(parse(['--file', source, '--root', repository, ...named, '--text', held, '--line', '7']));

    // Held line 7 is `if (value === 'gamma') {`: the case that fell through evaluated it too.
    expect(answer.tests?.map((test) => test.name)).toEqual(['decide > falls through to B', 'decide > takes the gamma branch']);
    expect(answer.target).toEqual({ line: 7 });
    const written = await covering(parse(['--file', source, '--root', repository, ...named, '--text', held, '--line', '1']));
    expect(written).toMatchObject({ target: { line: 1 }, tests: [], written: [{ startLine: 1, endLine: 1 }] });
    expect(formatCovering(written, 'text')).toBe(`Line 1 of ${source} was written since the recording, so no case has run it.\n` +
      `Gap (stale) on line 1 of ${source}: which tests run it now. Known: line 1 was written since the recording.\nNext, Record, 5 tests in 2 test files:\n  Run with the suite's own runner: ${cases}/test/branch.case.ts ${cases}/test/concurrent.case.ts\n`);
  });

  it('answers a held run of lines from the lines it was, and names the lines the edit wrote', async () => {
    const held = await edited();
    const answer = await covering(parse(['--file', source, '--root', repository, ...named, '--text', held, '--line', '1-7']));

    // Held lines 3-7 are recorded lines 1-5, which every case of `decide` walked into.
    expect(answer.target).toEqual({ lines: { startLine: 1, endLine: 7 } });
    expect(answer.written).toEqual([{ startLine: 1, endLine: 2 }]);
    expect(answer.tests?.map((test) => test.name)).toEqual(
      (await covering(parse(['--file', source, '--root', repository, ...named, '--line', '1-5']))).tests?.map((test) => test.name),
    );
    expect(formatCovering(answer, 'text')).toContain('Lines 1-2 were written since the recording, so no case has run them.');
    expect(formatCovering(answer, 'refs')).toContain('; written since 1-2');
    const written = await covering(parse(['--file', source, '--root', repository, ...named, '--text', held, '--line', '1-2']));
    expect(written).toMatchObject({ tests: [], written: [{ startLine: 1, endLine: 2 }] });
    expect(formatCovering(written, 'text')).toBe(`Lines 1-2 of ${source} were written since the recording, so no case has run them.\n` +
      `Gap (stale) on lines 1-2 of ${source}: which tests run it now. Known: lines 1-2 were written since the recording.\nNext, Record, 5 tests in 2 test files:\n  Run with the suite's own runner: ${cases}/test/branch.case.ts ${cases}/test/concurrent.case.ts\n`);
    expect(formatCovering(written, 'refs')).not.toMatch(/[Rr]un the suite/);
  });
});

describe('import hops beside a run of lines or a scope', () => {
  // Every case of `decide` entered its first line, so measuring from that line
  // and measuring from the file give each test file the same hops.
  const hopsOf = async (...argv: string[]) =>
    (await covering(parse(['--file', source, '--root', repository, ...named, ...argv, '--hops']))).files?.map((file) => [file.file, file.hops]);

  it('measures a run of lines from the file', async () => {
    const hops = await hopsOf('--line', '1-5');

    expect(hops?.length).toBeGreaterThan(0);
    expect(hops?.every(([, distance]) => typeof distance === 'number')).toBe(true);
    expect(hops).toEqual(await hopsOf('--line', '1'));
  }, 60_000);

  it('measures a scope from the file', async () => {
    // Line 1 opens `decide`, so it also lists the file's loaders: the scope lists fewer files, at the same hops.
    const scoped = await hopsOf('--function', 'decide');
    const fromLine = new Map(await hopsOf('--line', '1'));

    expect(scoped?.length).toBeGreaterThan(0);
    for (const [file, distance] of scoped ?? []) {
      expect(typeof distance).toBe('number');
      expect(distance).toBe(fromLine.get(file));
    }
  }, 60_000);
});
