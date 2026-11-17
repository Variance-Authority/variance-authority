import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { preconditionEntries, rstest } from './__fixtures__/precondition-entries.js';

// An entry a project declares for itself is read only when that project has a
// test file in the run, and a project `--project` left out is not read at all.
const { fixture, refusedAlike, finished, ran } = preconditionEntries();

describe('a project declares its own entry', () => {
  const projects: Readonly<Record<string, readonly string[]>> = {
    Vitest: refusedAlike['Vitest with projects']!,
    Rstest: refusedAlike['Rstest with projects']!,
  };

  it.each(Object.keys(projects))('%s refuses it when that project runs', async (runner) => {
    const { code, output } = await finished([...projects[runner]!, '--project', 'two'], [], { FIXTURE_PROJECT_PRECONDITIONS: '["src"]' });

    expect(output).toContain(`names ${resolve(fixture, 'src')}, which`);
    expect(code).not.toBe(0);
    expect(existsSync(ran())).toBe(false);
  }, 120_000);

  it.each(Object.keys(projects))('%s reads nothing of a project --project left out', async (runner) => {
    const { code, output } = await finished([...projects[runner]!, '--project', 'one'], [], { FIXTURE_PROJECT_PRECONDITIONS: '["src"]' });

    expect(output).not.toContain('cannot be read as a file');
    expect(code).toBe(0);
    expect(existsSync(ran())).toBe(true);
  }, 120_000);

  it.each(Object.keys(projects))('%s reads nothing of a project with no test file in the run', async (runner) => {
    const { code, output } = await finished([...projects[runner]!], [], {
      FIXTURE_PROJECT_PRECONDITIONS: '["missing.json"]',
      FIXTURE_TWO_INCLUDE: 'test/no-such*.check.ts',
    });

    expect(output).not.toContain('missing.json');
    expect(code).toBe(0);
    expect(existsSync(ran())).toBe(true);
  }, 120_000);

  it.each(Object.keys(projects))('%s refuses what the root declares, when any project has a test file in the run', async (runner) => {
    const { code, output } = await finished([...projects[runner]!], ['src'], { FIXTURE_TWO_INCLUDE: 'test/no-such*.check.ts' });

    expect(output).toContain(`names ${resolve(fixture, 'src')}, which`);
    expect(code).not.toBe(0);
    expect(existsSync(ran())).toBe(false);
  }, 120_000);
});

describe('a project nobody wrapped, under a wrapped configuration', () => {
  const plain = [rstest, 'run', '-c', resolve(fixture, 'rstest.plain.config.mjs')];

  it.each([
    ['beside a wrapped project', plain],
    ['with the wrapped project left out', [...plain, '--project', 'plain']],
  ])('refuses the configuration\'s entry before any test, %s', async (_, command) => {
    const { code, output } = await finished(command, ['missing.json']);

    expect(output).toContain('cannot be read as a file');
    expect(output).not.toContain('could not be read');
    expect(code).not.toBe(0);
    expect(existsSync(ran())).toBe(false);
  }, 120_000);

  it('is not blocked by the entry of a project left out', async () => {
    const { code, output } = await finished([...plain, '--project', 'plain'], [], { FIXTURE_PROJECT_PRECONDITIONS: '["missing.json"]' });

    expect(output).not.toContain('read');
    expect(code).toBe(0);
    expect(existsSync(ran())).toBe(true);
  }, 120_000);

  it('is not blocked by the entry of a project with no test file', async () => {
    const { code } = await finished(plain, [], { FIXTURE_PROJECT_PRECONDITIONS: '["missing.json"]', FIXTURE_TWO_INCLUDE: 'test/no-such-*.ts' });

    expect(code).toBe(0);
    expect(existsSync(ran())).toBe(true);
  }, 120_000);

  it('refuses nothing with no test to run', async () => {
    const { code, output } = await finished([...plain, '--passWithNoTests', 'no-such-test'], ['missing.json']);

    expect(output).not.toContain('cannot be read as a file');
    expect(code).toBe(0);
  }, 120_000);
});

it('a run of only a project a path names refuses an entry when its tests end, as nothing reaches it before', async () => {
  const { code, output } = await finished([rstest, 'run', '-c', resolve(fixture, 'rstest.path.config.mjs')], ['missing.json']);

  expect(output).toContain(`names ${resolve(fixture, 'missing.json')}, which`);
  expect(code).not.toBe(0);
}, 120_000);

it('a run of only a project a path names says it recorded nothing, as no plugin of the seam reached it', async () => {
  const { code, output } = await finished([rstest, 'run', '-c', resolve(fixture, 'rstest.path.config.mjs')], []);

  expect(output).toContain('this run recorded no coverage, so it narrows no later selection');
  expect(code).toBe(0);
}, 120_000);
