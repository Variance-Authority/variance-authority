import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testCoverageFile } from '@variance-authority/sense/test-selection';
import { readFlags } from '../args.js';
import { parseCoveringArgs } from '../covering-args.js';
import { flagsFor, synopsisFor } from '../usage.js';
import { covering, formatCovering } from './covering.js';

// A suite recorded through the real Vitest seam, into a cache of its own, so
// the snapshot beside the index holds the digest the frame is checked against.
const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, '../../../..');
const fixture = resolve(repository, 'packages/sense/test/fixtures/cases-vitest');
const source = 'packages/sense/test/fixtures/cases-vitest/src/decide.ts';
let cache: string;
let previous: string | undefined;

beforeAll(async () => {
  cache = await mkdtemp(join(tmpdir(), 'variance-covering-frame-'));
  previous = process.env['XDG_CACHE_HOME'];
  process.env['XDG_CACHE_HOME'] = cache;
  await promisify(execFile)(
    process.execPath,
    [resolve(repository, 'node_modules/vitest/vitest.mjs'), 'run', '--config', resolve(fixture, 'vitest.config.ts')],
    { cwd: repository, env: { ...process.env, VARIANCE_AUTHORITY_COVERAGE: testCoverageFile(repository) } },
  );
}, 60_000);

afterAll(async () => {
  if (previous === undefined) delete process.env['XDG_CACHE_HOME'];
  else process.env['XDG_CACHE_HOME'] = previous;
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
    const answer = await covering(parse(['--file', source, '--root', repository]));

    expect(answer.frame).toBe('recorded');
    expect(answer.ranges?.slice(0, 2).map((range) => [range.startLine, range.endLine, range.state]))
      .toEqual([[1, 1, 'walked'], [2, 4, 'alone']]);
  });

  it('carries every range to where it stands in an edited text', async () => {
    const answer = await covering(parse(['--file', source, '--root', repository, '--text', await edited()]));

    expect(answer.frame).toBe('mapped');
    expect(answer.ranges?.slice(0, 2).map((range) => [range.startLine, range.endLine, range.state]))
      .toEqual([[3, 3, 'walked'], [4, 6, 'alone']]);
    expect(formatCovering(answer, 'text')).toContain('placed in the text as it is now');
  });

  it('asks a held line as the line it was, and refuses one the edit wrote', async () => {
    const held = await edited();
    const answer = await covering(parse(['--file', source, '--root', repository, '--text', held, '--line', '7']));

    expect(answer.tests?.map((test) => test.name)).toEqual(['decide > takes the gamma branch']);
    expect(answer.target).toEqual({ line: 7 });
    await expect(covering(parse(['--file', source, '--root', repository, '--text', held, '--line', '1'])))
      .rejects.toThrow(/written since the recording/);
  });
});
