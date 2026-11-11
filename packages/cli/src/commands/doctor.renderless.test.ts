import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { testCoverageFile } from '@variance-authority/sense/test-selection';
import { describe, expect, it } from 'vitest';
import '../bin.fixture.js';
import { main } from '../bin.js';
import { RENDER_SETTINGS } from '../config-settings.js';

/**
 * `doctor` on a file that renders nothing, which the schema allows: such a file
 * names none of the five render settings. Through `main`, because the question
 * is what reaches the operator, and the refusal it replaces came from `dispatch`
 * reading the file before it reached the command.
 */

/** Run `variance doctor` on a config holding `settings`, in a repository of its own. */
function doctorOn(settings: unknown, ...flags: string[]) {
  return doctorIn('.', settings, ...flags);
}

/** The same, with the config in `directory` of that repository. A string is the file's text. */
function doctorIn(directory: string, settings: unknown, ...flags: string[]) {
  return doctorAfter(async () => {}, directory, settings, ...flags);
}

/** {@link doctorIn} once `seed` has laid what a run would have left in the repository. */
async function doctorAfter(seed: (root: string) => Promise<void>, directory: string, settings: unknown, ...flags: string[]) {
  const root = await mkdtemp(join(tmpdir(), 'variance-renderless-'));
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  const at = join(root, directory);
  await mkdir(at, { recursive: true });
  const file = join(at, 'variance.config.json');
  await writeFile(file, typeof settings === 'string' ? settings : JSON.stringify(settings));
  await seed(root);

  let out = '';
  let err = '';
  const code = await main(['doctor', '--config', file, ...flags], {
    out: (text) => {
      out += text;
    },
    err: (text) => {
      err += text;
    },
  });
  return { code, out, err };
}

describe('doctor on a config that renders nothing', () => {
  it('exits clean and says the renderer was not checked, and why', async () => {
    const { code, out } = await doctorOn({ suites: { unit: { kind: 'unit' } } });

    expect(code).toBe(0);
    expect(out).toContain('renderer: not checked');
    expect(out).toContain('names none of project, profile, viewport, retention and subjects');
  });

  it('answers the repository half and prints nothing of the render half', async () => {
    const { out } = await doctorOn({ suites: { unit: { kind: 'unit' } } });

    expect(out).toMatch(/^cache: /m);
    expect(out).toMatch(/^skills: /m);
    expect(out).toMatch(/^typescript: /m);
    expect(out).not.toMatch(/^(profile|fonts|baselines|renders|history): /m);
  });

  it('tells the two kinds of file apart by the settings the schema ties together', async () => {
    const schema = JSON.parse(await readFile(new URL('../../schema/variance.config.schema.json', import.meta.url), 'utf8'));

    expect([...RENDER_SETTINGS].sort()).toEqual(Object.keys(schema.dependentRequired).sort());
  });

  it('reads an empty file as one that renders nothing', async () => {
    const { code, out } = await doctorOn({});

    expect(code).toBe(0);
    expect(out).toContain('renderer: not checked');
  });

  it('names a declared suite no run has recorded, says what writes its record, and exits clean', async () => {
    const { code, out } = await doctorOn({ suites: { unit: { kind: 'unit' } } });

    expect(code).toBe(0);
    expect(out).toMatch(/^suites: 1 declared in the root variance\.config\.json$/m);
    expect(out).toContain('unit (unit): not recorded yet');
    expect(out).toContain('`withTestSelection`');
  });

  it('names the record a suite has in this checkout, and its file', async () => {
    let record = '';
    const { code, out } = await doctorAfter(
      async (root) => {
        record = testCoverageFile(root, { suite: 'unit' });
        await mkdir(dirname(record), { recursive: true });
        await writeFile(record, '{}');
      },
      '.',
      { suites: { unit: { kind: 'unit' } } },
    );

    expect(code).toBe(0);
    expect(out).toContain('unit (unit): recorded in this checkout');
    expect(out).toContain(record);
  });

  it('prints no suites section for a file that declares none', async () => {
    const { out } = await doctorOn({});

    expect(out).not.toMatch(/^suites: /m);
  });

  it('refuses a file that is not JSON', async () => {
    const { code, err } = await doctorOn('{ "suites": ');

    expect(code).toBe(2);
    expect(err).toContain('is not valid JSON');
  });

  it('refuses a misspelled setting by name', async () => {
    const { code, err } = await doctorOn({ suits: {} });

    expect(code).toBe(2);
    expect(err).toContain('`suits` is not a setting this tool has');
  });

  it.each([
    ['suites', { unit: { kind: 'unit' } }],
    ['cacheRoot', 'elsewhere'],
    ['tiers', [200000, 1000]],
  ])('refuses `%s` in a member file, which only the root may declare', async (setting, value) => {
    const { code, err } = await doctorIn('packages/app', { [setting]: value });

    expect(code).toBe(2);
    expect(err).toContain(`\`${setting}\` is read from the variance.config.json at the repository root`);
  });

  it.each([
    ['suites', { suites: 'not an object' }],
    ['browser', { browser: 'netscape' }],
    ['concurrency', { concurrency: -3 }],
    ['baselines', { baselines: { bucket: 1 } }],
  ])('refuses a malformed `%s`, as it would beside the render settings', async (setting, settings) => {
    const { code, err } = await doctorOn(settings);

    expect(code).toBe(2);
    expect(err).toContain(setting);
  });

  it('holds a suite to the root file it carries to', async () => {
    const { code, err } = await doctorOn({ suites: { unit: { kind: 'unit', carry: 'share' } } });

    expect(code).toBe(2);
    expect(err).toContain('share');
  });

  it('refuses a file naming some of the render settings, as every other command does', async () => {
    const { code, err } = await doctorOn({ project: 'site' });

    expect(code).toBe(2);
    expect(err).toContain('`profile` must be a string');
  });

  it('leaves `--baselines` refusing, since it has only the render half to answer', async () => {
    const { code, err } = await doctorOn({}, '--baselines');

    expect(code).toBe(2);
    expect(err).toContain('`profile` must be a string');
  });
});
