import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BOOLEAN } from './args.js';
import { USAGE, parseArgs } from './parse.js';
import { openRenderer } from './renderer.js';
import { EXIT_OPERATOR, OperatorError } from './exit.js';

describe('parseArgs', () => {
  it('reads a bare command with the default config path, made absolute', () => {
    // Relative here would mean something different depending on the shell's cwd,
    // and every path inside the config is resolved against the config's directory.
    expect(parseArgs(['doctor'])).toEqual({
      command: 'doctor',
      config: resolve('variance.config.json'),
    });
  });

  it('accepts `--flag value` and `--flag=value` as the same thing', () => {
    // Both are muscle memory. Supporting one and silently treating the other as a
    // positional would produce a run over the wrong subjects.
    expect(parseArgs(['run', '--subjects', 'story:*'])).toEqual(
      parseArgs(['run', '--subjects=story:*']),
    );
  });

  it('refuses an unknown flag instead of ignoring it, and lists the ones that exist', () => {
    // The failure this parser exists to prevent: `--subject` where `--subjects`
    // was meant runs the whole suite and reports success, while the operator's
    // shell history shows the flag they intended.
    const error = attempt(['run', '--subject', 'story:button']);

    expect(error.message).toContain('`--subject` is not a flag `variance run` accepts');
    expect(error.message).toContain('--profile, --subjects, --intent');
  });

  it('refuses a flag that belongs to another command', () => {
    // `--format json` on `run` is meaningless, and accepting it would teach a
    // false model of what the command does.
    expect(attempt(['run', '--format', 'json']).message).toContain('not a flag');
  });

  it('refuses an unknown command and prints the usage', () => {
    const error = attempt(['rin']);
    expect(error.message).toContain('unknown command `rin`');
    expect(error.message).toContain(USAGE);
  });

  it('refuses a value-taking flag with nothing after it', () => {
    // A missing value is a mistake, not a request for the default; falling back
    // would turn a typo into a different report.
    expect(attempt(['report', '--format']).message).toContain('needs a value');
  });

  it('refuses a value-taking flag followed by another flag', () => {
    expect(attempt(['report', '--format', '--subject']).message).toContain('needs a value');
  });

  it('refuses a repeated flag rather than taking the last one', () => {
    // Two contradicting values mean the operator believes one is in force.
    // Choosing silently makes half of those beliefs wrong.
    expect(attempt(['run', '--subjects', 'a', '--subjects', 'b']).message).toContain(
      'more than once',
    );
  });

  it('refuses an invalid enum value for --profile and --format', () => {
    expect(attempt(['run', '--profile', 'webkit']).message).toContain('jsdom or chromium');
    expect(attempt(['report', '--format', 'yaml']).message).toContain('text, json or html');
  });

  it('refuses positional arguments on commands that take none', () => {
    // A stray word is far more likely to be a mistyped flag than a request.
    expect(attempt(['serve', 'report.json']).message).toContain('takes no positional');
  });

  it('takes accept subjects as positionals and --all as a boolean', () => {
    expect(parseArgs(['accept', 'story:button', 'story:card'])).toEqual({
      command: 'accept',
      config: resolve('variance.config.json'),
      subjects: ['story:button', 'story:card'],
      all: false,
      shapes: [],
    });
    expect(parseArgs(['accept', '--all']).all).toBe(true);
  });

  it('splits --shape on commas, so one accept can name several shapes', () => {
    expect(parseArgs(['accept', '--shape', 'v1:aaa, v1:bbb'])).toMatchObject({
      command: 'accept',
      shapes: ['v1:aaa', 'v1:bbb'],
      subjects: [],
      all: false,
    });
  });

  it('refuses --shape together with named subjects', () => {
    // A shape selects the subjects. Naming subjects as well asks two questions
    // at once, and every answer to it is somebody's surprise.
    expect(attempt(['accept', '--shape', 'v1:aaa', 'story:button']).message).toContain(
      'two different sets',
    );
  });

  it('refuses --all together with named subjects', () => {
    // Honouring --all would accept subjects nobody named; honouring the names
    // would ignore a flag that was typed. Both are silent, so neither is chosen.
    expect(attempt(['accept', '--all', 'story:button']).message).toContain('pass one or the other');
  });

  it('refuses accept with neither subjects nor --all', () => {
    expect(attempt(['accept']).message).toContain('needs a subject id, --shape, or --all');
  });

  it('reads the ask question as the first positional and the rest as reports', () => {
    // One command with the question as data, rather than eleven subcommands: the
    // set grows whenever the MCP tools do, and half of the names collide with
    // commands that already mean something else here (`changelog`, `adjudicate`).
    expect(parseArgs(['ask', 'describe', '--subject', 'story:card', 'shard-a.json'])).toEqual({
      command: 'ask',
      config: resolve('variance.config.json'),
      question: 'describe',
      subject: 'story:card',
      reports: [resolve('shard-a.json')],
    });
  });

  it('leaves the ask question absent when none was named, which lists them', () => {
    expect(parseArgs(['ask'])).toEqual({
      command: 'ask',
      config: resolve('variance.config.json'),
      reports: [],
    });
  });

  it('reads journeys with no pool named, which is the run rather than the record', () => {
    // `--all` absent is the default and it is not a value the parser invents: the
    // pool it produces is decided in `dispatch`, from the report, because the
    // difference between "this run's subjects" and "every subject ever recorded"
    // is a reading of a file and not a reading of argv.
    expect(parseArgs(['journeys'])).toEqual({
      command: 'journeys',
      config: resolve('variance.config.json'),
      all: false,
    });

    expect(parseArgs(['journeys', '--all', '--file', 'CartCard', '--limit', '5'])).toEqual({
      command: 'journeys',
      config: resolve('variance.config.json'),
      all: true,
      file: 'CartCard',
      limit: 5,
    });
  });

  it('refuses a journeys --limit that is not a count', () => {
    expect(attempt(['journeys', '--limit', 'all']).message).toContain('--limit');
    expect(attempt(['journeys', '--limit', '0']).message).toContain('--limit');
  });

  it('splits ask --subjects on commas, as the changelog question takes them', () => {
    expect(parseArgs(['ask', 'changelog', '--subjects', 'story:a, story:b'])).toMatchObject({
      subjects: ['story:a', 'story:b'],
    });
  });

  it('reads ask --at, which is the address a live question is asked on', () => {
    expect(parseArgs(['ask', 'run-signals', '--at', 'http://127.0.0.1:4100'])).toMatchObject({
      question: 'run-signals',
      at: 'http://127.0.0.1:4100',
    });
  });

  it('refuses a --limit that is not a count, before anything is asked', () => {
    expect(attempt(['ask', 'run-signals', '--limit', 'lots']).message).toContain('--limit');
    expect(attempt(['ask', 'run-signals', '--limit', '0']).message).toContain('--limit');
  });

  it('takes watch with nothing else, because nothing configures a watcher', () => {
    // It holds a port and some memory. A `--config` here would be a path taken
    // and never read, which is worse than a refusal.
    expect(parseArgs(['watch'])).toEqual({ command: 'watch' });
    expect(attempt(['watch', '--config', 'variance.config.json']).message).toContain(
      'is not a flag `variance watch` accepts; it takes none',
    );
  });

  it('refuses a value on a boolean flag', () => {
    expect(attempt(['accept', '--all=yes']).message).toContain('takes no value');
  });

  it('lets `--` end flag parsing so a subject id may begin with a dash', () => {
    expect(parseArgs(['accept', '--', '--odd-subject']).subjects).toEqual(['--odd-subject']);
  });

  it('treats no arguments, help, and --help as the same request', () => {
    for (const argv of [[], ['help'], ['--help'], ['-h']]) {
      expect(parseArgs(argv)).toEqual({ command: 'help' });
    }
  });

  it('omits absent optional flags rather than setting them undefined', () => {
    // `exactOptionalPropertyTypes` is on, and a present-but-undefined field would
    // override a config value with nothing further down. A boolean flag is the
    // other case and is always present: `false` is its value, not its absence,
    // and there is no config field underneath it to be overridden.
    expect(Object.keys(parseArgs(['run'])).sort()).toEqual([
      'command',
      'config',
      'exitZeroOnChanges',
      'flakes',
    ]);
  });

  it('takes shard reports as positionals on report and comment', () => {
    // Resolved here rather than at the read, so a relative path means the same
    // thing as `--config` does: relative to where the operator typed it.
    expect(parseArgs(['report', 'a.json', 'b.json'])).toEqual({
      command: 'report',
      config: resolve('variance.config.json'),
      format: 'text',
      exitZeroOnChanges: false,
      reports: [resolve('a.json'), resolve('b.json')],
    });

    expect(parseArgs(['comment', 'a.json'])).toEqual({
      command: 'comment',
      config: resolve('variance.config.json'),
      marker: false,
      reports: [resolve('a.json')],
    });
  });

  it('refuses a report beside --marker, which reads nothing', () => {
    expect(attempt(['comment', '--marker', 'a.json']).message).toContain(
      'prints the marker and nothing else',
    );
  });

  it('takes the docket flags on comment, and drops an empty --run-url', () => {
    expect(parseArgs(['comment', '--body-file', 'out.md', '--run-url', 'https://ci/1'])).toEqual({
      command: 'comment',
      config: resolve('variance.config.json'),
      marker: false,
      bodyFile: 'out.md',
      runUrl: 'https://ci/1',
      reports: [],
    });

    // A workflow that published nothing passes `--run-url ""`, and a comment
    // linking to `''` is worse than one linking nowhere.
    expect(parseArgs(['comment', '--run-url', ''])).toEqual({
      command: 'comment',
      config: resolve('variance.config.json'),
      marker: false,
      reports: [],
    });
  });

  it('refuses --marker together with the flags that render a body', () => {
    // Two different questions. Answering both at once would mean deciding which
    // of them the exit code is about.
    expect(attempt(['comment', '--marker', '--body-file', 'out.md']).message).toContain(
      'prints the marker and nothing else',
    );
  });

  it('registers every flag shown without a value as a boolean', () => {
    // The link `PER_COMMAND` cannot carry. It says a command accepts a flag and
    // says nothing about whether the flag takes a value, so a boolean left out of
    // `BOOLEAN` is not refused — it silently eats the next argument. `USAGE` is
    // where the difference is already written down: `[--subjects <glob>]` has a
    // placeholder and `[--exit-zero-on-changes]` does not.
    const wrong: string[] = [];

    for (const line of USAGE.split('\n')) {
      for (const match of line.matchAll(/(--[\w-]+)(.*)$/g)) {
        const [, flag, after] = match;
        // Nothing follows, the bracket closes, or an alternative begins: no value.
        const standalone = /^(\]|\s*\||$)/.test(after!);
        if (standalone !== BOOLEAN.has(flag!)) wrong.push(`${flag!} in: ${line}`);
      }
    }

    expect(wrong).toEqual([]);
  });

  it('names every flag each command accepts in its usage line', () => {
    // The middle link of a chain: `PER_COMMAND` decides what is accepted, this
    // asserts `USAGE` says so, and `tools/docs-claims.check.ts` asserts the
    // README shows `USAGE`. A renamed flag then fails twice on its way to the
    // documentation, instead of arriving there never.
    const missing: string[] = [];

    for (const line of USAGE.split('\n')) {
      const command = /^variance (\w+)/.exec(line)?.[1];
      if (command === undefined) continue;

      // Whatever the command actually accepts, which for all but `watch` is the
      // per-command set plus `--config`. Each usage line has to show all of it.
      for (const flag of flagsOf(command)) {
        if (!line.includes(flag)) missing.push(`${command}: ${flag}`);
      }
    }

    expect(missing).toEqual([]);
  });

  it('documents the three exit codes in its usage text', () => {
    // The usage is where an operator learns that a verdict and a crash differ.
    expect(USAGE).toContain('0 nothing needs review');
    expect(USAGE).toContain('1 changes need review');
    expect(USAGE).toContain('2 operator error');
  });
});

/**
 * A machine that cannot open a browser, which is ADR-0017.
 *
 * The criterion — `run --profile chromium` with no Chromium exits 2, not 1 — was
 * argued in a comment and asserted by nothing. It cannot be reached through
 * `main` on a machine that has a browser, and the only alternative is to stop
 * checking it, which is how a run that never happened comes to look like a run
 * that found nothing.
 */
describe('opening a renderer', () => {
  it('turns any failure to open one into an operator error, so a missing browser exits 2', async () => {
    const failure = new Error('browserType.launch: Executable doesn’t exist at /ms-playwright');

    const error = await openRenderer(() => Promise.reject(failure)).then(
      () => null,
      (thrown: unknown) => thrown,
    );

    expect(error).toBeInstanceOf(OperatorError);
    expect((error as OperatorError).exitCode).toBe(EXIT_OPERATOR);
    // The underlying message intact, because "no renderer could be opened" alone
    // does not tell an operator whether to install a browser or fix a path.
    expect((error as OperatorError).message).toContain('Executable doesn’t exist');
    expect((error as OperatorError).message).toContain('variance doctor');
    expect((error as OperatorError).cause).toBe(failure);
  });

  it('is not in the way of a renderer that opens', async () => {
    // The wrapper returns the value untouched. A guard that also transformed the
    // success path would be a second thing to get wrong on every run.
    const renderer = { opened: true };
    await expect(openRenderer(() => Promise.resolve(renderer as never))).resolves.toBe(renderer);
  });
});

/**
 * What a command accepts, read out of its own refusal.
 *
 * The parser prints the accepted set when it rejects a flag, so this asks the
 * code path an operator actually hits rather than keeping a second copy of the
 * table. Only the sentence is read: the refusal appends the whole usage text,
 * and matching flags in that would make the assertion vacuous.
 */
function flagsOf(command: string): readonly string[] {
  const sentence = /it takes ([^\n]+)/.exec(attempt([command, '--not-a-flag']).message)?.[1];
  if (sentence === undefined || sentence === 'none') return [];
  return sentence.split(',').map((flag) => flag.trim());
}

function attempt(argv: readonly string[]): OperatorError {
  try {
    parseArgs(argv);
  } catch (error) {
    if (error instanceof OperatorError) return error;
    throw error;
  }
  throw new Error(`expected \`${argv.join(' ')}\` to be refused`);
}
