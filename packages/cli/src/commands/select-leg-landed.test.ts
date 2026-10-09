import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { digestString } from '@variance-authority/core/format';
import { landRun, testCoverageFile, type TestCoverage } from '@variance-authority/sense/test-selection';
import { indexOutput } from './index-command.js';
import { selectOutput } from './select-command.js';

/**
 * `0-2` and then `3-` as `verify:near` and `verify:far` run them: the near leg
 * lands its run between the two, so the far leg reads another record than the
 * one the near leg was cut from.
 *
 * The landing moves the tests the near leg ran to `HEAD`, and every other test
 * is read from where it last ran, from both texts. That reading charges what
 * the edit wrote with the crossings of the region around it, so it enters a
 * test the near leg's reading did not: one that loaded the edited module and
 * entered none of its functions, one hop from the change.
 */

const NEAR = 'test/near.test.ts';
const LOADER = 'test/loader.test.ts';
const MID = 'test/mid.test.ts';
const FAR = 'test/far.test.ts';
const IDLE = 'test/idle.test.ts';
const WHOLE = [FAR, IDLE, LOADER, MID, NEAR];

describe('a leg cut after an earlier leg landed', () => {
  const cwd = process.cwd();

  beforeEach(() => {
    process.env['VARIANCE_AUTHORITY_CACHE'] = mkdtempSync(join(tmpdir(), 'va-select-landed-cache-'));
  });

  afterEach(() => {
    process.chdir(cwd);
    delete process.env['VARIANCE_AUTHORITY_CACHE'];
  });

  it('runs in `3-` every selected test the `0-2` landed before it left unrun', async () => {
    const { root, git } = checkout();
    const before = git(['rev-parse', 'HEAD']);
    await landRun(testCoverageFile(root), recorded(before, WIDGET), root);
    writeFileSync(join(root, 'src/widget.ts'), EDITED);
    git(['commit', '--quiet', '-am', 'the edit both legs read']);
    const head = git(['rev-parse', 'HEAD']);
    process.chdir(root);
    await indexOutput({ cwd: root });

    const leg = async (from: number, to: number) =>
      JSON.parse((await selectOutput({ cwd: root, format: 'json', atDistance: { from, to } })).out);
    const near = await leg(0, 2);
    const nearRan = WHOLE.filter((test) => !near.skip.includes(test));
    // The near leg runs, and its run lands at `HEAD` over the edited text.
    const ran = recorded(head, EDITED);
    await landRun(testCoverageFile(root), {
      ...ran,
      tests: ran.tests.filter((test) => nearRan.includes(test.file)),
      modules: ran.modules.map((module) => ({
        ...module,
        blocks: module.blocks.map((block) => ({ ...block, testFiles: block.testFiles.filter((test) => nearRan.includes(test)) })),
      })),
    }, root);
    await indexOutput({ cwd: root });
    const far = await leg(3, Number.MAX_SAFE_INTEGER);
    const farRan = WHOLE.filter((test) => !far.skip.includes(test));

    expect(nearRan).toEqual([MID, NEAR]);
    // The far leg's reading places the loader one hop out, which the near leg never ran.
    expect(far.distances).toContainEqual(expect.objectContaining({ test: LOADER, hops: 1 }));
    expect(farRan).toEqual([FAR, LOADER]);
    expect(far.notes).toContain(
      '1 selected test file nearer than 3 hops runs in this leg: it last ran before HEAD, and the run that landed at HEAD did not run it',
    );
    expect([...nearRan, ...farRan].sort()).toEqual([FAR, LOADER, MID, NEAR]);
  });

  it('cuts `3-` by hops alone when no leg has landed at `HEAD`', async () => {
    const { root, git } = checkout();
    await landRun(testCoverageFile(root), recorded(git(['rev-parse', 'HEAD']), WIDGET), root);
    writeFileSync(join(root, 'src/widget.ts'), EDITED);
    git(['commit', '--quiet', '-am', 'the edit both legs read']);
    process.chdir(root);
    await indexOutput({ cwd: root });

    const far = JSON.parse((await selectOutput({ cwd: root, format: 'json', atDistance: { from: 3, to: Number.MAX_SAFE_INTEGER } })).out);

    expect(WHOLE.filter((test) => !far.skip.includes(test))).toEqual([FAR]);
  });
});

/** `widget` and `other`; the edit changes `widget` and writes a `helper` it calls. */
const WIDGET = [
  'export function widget(): string {',
  "  return 'a';",
  '}',
  '',
  'export function other(): string {',
  "  return 'b';",
  '}',
  '',
].join('\n');
const EDITED = [
  'export function widget(): string {',
  '  return helper();',
  '}',
  '',
  'function helper(): string {',
  "  return 'z';",
  '}',
  '',
  'export function other(): string {',
  "  return 'b';",
  '}',
  '',
].join('\n');
const CALLER = ["import { widget } from './widget';", 'export const caller = (): string => widget();', ''].join('\n');
const OUTER = ["import { caller } from './caller';", 'export const outer = (): string => caller();', ''].join('\n');

/** A widget, a caller of it and a caller of that; a test of each, a test that only loads the widget, and one that loads nothing. */
function checkout(): { root: string; git: (args: readonly string[]) => string } {
  const root = mkdtempSync(join(tmpdir(), 'va-select-landed-'));
  const git = (args: readonly string[]): string => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  git(['init', '--quiet', '--initial-branch', 'main']);
  git(['config', 'user.email', 'fixture@example.test']);
  git(['config', 'user.name', 'Fixture']);
  const files: Record<string, string> = {
    'src/widget.ts': WIDGET,
    'src/caller.ts': CALLER,
    'src/outer.ts': OUTER,
    [NEAR]: "import { widget } from '../src/widget';\nwidget();\n",
    [LOADER]: "import '../src/widget';\n",
    [MID]: "import { caller } from '../src/caller';\ncaller();\n",
    [FAR]: "import { outer } from '../src/outer';\nouter();\n",
    [IDLE]: 'export {};\n',
  };
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(join(root, file, '..'), { recursive: true });
    writeFileSync(join(root, file), text);
  }
  git(['add', '-A']);
  git(['commit', '--quiet', '-m', 'the text these line numbers are coordinates in']);
  return { root, git };
}

/** What a whole run over `widget` records at `commit`: every test, and the regions each entered. */
function recorded(commit: string, widget: string): TestCoverage {
  const callers = [FAR, MID, NEAR];
  const region = (startLine: number, endLine: number, testFiles: readonly string[]) => ({ source: true, startLine, endLine, testFiles: [...testFiles] });
  const fn = (ordinal: number, name: string, startLine: number, endLine: number, testFiles: readonly string[]) => ({
    ...region(startLine, endLine, testFiles), ordinal, kind: 'function' as const, owner: 0, digest: digestString(name), name, path: name,
  });
  const edited = widget === EDITED;
  const lines = widget.split('\n').length - 1;
  return {
    version: 3,
    instrumentation: 'fixture',
    commit,
    tests: WHOLE.map((file) => ({ file, complete: true, preconditions: [] })),
    modules: [
      {
        file: 'src/widget.ts',
        sourceDigest: digestString(widget),
        instrumented: true,
        blocks: [
          { ...region(1, lines, [...callers, LOADER]), ordinal: 0, kind: 'module', digest: digestString(`module${edited ? ', edited' : ''}`), name: 'src/widget.ts', path: 'module' },
          fn(1, 'widget', 1, 3, callers),
          ...(edited ? [fn(2, 'helper', 5, 7, callers), fn(3, 'other', 9, 11, [])] : [fn(2, 'other', 5, 7, [])]),
        ],
      },
      moduleOf('src/caller.ts', CALLER, [FAR, MID]),
      moduleOf('src/outer.ts', OUTER, [FAR]),
    ],
  };
}

function moduleOf(file: string, text: string, testFiles: readonly string[]): TestCoverage['modules'][number] {
  return {
    file,
    sourceDigest: digestString(text),
    instrumented: true,
    blocks: [{ source: true, startLine: 1, endLine: text.split('\n').length - 1, testFiles: [...testFiles], ordinal: 0, kind: 'module', digest: digestString(file), name: file, path: 'module' }],
  };
}
