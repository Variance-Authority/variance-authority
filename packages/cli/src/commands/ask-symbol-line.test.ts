import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../bin.fixture.js';
import { mainlineReadRoot, testCoverageFile, writeFetchedMainline } from '@variance-authority/sense/test-selection';
import { main } from '../bin.js';
import { EXIT_CLEAN, EXIT_OPERATOR } from '../exit.js';
import { recorded } from './ask-symbol-line.fixture.js';

/**
 * `variance ask symbol --line`, through the command a person types: the
 * declaration a line ran is the one whose tests are the line's tests.
 *
 * `useSessionId` is declared four times. `page` calls the one in `session.ts`,
 * no test enters the one in `stale.ts`, the one in `constant.ts` is a string, not a function, `header` is rendered by a test that
 * enters none, and `idle` is run by nobody. `format` is declared three times, once as `shout` exported under its name, and all are entered by the same test;
 * `log` is declared twice, one entered by every test. `token` is an arrow
 * whose parameters open below its name, a method of `Store`, and a string
 * above a block that declares an arrow of its name, each entered by `page`'s test.
 */

const cwd = process.cwd();

beforeEach(() => {
  vi.stubEnv('VARIANCE_AUTHORITY_CACHE', mkdtempSync(join(tmpdir(), 'va-symbol-line-cache-')));
});

afterEach(() => {
  process.chdir(cwd);
  vi.unstubAllEnvs();
});

async function run(argv: readonly string[]): Promise<{ code: number; out: string; err: string }> {
  let out = '';
  let err = '';
  const code = await main(argv, { out: (text) => { out += text; }, err: (text) => { err += text; } });
  return { code, out, err };
}

/** Whether `file` still opens for reading, as it does for root whatever its mode. */
function opens(file: string): boolean {
  try {
    readFileSync(file);
    return true;
  } catch {
    return false;
  }
}

describe('variance ask symbol --line', () => {
  it('names the declaration the line called first, those its tests never entered as not run with it, in place order, and a constant as not in the recording', async () => {
    await recorded();

    const answered = await run(['ask', 'symbol', '--name', 'useSessionId', '--line', 'src/page.ts:3']);

    expect([answered.code, answered.err]).toEqual([EXIT_CLEAN, '']);
    expect(answered.out.split('\n').slice(0, 10)).toEqual([
      '`useSessionId` at src/page.ts:3, by the 1 recorded test that ran the line:',
      '',
      'src/session.ts:1  1.00  1 of the 1 test that entered it ran the line',
      '',
      'Not run with it:',
      'src/legacy.ts:1  none of the 1 test that entered it ran the line',
      'src/stale.ts:1  no recorded test entered it',
      '',
      'Not in the recording:',
      'src/constant.ts:1  no recorded function is written at this line',
    ]);
  });

  it('reads each line where the recording ran it, and sets apart a declaration written since', async () => {
    const root = await recorded();
    writeFileSync(join(root, 'src/session.ts'), `// moved down\n\n${readFileSync(join(root, 'src/session.ts'), 'utf8')}`);
    writeFileSync(join(root, 'src/late.ts'), "export function useSessionId(): string {\n  return 'late';\n}\n");
    execFileSync('git', ['add', '.'], { cwd: root });
    execFileSync('git', ['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.com', 'commit', '--quiet', '-m', 'since'], { cwd: root });
    expect(await main(['index'], { out: () => {}, err: () => {} })).toBe(EXIT_CLEAN);

    const answered = await run(['ask', 'symbol', '--name', 'useSessionId', '--line', 'src/page.ts:3']);

    expect([answered.code, answered.err]).toEqual([EXIT_CLEAN, '']);
    expect(answered.out).toContain('src/session.ts:3  1.00  1 of the 1 test that entered it ran the line');
    expect(answered.out).toContain('Written since the recording ran:\nsrc/late.ts:1');
  });

  it('scores nothing when the recording names no commit, and names the declarations as it would without the line', async () => {
    await recorded({ commit: false });

    const answered = await run(['ask', 'symbol', '--name', 'useSessionId', '--line', 'src/page.ts:3']);

    expect([answered.code, answered.err]).toEqual([EXIT_CLEAN, '']);
    expect(answered.out.split('\n')[0]).toBe('The recording cannot place src/page.ts:3: the recording names no commit, so nothing tells the declarations of `useSessionId` apart:');
    expect(answered.out).not.toContain('1.00');
    expect(answered.out).toContain('src/session.ts:1');
    expect(answered.out).toContain('src/legacy.ts:1');
  });

  it('refuses a line it cannot place at the recording\'s commit', async () => {
    await recorded({ commit: 'f'.repeat(40) });

    const answered = await run(['ask', 'symbol', '--name', 'useSessionId', '--line', 'src/page.ts:3']);

    expect([answered.code, answered.err]).toEqual([EXIT_CLEAN, '']);
    expect(answered.out.split('\n')[0]).toBe('The recording cannot place src/page.ts:3: git could not diff it against commit ffffffffffff, so nothing tells the declarations of `useSessionId` apart:');
  });

  it('says a line written since the recording ran tells nothing apart', async () => {
    const root = await recorded();
    writeFileSync(join(root, 'src/fresh.ts'), "import { useSessionId } from './session';\nexport const fresh = (): string => useSessionId();\n");
    execFileSync('git', ['add', '.'], { cwd: root });
    execFileSync('git', ['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.com', 'commit', '--quiet', '-m', 'since'], { cwd: root });
    expect(await main(['index'], { out: () => {}, err: () => {} })).toBe(EXIT_CLEAN);

    const answered = await run(['ask', 'symbol', '--name', 'useSessionId', '--line', 'src/fresh.ts:2']);

    expect([answered.code, answered.err]).toEqual([EXIT_CLEAN, '']);
    expect(answered.out.split('\n')[0]).toBe('The recording cannot place src/fresh.ts:2: the line was written since the recording ran, so nothing tells the declarations of `useSessionId` apart:');
  });

  it('refuses a line outside the checkout', async () => {
    const root = await recorded();

    const answered = await run(['ask', 'symbol', '--name', 'useSessionId', '--line', '../elsewhere.ts:1']);

    expect([answered.code, answered.err]).toEqual([EXIT_CLEAN, '']);
    expect(answered.out.split('\n')[0]).toBe(`The recording cannot place ../elsewhere.ts:1: ../elsewhere.ts is outside the checkout at ${root}, and the recording holds only paths inside it, so nothing tells the declarations of \`useSessionId\` apart:`);
  });

  it('says no recording holds a suite when nothing was recorded', async () => {
    const root = await recorded({ recording: false });

    const answered = await run(['ask', 'symbol', '--name', 'useSessionId', '--line', 'src/page.ts:3']);

    expect([answered.code, answered.err]).toEqual([EXIT_CLEAN, '']);
    expect(answered.out.split('\n')[0]).toBe(`No recording under ${root} holds a suite, so nothing tells the declarations of \`useSessionId\` apart:`);
  });

  it('says the recording does not open, and names the declarations as it would without the line', async (context) => {
    const root = await recorded();
    chmodSync(testCoverageFile(root), 0);
    // A mode of 0 does not stop root, as CI runs: there the file still opens and the case has nothing to say.
    if (opens(testCoverageFile(root))) context.skip();

    const answered = await run(['ask', 'symbol', '--name', 'useSessionId', '--line', 'src/page.ts:3']);

    const at = testCoverageFile(root);
    expect([answered.code, answered.err]).toEqual([EXIT_CLEAN, '']);
    expect(answered.out.split('\n')[0]).toBe(`The recording cannot place src/page.ts:3: the recording at ${at} does not read (EACCES: permission denied, open '${at}'), so nothing tells the declarations of \`useSessionId\` apart:`);
    expect(answered.out).toContain('src/session.ts:1');
  });

  it('reads a suite carried by `share` from the mainline record a fetch kept, when the checkout has no recording of its own', async () => {
    const root = await recorded();
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
    const cache = process.env['VARIANCE_AUTHORITY_CACHE']!;
    const kept = join(mainlineReadRoot(cache, 'unit'), head);
    mkdirSync(kept, { recursive: true });
    copyFileSync(testCoverageFile(root), join(kept, 'coverage.bin'));
    rmSync(testCoverageFile(root));
    await writeFetchedMainline(cache, 'unit', { mainline: 'main', commit: head, fetched: new Date().toISOString() });
    writeFileSync(join(root, 'variance.config.json'), JSON.stringify({ suites: { unit: { kind: 'unit', carry: 'share' } } }));
    execFileSync('git', ['add', '.'], { cwd: root });
    execFileSync('git', ['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.com', 'commit', '--quiet', '-m', 'shared'], { cwd: root });
    expect(await main(['index'], { out: () => {}, err: () => {} })).toBe(EXIT_CLEAN);

    const answered = await run(['ask', 'symbol', '--name', 'useSessionId', '--line', 'src/page.ts:3']);

    expect([answered.code, answered.err]).toEqual([EXIT_CLEAN, '']);
    expect(answered.out.split('\n').slice(0, 3)).toEqual([
      'suite unit: `useSessionId` at src/page.ts:3, by the 1 recorded test that ran the line:',
      '',
      'src/session.ts:1  1.00  1 of the 1 test that entered it ran the line',
    ]);
  });

  it('reads no kept mainline record for a suite whose run handed on a miss, as the other readers do', async () => {
    const root = await recorded();
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
    const cache = process.env['VARIANCE_AUTHORITY_CACHE']!;
    const kept = join(mainlineReadRoot(cache, 'unit'), head);
    mkdirSync(kept, { recursive: true });
    copyFileSync(testCoverageFile(root), join(kept, 'coverage.bin'));
    rmSync(testCoverageFile(root));
    await writeFetchedMainline(cache, 'unit', { mainline: 'main', commit: head, fetched: new Date().toISOString() });
    // The mark `carry hand` leaves for a run that read no record: it names none.
    writeFileSync(join(mainlineReadRoot(cache, 'unit'), 'fetched.json'), `${JSON.stringify({ handed: true })}\n`);
    writeFileSync(join(root, 'variance.config.json'), JSON.stringify({ suites: { unit: { kind: 'unit', carry: 'share' } } }));
    execFileSync('git', ['add', '.'], { cwd: root });
    execFileSync('git', ['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.com', 'commit', '--quiet', '-m', 'shared'], { cwd: root });
    expect(await main(['index'], { out: () => {}, err: () => {} })).toBe(EXIT_CLEAN);

    const answered = await run(['ask', 'symbol', '--name', 'useSessionId', '--line', 'src/page.ts:3']);

    expect(`${answered.out}${answered.err}`).not.toContain('recorded test that ran the line');
  });

  it('refuses a line spelled without its number', async () => {
    await recorded();

    const answered = await run(['ask', 'symbol', '--name', 'useSessionId', '--line', 'src/page.ts']);

    expect(answered.code).toBe(EXIT_OPERATOR);
    expect(answered.err.split('\n')[0]).toBe('`--line` takes `<file>:<line>`, such as `src/page.ts:3`, not `src/page.ts`');
  });

  it('names declarations entered by the same tests as tied, one exported under another name by the function its file names', async () => {
    await recorded();

    const answered = await run(['ask', 'symbol', '--name', 'format', '--line', 'src/use.ts:2']);

    expect([answered.code, answered.err]).toEqual([EXIT_CLEAN, '']);
    expect(answered.out.split('\n').slice(0, 5)).toEqual([
      '`format` at src/use.ts:2, by the 1 recorded test that ran the line:',
      '',
      'src/a.ts:1  1.00 tied  1 of the 1 test that entered it ran the line',
      'src/b.ts:1  1.00 tied  1 of the 1 test that entered it ran the line',
      'src/c.ts:1  1.00 tied  1 of the 1 test that entered it ran the line',
    ]);
  });

  it('says no test ran the line, and names the declarations as it would without it', async () => {
    await recorded();

    const answered = await run(['ask', 'symbol', '--name', 'useSessionId', '--line', 'src/idle.ts:2']);

    expect([answered.code, answered.err]).toEqual([EXIT_CLEAN, '']);
    expect(answered.out.split('\n')[0]).toBe('No recorded test ran src/idle.ts:2, so nothing tells the declarations of `useSessionId` apart:');
    expect(answered.out).toContain('src/session.ts:1');
    expect(answered.out).toContain('src/legacy.ts:1');
  });

  it('ranks a declaration only the line\'s tests entered above one every test entered', async () => {
    await recorded();

    const answered = await run(['ask', 'symbol', '--name', 'log', '--line', 'src/report.ts:2']);

    expect([answered.code, answered.err]).toEqual([EXIT_CLEAN, '']);
    expect(answered.out.split('\n').slice(0, 4)).toEqual([
      '`log` at src/report.ts:2, by the 1 recorded test that ran the line:',
      '',
      'src/quiet.ts:1  1.00  1 of the 1 test that entered it ran the line',
      'src/log.ts:1  0.45  1 of the 5 tests that entered it ran the line',
    ]);
  });

  it('scores a method by its class and an arrow opening below its name, and leaves a constant above a namesake in a block unscored', async () => {
    await recorded();

    const answered = await run(['ask', 'symbol', '--name', 'token', '--line', 'src/page.ts:3']);

    expect([answered.code, answered.err]).toEqual([EXIT_CLEAN, '']);
    expect(answered.out.split('\n').slice(0, 7)).toEqual([
      '`token` at src/page.ts:3, by the 1 recorded test that ran the line:',
      '',
      'src/arrow.ts:1  1.00 tied  1 of the 1 test that entered it ran the line',
      'src/store.ts:2  1.00 tied  1 of the 1 test that entered it ran the line',
      '',
      'Not in the recording:',
      'src/fixed.ts:1  no recorded function is written at this line',
    ]);
  });
});
