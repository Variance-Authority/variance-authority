import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { updateSourceIndex } from '@variance-authority/sense';
import { distillFiles, distillPieces } from './distill.js';

/** The text the CLI writes for a distillation, joined. */
const written = (...args: Parameters<typeof distillPieces>): string => [...distillPieces(...args)].join('');

// A test file recorded through the real Jest seam, whose imports reach three
// distances from it: one it writes itself, two its subject writes (one read only
// in a function no case runs, one read at load), and one a
// module its subject imports writes.
const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, '../../../..');
const at = 'packages/sense/test/fixtures/jest-prune';
const fixture = resolve(repository, at);
let cache: string;
let previous: string | undefined;
let text: string;

beforeAll(async () => {
  cache = await mkdtemp(join(tmpdir(), 'variance-distill-jest-'));
  previous = process.env['VARIANCE_AUTHORITY_CACHE'];
  process.env['VARIANCE_AUTHORITY_CACHE'] = cache;
  const execution = join(cache, 'coverage.bin');
  await promisify(execFile)(
    process.execPath,
    [resolve(repository, 'node_modules/jest/bin/jest.js'), '--config', resolve(fixture, 'jest.config.mjs'), '--watchman=false'],
    { cwd: fixture, env: { ...process.env, VARIANCE_AUTHORITY_COVERAGE: execution, VARIANCE_AUTHORITY_JEST_CACHE: join(cache, 'jest') } },
  );
  await updateSourceIndex(repository);
  text = written(await distillFiles({ file: `${at}/test/dialog.case.ts`, execution, root: repository }), 'text');
}, 60_000);

afterAll(async () => {
  if (previous === undefined) delete process.env['VARIANCE_AUTHORITY_CACHE'];
  else process.env['VARIANCE_AUTHORITY_CACHE'] = previous;
  await rm(cache, { recursive: true, force: true });
});

describe('an import no case of a Jest test file needs, by how far from the file its importer is', () => {
  it('is an error the test file fixes when the test file writes it', () => {
    expect(text).toContain(`error: ${at}/test/dialog.case.ts imports ${at}/src/strings.ts, and none of its cases enters what that loads.`);
  });

  it('is mocked in the test file when the test file\'s subject reads it only in a function no case runs', () => {
    expect(text).toContain(
      `Or mock ${at}/src/editor.ts in this file, so ${at}/src/dialog.ts does not load it: ` +
        'stand a function in for each value it exports (edit, format); an automock loads the module to read its shape.',
    );
    // A Jest test file, and still no runner's call: the reader writes the mock for the file's runner.
    expect(text).not.toMatch(/\b(?:jest|vi|sb)\.(?:mock|doMock|unstable_mockModule|fn)\b|\bmock\.module\b/);
  });

  it('is fixed in the subject, not mocked, when the subject reads it when it loads', () => {
    // A stand-in read at load is kept for whatever reads `handlers` later.
    expect(text).toContain(`${at}/src/dialog.ts reads fallback from ${at}/src/fallback.ts at line 14 when it loads`);
    expect(text).not.toContain(`Or mock ${at}/src/fallback.ts`);
  });

  it('is a warning to fix where it is written when a module further away writes it', () => {
    expect(text).toContain(`${at}/src/confirm.ts reads ${at}/src/format.ts only in padded (line 6), which no case of this file ran`);
    expect(text).toContain(`warning: this file does not import ${at}/src/confirm.ts; mocking ${at}/src/format.ts here would tie it to code it does not know`);
    expect(text).not.toContain(`Or mock ${at}/src/format.ts`);
  });
});
