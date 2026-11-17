import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { type Report, vitestSequencer } from './__fixtures__/vitest-sequencer.js';

// Where the selecting sequencer names the seed it shuffled with, and that the
// seed it names gives the order it ran.
const { scratch, output, run, started } = vitestSequencer();

describe('the selecting sequencer under `sequence.shuffle`', () => {
  it('names the seed it shuffled with in the banner, where Vitest names its own, and that seed runs the files in the same order', async () => {
    const lines = (await run(await scratch(), 'vitest.default.config.ts', '--sequence.shuffle')).split('\n');
    const banner = lines.findIndex((line) => line.includes(' RUN '));
    const seed = /^ {6}Running tests with seed "(\d+)"$/.exec(lines[banner + 1] ?? '')?.[1];
    expect(seed).toBeDefined();
    // The default reporter names each file as it finishes, and one runs at a time.
    const order = lines.flatMap((line) => /✓ test\/(\S+)/.exec(line)?.[1] ?? []);

    expect(await started('vitest.default.config.ts', '--sequence.shuffle', `--sequence.seed=${seed}`)).toEqual(order);
  });

  // A reporter named on the command line replaces the configured ones, the
  // seam's among them. From Vitest 3.1 a plugin reaches the banner as well, so
  // the seed is named there, where Vitest names its own, and not again on stderr.
  it('names the seed it shuffled with under a reporter named on the command line, and that seed runs the files in the same order', async () => {
    const { stdout, stderr } = await output(await scratch(), {}, 'vitest.default.config.ts', '--sequence.shuffle', '--reporter=default');
    const seed = /^ {6}Running tests with seed "(\d+)"$/m.exec(stdout)?.[1];
    expect(seed).toBeDefined();
    expect(stderr).not.toContain('running tests with seed');
    const order = stdout.split('\n').flatMap((line) => /✓ test\/(\S+)/.exec(line)?.[1] ?? []);

    expect(await started('vitest.default.config.ts', '--sequence.shuffle', `--sequence.seed=${seed}`)).toEqual(order);
  });

  // A reporter that prints no banner prints no seed, as Vitest's own do.
  it('leaves stdout to a reporter that prints no banner', async () => {
    const directory = await scratch();
    const report = resolve(directory, 'report.json');
    const stdout = await run(directory, 'vitest.default.config.ts', '--sequence.shuffle', '--reporter=json', `--outputFile=${report}`);

    expect(stdout).not.toContain('seed');
    expect((JSON.parse(await readFile(report, 'utf8')) as Report).testResults).toHaveLength(4);
  });
});
