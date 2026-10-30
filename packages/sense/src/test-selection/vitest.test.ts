import { readFile, rm, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { instrumentationId } from '../instrument/index.js';
import { decodeTestCoverage } from './format.js';
import { oneRowPerFile, reportedComplete, runnerSkipped, taskComplete, type ReportedModule, type RunnerTask } from './finished-files.js';
import { laidCoverage } from './__fixtures__/laid.js';
import { withTestSelection } from './vitest.js';
import type { CoverageBlock, TestCoverage } from './index.js';

describe('what a finished test file is worth', () => {
  // One file, read by two runners. `test/hook.throws.ts` in the external-vitest
  // fixture throws in a `beforeAll`, and the shapes below are what each runner
  // handed the reporter for it — taken off the hook as it was called, not
  // recalled:
  //
  //   vitest 2.1.9   onFinished only                 the task tree here
  //   vitest 3.2.4   onTestRunEnd, then onFinished    the reported module here
  //   vitest 4.1.2   onTestRunEnd only
  //
  // Under 3 the reported reading is the one that lands, since the snapshot is
  // written once by whichever hook arrives first. This checkout installs 2.1.9,
  // so only the task-tree reading has a run of its own behind it —
  // `reporter-hooks.integration.test.ts` says exactly that, and goes red when a
  // bump makes the other one live. Until then these shapes are the whole of the
  // reported reading's evidence, which is the reason each assertion below turns
  // on one accessor a runner was seen to answer rather than one it might.
  const test = (state: string) => ({ result: { state } });
  const reportedTest = (state: string) => ({ result: () => ({ state }) });

  /**
   * The Vitest 2 task tree: `markTasksAsSkipped` rewrote the guarded test to
   * `skip` — mode included, so it is indistinguishable from `it.skip` — and the
   * suite that held the hook kept `fail`.
   */
  const taskTree = (suite: string): RunnerTask => ({
    filepath: 'test/hook.throws.ts',
    result: { state: suite === 'fail' ? 'fail' : 'pass' },
    tasks: [test('pass'), { result: { state: suite }, tasks: [test('skip')] }],
  });

  /**
   * The Vitest 3 reported module for the same run, answering only the signals
   * named.
   *
   * All three were measured at once for the thrown hook: `ok()` false, the
   * module's own `errors()` empty — a hook inside a `describe` belongs to that
   * suite and not to the file — and that suite's `errors()` holding the throw.
   * They are asked for one at a time because a runner that grew the API later
   * than this seam may answer only some of them, and each one alone has to be
   * enough to refuse.
   */
  const reported = (...signals: readonly string[]): ReportedModule => ({
    moduleId: 'test/hook.throws.ts',
    ok: () => !signals.includes('module verdict'),
    errors: () => ({ length: signals.includes('module errors') ? 1 : 0 }),
    children: {
      allTests: () => [reportedTest('passed'), reportedTest('skipped')],
      allSuites: () => [{ errors: () => ({ length: signals.includes('suite errors') ? 1 : 0 }) }],
    },
  });

  it('refuses a Vitest 2 file where a suite failed under passing and skipped leaves', () => {
    expect(taskComplete(taskTree('fail'), false)).toBe(false);
  });

  it('still counts a Vitest 2 file whose own skips are in its text', () => {
    expect(taskComplete(taskTree('pass'), false)).toBe(true);
  });

  it('refuses a reported module on any one of the signals, taken alone', () => {
    // Alone is the whole assertion. A module built by hand agrees with whatever
    // its author believed the runner's API was called, so the only case that
    // notices `allSuites` being renamed is the case with nothing else left to
    // refuse on.
    expect(reportedComplete(reported('module verdict'), false)).toBe(false);
    expect(reportedComplete(reported('module errors'), false)).toBe(false);
    expect(reportedComplete(reported('suite errors'), false)).toBe(false);
    expect(reportedComplete(reported('module verdict', 'module errors', 'suite errors'), false)).toBe(false);
  });

  it('counts a reported module no signal objects to, so the refusals are what refused', () => {
    // The control the three above are read against: the same passed-and-skipped
    // leaves, and nothing saying the file stopped part-way.
    expect(reportedComplete(reported(), false)).toBe(true);
  });

  it('answers what the other writer answered about the same file', () => {
    // The two hooks fill one `complete` column, and under Vitest 3 both are
    // called — so a file worth nothing read through the task tree has to be
    // worth nothing read through the reported modules, or what a suite is
    // allowed to skip depends on which major ran it.
    expect(reportedComplete(reported('module verdict', 'suite errors'), false))
      .toBe(taskComplete(taskTree('fail'), false));
    expect(reportedComplete(reported(), false)).toBe(taskComplete(taskTree('pass'), false));
  });

  it('counts no skip the runner may have written, and still counts a todo', () => {
    // A name filter and a cancel both leave `skip` in the mode and nothing in
    // the result, and a reported test is `skipped` whoever skipped it.
    const unrun = (mode: string): RunnerTask => ({ tasks: [test('pass'), { mode }] });
    expect(taskComplete(unrun('skip'), false)).toBe(true);
    expect(taskComplete(unrun('skip'), true)).toBe(false);
    expect(taskComplete(unrun('todo'), true)).toBe(true);
    expect(reportedComplete(reported(), true)).toBe(false);
  });

  it('counts no skip a cancel wrote into the result, and still counts the file\'s own', () => {
    // Vitest 5's cancel also writes `skip` into the result of every test it had
    // not reached, so the result says no more than the mode about who skipped it.
    const cut: RunnerTask = { tasks: [test('pass'), { mode: 'skip', result: { state: 'skip' } }] };
    expect(taskComplete(cut, true)).toBe(false);
    expect(taskComplete(cut, false)).toBe(true);
  });

  it('reads a filter or a cancel off the runner, and no runner as either', () => {
    expect(runnerSkipped({ config: { watch: true } })).toBe(false);
    expect(runnerSkipped({ config: { testNamePattern: /alpha/ } })).toBe(true);
    expect(runnerSkipped({ configOverride: { testNamePattern: /alpha/ } })).toBe(true);
    expect(runnerSkipped({ isCancelling: true })).toBe(true);
    expect(runnerSkipped({}, 'interrupted')).toBe(true);
    expect(runnerSkipped(undefined)).toBe(true);
  });
});

describe('a test file two projects both ran', () => {
  // Zod's shape: one project runs `packages/zod/src/**/*.test.ts`, and a second
  // runs the same glob again with ahead-of-time compilation turned on. The
  // runner announces each of them, and the snapshot is keyed by path.
  const ran = (filepath: string, complete: boolean) => ({ filepath, complete });

  it('is one row, because the answer it feeds is a list of paths', () => {
    const rows = oneRowPerFile(
      [ran('/repo/a.test.ts', true), ran('/repo/a.test.ts', true), ran('/repo/b.test.ts', true)],
      '/repo',
    );

    expect(rows.map((row) => row.filepath)).toEqual(['/repo/a.test.ts', '/repo/b.test.ts']);
  });

  it('is worth excluding only if every project that ran it finished it', () => {
    // The undercount is the point: a file whose compile-mode run stopped early
    // recorded less than it reaches, and the other project passing does not put
    // the missing regions back.
    const [row] = oneRowPerFile([ran('/repo/a.test.ts', true), ran('/repo/a.test.ts', false)], '/repo');

    expect(row?.complete).toBe(false);
  });
});

describe('what the seam refuses to instrument', () => {
  it('puts its setup shim and case runner on disk, where no plugin has to resolve them', async () => {
    // Vitest 4 loads both through Vite's module runner, which never consults
    // this config's plugins: as virtual ids they came back
    // ERR_MODULE_NOT_FOUND, the run reported *no tests*, and the reporter still
    // wrote an empty execution index. Measured on 4.1.11.
    const root = await mkdtemp(resolve(tmpdir(), 'variance-seam-modules-'));
    const coverageFile = resolve(root, 'coverage.bin');
    try {
      const configured = withTestSelection({}, { root, coverageFile });
      const setup = (configured.test!.setupFiles as string[])[0]!;
      const runner = configured.test!.runner as string;

      // Stamped with the run, because two Vitest processes over one project
      // would otherwise write each other's shim — and a shim carries the
      // directory its journals go to.
      expect(setup).toMatch(/\.variance-authority\/test-selection-setup-\d+-[0-9a-f-]+\.mjs$/);
      expect(runner).toMatch(/\.variance-authority\/test-selection-case-runner-\d+-[0-9a-f-]+\.mjs$/);
      expect(await readFile(setup, 'utf8')).toContain('collectors.cjs');
      expect(await readFile(runner, 'utf8')).toContain('runTask');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('leaves the config file itself alone under the default include', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'variance-config-file-'));
    const coverageFile = resolve(root, 'coverage.bin');
    try {
      const configured = withTestSelection({}, { root, coverageFile });
      const plugins = configured.plugins as unknown as Array<{
        transform: { handler(code: string, id: string): { code: string } | null };
      }>;

      // Neither the cut nor the probes.
      for (const plugin of plugins) {
        expect(plugin.transform.handler('export default {};', resolve(root, 'vitest.config.ts'))).toBeNull();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('a module named unprobed', () => {
  it('runs marked as loaded and recorded as not instrumented, though include accepts it too', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'variance-unprobed-'));
    const coverageFile = resolve(root, 'coverage.bin');
    try {
      const page = resolve(root, 'page.ts');
      const configured = withTestSelection({}, { root, coverageFile, include: () => true, unprobed: (file) => file === page });
      const { plugin, reporter } = seamOf(configured);
      await writeFile(page, 'export function f(x) { if (x) { return 1; } return 2; }');

      const placed = plugin.transform.handler('export function f(x) { if (x) { return 1; } return 2; }', page);
      await reporter.onFinished([]);

      expect(placed!.code).toMatch(/^export function f\(x\) \{ if \(x\) \{ return 1; \} return 2; \}\n;globalThis\.__VA__\.m\("[^"\n]*"\);$/);
      expect(decodeTestCoverage(await readFile(coverageFile)).modules).toEqual([
        expect.objectContaining({ file: 'page.ts', instrumented: false, blocks: [] }),
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('coverage generations', () => {
  it('records instrumentation refusal instead of an empty module observation', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'variance-instrumentation-refusal-'));
    const coverageFile = resolve(root, 'coverage.bin');
    try {
      const configured = withTestSelection({}, { root, coverageFile, include: () => true });
      const { plugin, reporter } = seamOf(configured);
      await writeFile(resolve(root, 'broken.ts'), 'const =');
      // It still runs marked as loaded, so a test that loaded it still says so.
      expect(plugin.transform.handler('const =', resolve(root, 'broken.ts'))).toEqual({
        code: expect.stringMatching(/^const =\n;globalThis\.__VA__\.m\("[^"\n]*"\);$/),
        map: null,
      });
      await reporter.onFinished([]);

      expect(decodeTestCoverage(await readFile(coverageFile)).modules).toEqual([{
        file: 'broken.ts',
        sourceDigest: expect.stringMatching(/^v1:/),
        instrumented: false,
        blocks: [],
      }]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('says so when a run that had test files instrumented nothing', async () => {
    // The failure this warning exists for is invisible: the run is green, the
    // snapshot is written, and every selection made from it afterwards is empty.
    const root = await mkdtemp(resolve(tmpdir(), 'variance-instrumentation-empty-'));
    const coverageFile = resolve(root, 'coverage.bin');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const testFile = resolve(root, 'case.test.ts');
      await writeFile(testFile, 'it("x", () => {});\n', 'utf8');
      const configured = withTestSelection({}, { root, coverageFile, include: () => false });
      const reporter = (configured.test!.reporters as unknown as Array<{
        onFinished(files: readonly unknown[]): Promise<void>;
      }>).at(-1)!;

      await reporter.onFinished([{ filepath: testFile, tasks: [] }]);

      expect(warn).toHaveBeenCalledOnce();
      expect(warn.mock.calls[0]?.[0]).toMatch(/instrumented 0 modules across 1 test file/);
      expect(warn.mock.calls[0]?.[0]).toMatch(/projects/);
    } finally {
      warn.mockRestore();
      await rm(root, { recursive: true, force: true });
    }
  });

  it('says nothing when a run collected no test files at all', async () => {
    // Not the same state. A run that collected nothing has already said so in
    // the runner's own output, and repeating it here would train a reader to
    // scroll past the sentence that matters.
    const root = await mkdtemp(resolve(tmpdir(), 'variance-instrumentation-nofiles-'));
    const coverageFile = resolve(root, 'coverage.bin');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const configured = withTestSelection({}, { root, coverageFile, include: () => false });
      const reporter = (configured.test!.reporters as unknown as Array<{
        onFinished(files: readonly []): Promise<void>;
      }>).at(-1)!;

      await reporter.onFinished([]);

      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
      await rm(root, { recursive: true, force: true });
    }
  });

  it('cuts and lands under the entries recipe when asked for it', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'variance-instrumentation-entries-'));
    const coverageFile = resolve(root, 'coverage.bin');
    try {
      const configured = withTestSelection({}, { root, coverageFile, include: () => true, mode: 'entries' });
      const { plugin, reporter } = seamOf(configured);
      await writeFile(resolve(root, 'f.ts'), 'export function f(x) { if (x) { return 1; } return 2; }');

      const placed = plugin.transform.handler('export function f(x) { if (x) { return 1; } return 2; }', resolve(root, 'f.ts'));
      await reporter.onFinished([]);

      // One probe for the function and none for the branch; the header marks
      // the module itself.
      expect(placed!.code.match(/__va\(\d+\)/g)).toEqual(['__va(1)']);
      const coverage = decodeTestCoverage(await readFile(coverageFile));
      expect(coverage.instrumentation).toBe(instrumentationId('entries'));
      expect(coverage.modules[0]?.blocks.map((block) => block.kind)).toEqual(['module', 'function']);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('lets a completed changed test replace every old crossing', () => {
    const previous = coverage(true, 'test:old', module('source:old', ['case.test.ts']));
    const current = coverage(true, 'test:new');

    const merged = laidCoverage(previous, current);

    expect(merged.tests).toEqual(current.tests);
    expect(merged.modules[0]?.blocks.flatMap((block) => block.testFiles)).toEqual([]);
  });

  it('keeps old crossings when a focused or failed run is incomplete in the same generation', () => {
    const previous = coverage(true, 'test:same', module('source:old', ['case.test.ts']));
    const current = coverage(false, 'test:same');

    const merged = laidCoverage(previous, current);

    expect(merged.tests).toEqual(current.tests);
    expect(merged.modules[0]?.blocks.flatMap((block) => block.testFiles)).toContain('case.test.ts');
  });

  it('retires crossings inherited from changed test, mock, hook, or setup preconditions', () => {
    const previous = coverage(true, 'test:old', module('source:old', ['case.test.ts']));
    const current = coverage(false, 'test:new');

    const merged = laidCoverage(previous, current);

    expect(merged.tests).toEqual(current.tests);
    expect(merged.tests[0]?.complete).toBe(false);
    expect(merged.modules[0]?.blocks.flatMap((block) => block.testFiles)).toEqual([]);
  });

  it('carries an outcome through an edit to the region that governs it', () => {
    // The condition belongs to the region around the arms, so editing it moves
    // that region's digest and not the arm's. The arm's crossing still carries:
    // a diff of the condition is charged to the region that holds it, and the
    // test that reached the arm reached that region too, so it is selected from
    // there. Retiring the arm's crossing would discard evidence and select
    // nobody extra.
    const previous = coverage(
      true,
      'test:old',
      module('source:old', ['case.test.ts'], { entry: 'entry:old', outcome: 'outcome:same' }),
    );
    const current = coverage(
      false,
      'test:old',
      module('source:new', [], { entry: 'entry:new', outcome: 'outcome:same' }),
    );

    const merged = laidCoverage(previous, current);
    const blocks = merged.modules[0]!.blocks;

    expect(blocks.find((block) => block.path === 'entry')?.testFiles).toEqual(['case.test.ts']);
    expect(blocks.find((block) => block.path === 'if#0/then')?.testFiles)
      .toEqual(['case.test.ts']);
  });

  it('hands a region the module no longer names the crossings around it', () => {
    // Identity is the address — the declaration name path and the structural
    // path inside it — so a renamed function is not the function that was
    // recorded, and `decide`'s crossings do not carry onto `chose` by address.
    // What `chose` gets instead is what the region around it holds, which here
    // is the module, and that is an observation rather than a guess: arrival
    // nests, so a test recorded against the module was somewhere inside it.
    //
    // The alternative is a row reading `chose` was entered by nobody, about
    // lines no run has been asked about. Nothing downstream would read it as an
    // unknown — the test still holds the module, so it is not demoted and stays
    // in `whole`, and the module still has rows, so its name stays out of
    // `unread` — and a diff inside `chose` would answer nobody against a
    // `whole` naming the suite, which is the suite skipped.
    const previous = coverage(true, 'test:old', module('source:old', ['case.test.ts']));
    const current = coverage(false, 'test:old', module('source:new', [], {}, 'chose'));

    const merged = laidCoverage(previous, current);
    const blocks = merged.modules[0]!.blocks;

    expect(blocks.find((block) => block.name === 'chose')?.testFiles)
      .toEqual(['case.test.ts']);
    expect(blocks.find((block) => block.path === 'module')?.testFiles).toEqual(['case.test.ts']);
  });
});

/** The probes plugin and the recording reporter of a configuration the seam wrapped. */
function seamOf(configured: ReturnType<typeof withTestSelection>) {
  const plugins = configured.plugins as unknown as Array<{
    name: string;
    transform: { handler(code: string, id: string): { code: string } | null };
  }>;
  const reporters = configured.test!.reporters as unknown as Array<{ onFinished(files: readonly []): Promise<void> }>;
  return { plugin: plugins.find(({ name }) => name === 'variance-authority:test-selection-probes')!, reporter: reporters.at(-1)! };
}

function coverage(
  complete: boolean,
  testDigest: string,
  sourceModule?: TestCoverage['modules'][number],
): TestCoverage {
  return {
    version: 3,
    instrumentation: 'fixture-instrumentation',
    tests: [{
      file: 'case.test.ts',
      complete,
      preconditions: [{ name: 'case.test.ts', digest: testDigest }],
    }],
    modules: sourceModule === undefined ? [] : [sourceModule],
  };
}

function module(
  sourceDigest: string,
  testFiles: readonly string[],
  digests: Partial<Record<'entry' | 'outcome' | 'taken' | 'otherwise', string>> = {},
  name = 'decide',
): TestCoverage['modules'][number] {
  const blocks: CoverageBlock[] = [
    block(0, 'module', 'module', 'module:same', testFiles, undefined, name),
    block(1, 'function', 'entry', digests.entry ?? 'entry:same', testFiles, 0, name),
    block(2, 'branch', 'if#0/then', digests.outcome ?? digests.taken ?? 'then:same', testFiles, 1, name),
    block(3, 'branch', 'if#0/else', digests.outcome ?? digests.otherwise ?? 'else:same', testFiles, 1, name),
  ];
  return { file: 'source.ts', sourceDigest, instrumented: true, blocks };
}

function block(
  ordinal: number,
  kind: string,
  path: string,
  digest: string,
  testFiles: readonly string[],
  owner: number | undefined,
  name: string,
): CoverageBlock {
  return {
    ordinal,
    kind,
    ...(owner === undefined ? {} : { owner }),
    digest,
    name: kind === 'module' ? '' : name,
    path,
    startLine: ordinal + 1,
    endLine: ordinal + 1,
    source: true,
    testFiles,
  };
}
