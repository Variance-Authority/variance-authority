import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { digestString } from '@variance-authority/core/format';
import { updateSourceIndex } from '@variance-authority/sense';
import { commitRunsFile, encodeAsSetExecutionIndex, testCoverageFile, writeTestCoverage } from '@variance-authority/sense/test-selection';
import { oneRun } from './covering-record.fixture.js';
import { story } from './story.js';
import { explainedCase, formatExplained, type Explained } from './story-explain.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const SPEC = ['import { it } from "vitest";', '', 'it("clicks", async () => {', '  render(page);', '', '  await click(button);', '});', ''].join('\n');
const git = (root: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: root, encoding: 'utf8', stdio: 'pipe' }).trim();

/**
 * A checkout whose record holds `clicks` of `test/page.spec.ts`, timed at lines 6 and 4, written at the commit that holds the spec as {@link SPEC},
 * with a runs record that says the case ran there — unless `ran` is false.
 */
async function checkout(ran = true): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'variance-authority-explain-'));
  roots.push(root);
  await mkdir(join(root, 'test'));
  await writeFile(join(root, 'test/page.spec.ts'), SPEC);
  git(root, 'init', '-q');
  git(root, 'add', '.');
  git(root, 'commit', '-qm', 'spec');
  // Under CI nothing builds the source index implicitly; the fixture publishes it, as the pipeline's `variance index` step does.
  await updateSourceIndex(root);
  const tests = [{ id: 'test/page.spec.ts > clicks', file: 'test/page.spec.ts', name: 'clicks', duration: 10, times: [{ line: 6, time: 400 }, { line: 4, time: 8000 }] }];
  await writeTestCoverage(testCoverageFile(root), { version: 3, instrumentation: 'fixture', commit: git(root, 'rev-parse', 'HEAD'), tests: [], modules: [] }, {
    index: encodeAsSetExecutionIndex({ tests, modules: [] }),
  });
  if (ran) {
    await writeFile(commitRunsFile(testCoverageFile(root)), JSON.stringify({ commit: git(root, 'rev-parse', 'HEAD'), ...oneRun(new Date().toISOString(), ['test/page.spec.ts']) }));
  }
  return root;
}

describe('explainedCase', () => {
  it('explains a case no story is taped of from the record, each statement with its source text and its share of the case', async () => {
    const root = await checkout();

    const answer = await explainedCase(root, [], 'clicks', undefined);

    expect(answer?.explained).toMatchObject({
      file: 'test/page.spec.ts',
      name: 'clicks',
      moved: false,
      statements: [
        { line: 6, time: 400, share: 4, text: 'await click(button);' },
        { line: 4, time: 8000, share: 80, text: 'render(page);' },
      ],
    });
  });

  it('says a line may have moved when the test file changed since its run', async () => {
    const root = await checkout();
    await writeFile(join(root, 'test/page.spec.ts'), `// a line above\n${SPEC}`);

    expect((await explainedCase(root, [], 'clicks', undefined))?.explained.moved).toBe(true);
  });

  it('says the test file did not move when it was edited before its run and is the text it ran over, uncommitted', async () => {
    const root = await checkout(false);
    const edited = `// a line above\n${SPEC}`;
    await writeFile(join(root, 'test/page.spec.ts'), edited);
    await writeFile(commitRunsFile(testCoverageFile(root)), JSON.stringify({
      commit: git(root, 'rev-parse', 'HEAD'),
      ...oneRun(new Date().toISOString(), ['test/page.spec.ts'], { 'test/page.spec.ts': digestString(edited) }),
    }));

    expect((await explainedCase(root, [], 'clicks', undefined))?.explained.moved).toBe(false);
  });

  it('reads the test file against the commit its newest run stood at, not the record\'s, so a run carried over from an earlier text has moved', async () => {
    const root = await checkout();
    await writeFile(join(root, 'test/page.spec.ts'), `// a line above\n${SPEC}`);
    git(root, 'commit', '-qam', 'a line above');
    const ran = git(root, 'rev-parse', 'HEAD');
    await writeFile(join(root, 'test/page.spec.ts'), SPEC);
    git(root, 'commit', '-qam', 'the line gone');
    const at = git(root, 'rev-parse', 'HEAD');
    await writeTestCoverage(testCoverageFile(root), { version: 3, instrumentation: 'fixture', commit: at, tests: [], modules: [] }, {
      index: encodeAsSetExecutionIndex({ tests: [{ id: 'test/page.spec.ts > clicks', file: 'test/page.spec.ts', name: 'clicks' }], modules: [] }),
    });
    const landed = new Date().toISOString();
    await writeFile(commitRunsFile(testCoverageFile(root)), JSON.stringify({
      commit: at,
      over: ran,
      ...oneRun(landed, ['test/other.spec.ts']),
      standing: [{ commit: ran, files: ['test/page.spec.ts'], first: landed, latest: landed, runs: 1, texts: {} }],
    }));

    expect((await explainedCase(root, [], 'clicks', undefined))?.explained.moved).toBe(true);
  });

  it('cannot tell whether the test file moved when no runs record says where its run stood', async () => {
    const root = await checkout(false);

    expect((await explainedCase(root, [], 'clicks', undefined))?.explained.moved).toEqual({ unknown: expect.stringContaining('does not say where that run stood') });
  });

  it('leaves a case a story is taped of to the story, and a name the record does not hold to the refusal', async () => {
    const root = await checkout();

    expect(await explainedCase(root, [{ path: 'a.story', file: 'test/page.spec.ts', name: 'clicks', visits: 1 }], 'clicks', undefined)).toBeUndefined();
    expect(await explainedCase(root, [], 'missing', undefined)).toBeUndefined();
    expect(await explainedCase(root, [], undefined, undefined)).toBeUndefined();
  });
});

describe('variance story --name with no story taped', () => {
  it('explains the case from the record, and leaves a zoom, a label, a comparison or a project to the story', async () => {
    const root = await checkout();
    const asked = { command: 'story', root, format: 'text', name: 'clicks' } as const;

    expect(await story(asked)).toHaveProperty('explained');
    // The record keeps one run of a case, under no project: a story is what tells one project's run from another's.
    for (const narrowed of [{ zoom: { in: 'src/page.ts' } }, { label: 'before' }, { compare: 'outcome' }, { project: 'firefox' }] as const) {
      await expect(story({ ...asked, ...narrowed })).rejects.toThrow(/no story in this checkout|earlier reading|none of/);
    }
  });
});

describe('a case explained from the record', () => {
  const page = { file: 'src/page.ts', startLine: 3, endLine: 5 };
  const setup = { ...page, name: 'setup', path: 'entry', file: 'src/setup.ts' };
  const handle = { ...page, name: 'handle', path: 'entry' };
  const reset = { ...page, name: 'reset', path: 'entry' };
  const late = { ...page, name: 'late', path: 'entry' };
  const EXPLAINED: Explained = {
    file: 'test/page.spec.ts',
    name: 'clicks',
    duration: 10,
    timed: true,
    lined: true,
    moved: true,
    statements: [
      { line: 0, regions: [setup], declarations: [{ region: setup, arms: 0 }] },
      { line: 6, time: 400, share: 4, text: 'await click(button);', regions: [handle, { ...page, name: 'handle', path: 'if#0/then' }], declarations: [{ region: handle, arms: 1 }] },
      { line: 4, time: 8000, share: 80, load: 3.5, rss: 412, free: 1024, added: 31, text: 'render(page);', regions: [], declarations: [] },
    ],
    hooks: [{ line: 2, regions: [reset], declarations: [{ region: reset, arms: 0 }] }],
    unlined: [late],
    unlinedDeclarations: [{ region: late, arms: 0 }],
    packages: { 'src/page.ts': '@acme/page' },
  };

  it('prints each statement in the order first reached, with its time, its share and the regions it first ran by package', async () => {
    const text = formatExplained(EXPLAINED, 'text');

    expect(text).toContain('explain  test/page.spec.ts > clicks, from the record');
    expect(text).toContain('VARIANCE_AUTHORITY_STORY=1');
    expect(text).toContain('the test file changed since its run, so a line may have moved');
    expect(formatExplained({ ...EXPLAINED, moved: { unknown: 'no runs record' } }, 'text')).toContain('could not tell whether the test file changed since its run: no runs record');
    expect(text.indexOf('before the first statement')).toBeLessThan(text.indexOf('line 6'));
    expect(text.indexOf('line 6')).toBeLessThan(text.indexOf('line 4'));
    expect(text).toMatch(/line 6 +400 µs +4% +await click\(button\);/);
    expect(text).toMatch(/line 4 +8\.0 ms +80% +render\(page\);\n {4}as it ended: load 3\.5, RSS 412 MiB, 1024 MiB free, 31 nodes added\n/);
    // A statement that read nothing around it says nothing of it.
    expect(text).toMatch(/line 6 +400 µs +4% +await click\(button\);\n {4}@acme\/page\n/);
    expect(text).toMatch(/@acme\/page\n +handle  src\/page\.ts:3-5, and 1 branch or loop in it\n/);
    expect(text).toContain('in hooks, apart from the statements');
    expect(text).toContain('no line recorded: 1 region');
  });

  it('says so when a case was not timed, or recorded without statement lines', () => {
    expect(formatExplained({ ...EXPLAINED, timed: false }, 'text')).toContain('not timed');
    expect(formatExplained({ ...EXPLAINED, lined: false, statements: [], hooks: [] }, 'text')).toContain('recorded without statement lines');
  });

  it('answers in JSON with the explanation whole', () => {
    expect(JSON.parse(formatExplained(EXPLAINED, 'json'))).toEqual({ explained: EXPLAINED });
  });
});
