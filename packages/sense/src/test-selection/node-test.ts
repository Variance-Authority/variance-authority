/**
 * The recording and the selection, for a project that runs `node:test`.
 *
 * {@link runNodeTest} is the whole wiring: it opens a recording, honours
 * `VARIANCE_AUTHORITY_SINCE` by leaving out the files a diff did not reach,
 * runs the rest with `node:test`'s own `run()` — one process per file, each file's stream on its own — and
 * folds the journals each process wrote. A file that failed is recorded as
 * incomplete, so the next selection keeps it.
 */

import { availableParallelism } from 'node:os';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from 'node:test';
import { projectPath } from './instrumented-modules.js';
import { recordFileFor } from './record-location.js';
import { repositoryRoot } from './repository-root.js';
import { startRecording, type RecordingOptions } from './runner.js';
import { askedSelection } from './selection-environment.js';
import { kept, selectedLines, type SuiteSelection } from './suite-selection.js';

export interface RunNodeTestOptions extends RecordingOptions {
  /** The test files to run, as paths. */
  readonly files: readonly string[];
  /** The selection to run, in place of the one `VARIANCE_AUTHORITY_SINCE` asks for; for a caller that computes its own. */
  readonly selection?: () => Promise<SuiteSelection>;
}

/** Runs the files under `node:test`, recording them, and answers whether every one passed. */
export async function runNodeTest(options: RunNodeTestOptions): Promise<{ readonly passed: boolean }> {
  const { files, selection: handed, ...recordingOptions } = options;
  const root = repositoryRoot(resolve(options.root ?? '.'));
  const say = (line: string): void => void process.stderr.write(`${line}\n`);
  const asked = askedSelection(handed, () => recordFileFor(root, process.cwd(), options), { root, ...(options.suite === undefined ? {} : { suite: options.suite }) }, process.env, say);
  const all = files.map((file) => resolve(file));
  // A kept file runs whole: a selection that names cases would read as having been honoured.
  const selection = await asked?.();
  if (selection?.cases !== undefined && selection.cases.size > 0) {
    throw new Error('variance-authority: node:test runs a kept file whole; unset VARIANCE_AUTHORITY_GRAIN');
  }
  const name = (file: string): string => projectPath(root, file);
  const running = selection === undefined ? all : kept(selection, all, name);
  if (selection !== undefined) for (const line of selectedLines(selection, all.map(name))) say(line);
  const recording = startRecording(recordingOptions);

  // One `run()` per file: a case is declared from the wrapper, so Node names the wrapper as the file of a failing case, and only the stream that holds one file can say whose it was.
  const failed = new Set<string>();
  const queue = [...running];
  const execArgv = ['--import', fileURLToPath(new URL('./node-test-child.js', import.meta.url))];
  const worker = async (): Promise<void> => {
    for (let file = queue.shift(); file !== undefined; file = queue.shift()) {
      const stream = run({ files: [file], isolation: 'process', execArgv });
      stream.on('test:fail', (event) => {
        failed.add(file!);
        // A failure's name and cause travel in the event, not in the child's output.
        const error = event.details.error as { cause?: unknown; stack?: string; message?: string };
        const cause = (error.cause ?? error) as { stack?: string; message?: string };
        process.stderr.write(`not ok ${event.name} (${relative(process.cwd(), file!)})\n${cause.stack ?? cause.message ?? String(cause)}\n`);
      });
      stream.on('test:stderr', (event) => process.stderr.write(event.message));
      stream.on('test:stdout', (event) => process.stdout.write(event.message));
      // Draining the stream is what makes `run()` go.
      for await (const _event of stream) void _event;
    }
  };
  await Promise.all(Array.from({ length: Math.min(availableParallelism(), running.length) }, worker));

  await recording.finish(running.map((file) => ({ file, complete: !failed.has(file) })));
  return { passed: failed.size === 0 };
}
