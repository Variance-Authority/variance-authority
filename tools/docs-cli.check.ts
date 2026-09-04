import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FENCES, MARKDOWN, ROOT, fencesIn, type Fence } from './markdown.js';

/**
 * Claims the documentation makes about the binary.
 *
 * A command named in prose, a synopsis a reader retypes, a call in a shell
 * fence — each is a fact about a command line that `packages/cli/src/usage.ts`
 * also states, and the source file is the one that has to be right. All string
 * work: the commands come from the binary's own table, the synopses from the
 * `USAGE` lines it prints back at a reader who gets an invocation wrong.
 *
 * Beside `docs-claims.check.ts`, which holds the claims the documentation makes
 * about the repository — the specs listing, the config example, the package
 * inventory, the routes. Those read the repository; these read one source file.
 */


/**
 * The commands the documentation shows, and the commands the binary has.
 *
 * Both directions, because both failures happened. A command in the documentation
 * that the binary refuses is a reader typing something and getting `unknown
 * command`; a command the binary dispatches that nothing documents is a capability
 * nobody can find.
 *
 * Flags travel a chain rather than being checked here twice: `PER_COMMAND` is the
 * truth, `bin.test.ts` asserts that `USAGE` names every flag in it, and the last
 * link is below — the README shows `USAGE` itself, line for line. A renamed flag
 * therefore reaches the README through two failing tests instead of through
 * nobody noticing.
 */
describe('the documented command line is the real one', () => {
  const bin = readFileSync(join(ROOT, 'packages/cli/src/usage.ts'), 'utf8');
  const dispatched = [...(/const COMMANDS = \[([^\]]+)\]/.exec(bin)?.[1] ?? '').matchAll(/'([\w-]+)'/g)].map(
    (match) => match[1]!,
  );

  /** The synopsis lines of `USAGE`, as the binary prints them back at a reader. */
  const USAGE_LINES = [...bin.matchAll(/^ {2}'(variance [^']+)',$/gm)].map((match) => match[1]!);

  it('reads the binary', () => {
    expect(dispatched.length).toBeGreaterThan(0);
  });

  it("shows the binary's own usage, line for line", () => {
    const usage = USAGE_LINES;
    const readme = readFileSync(join(ROOT, 'packages/cli/README.md'), 'utf8');

    expect(usage.length).toBe(dispatched.length);
    // Verbatim, not paraphrased. A synopsis a reader retypes has to be the one
    // the parser prints back at them when they get it wrong.
    expect(usage.filter((line) => !readme.includes(line))).toEqual([]);
  });

  it.each(MARKDOWN)('%s names no command the binary refuses', (file) => {
    const text = readFileSync(join(ROOT, file), 'utf8');
    const fenced = fencesIn(file)
      .filter((fence) => fence.lang === 'bash')
      .map((fence) => fence.code)
      .join('\n');

    const invented: string[] = [];
    // Backticks or a shell fence. Bare prose is excluded on purpose: "the
    // variance run" and "variance and its baselines" are sentences, not commands.
    for (const match of [...text.matchAll(/`variance ([a-z][\w-]*)/g), ...fenced.matchAll(/\bvariance ([a-z][\w-]*)/g)]) {
      const command = match[1]!;
      if (!dispatched.includes(command)) invented.push(`${file}: variance ${command}`);
    }

    expect([...new Set(invented)]).toEqual([]);
  });

  it('documents every command the binary dispatches', () => {
    const readme = readFileSync(join(ROOT, 'packages/cli/README.md'), 'utf8');
    expect(dispatched.filter((command) => !new RegExp(`variance ${command}\\b`).test(readme))).toEqual([]);
  });

  /**
   * Innermost-first, because an optional may hold an optional: `--message` is
   * only a flag once `--message-file` names the file it writes a line of. One
   * non-nesting pass leaves the outer bracket behind and reads the synopsis as
   * malformed.
   */
  const dropOptionals = (line: string): string => {
    let text = line;
    for (let previous = ''; previous !== text; ) {
      previous = text;
      text = text.replace(/\[[^[\]]*\]/g, '');
    }
    return text;
  };

  /**
   * Wherever a block lists the commands, it lists all of them, in the binary's
   * own words.
   *
   * The two rules above are each half-blind in the same place. The CLI spec
   * carried five of the six commands for a session inside a block that presents
   * itself as *the contract*, and neither rule fired: every command it named
   * exists, so the first rule passed, and the second reads only
   * `packages/cli/README.md`, so the missing one was missing somewhere it does
   * not look. A reader implementing against that spec would never learn
   * `comment` is there; the action that posts the docket calls it.
   *
   * **A synopsis is told from the other two things structurally, not by
   * filename.** A synopsis states a command's *shape*; an invocation states one
   * command; a transcript records what some ran. So a line qualifies when it
   * carries a placeholder — `[…]` or `<…>` — and, once the placeholders and any
   * trailing `#` note are stripped, has nothing left but the command, its flags,
   * `...` and `|`.
   *
   * Both other kinds are in this repository and both are correctly excluded.
   * `cases/README.md` begins every line with `variance ` and keeps `on a fresh
   * checkout  8 new  exit 1` — a record of what four runs did. The
   * `variance comment --marker` block below in `packages/cli/README.md` is one
   * concrete call with no placeholder in it; requiring it to name all six
   * commands is what the first draft of this rule did, and it was wrong. The
   * placeholder is required of the block rather than of each line, because a
   * command that takes no arguments has no placeholder to show.
   *
   * Verbatim against `USAGE`, for the reason the README rule gives: a synopsis a
   * reader retypes has to be the one the parser prints back when they get it
   * wrong. **The limit that buys:** a document proposing a command line for
   * something unbuilt cannot be written this way. That costs nothing today —
   * this repository has one binary, so a block enumerating `variance` commands
   * is describing it — and the day it costs something, the first rule above
   * would have refused the proposal anyway for naming a command that does not
   * dispatch.
   */
  const isSynopsis = (fence: Fence): boolean => {
    const lines = fence.code.split('\n').filter((line) => line.trim() !== '');
    if (lines.length === 0) return false;
    // Asked of the fence rather than of each line in it. A synopsis carries
    // placeholders somewhere, which is what separates it from a block of concrete
    // calls — but one command in it may take no arguments at all, and `variance
    // watch` does.
    if (!lines.some((line) => /[[<]/.test(line))) return false;

    return lines.every((line) => {
      if (!line.startsWith('variance ')) return false;

      const remaining = dropOptionals(line.replace(/#.*$/, ''))
        .replace(/<[^>]*>/g, '')
        .trim()
        .split(/\s+/)
        // `variance` and the command itself; what follows decides the question.
        .slice(2);

      return remaining.every((token) => /^(--[\w-]+|\.{3}|\|)$/.test(token));
    });
  };

  const SYNOPSES = FENCES.filter(isSynopsis);

  it('finds the synopses, so a parsing change cannot empty this rule', () => {
    // Named rather than counted: an empty list would pass every rule below.
    expect(SYNOPSES.map((fence) => fence.file)).toContain('packages/cli/README.md');
  });

  it.each(SYNOPSES.map((fence) => [`${fence.file}:${fence.line}`, fence] as const))(
    '%s lists every command and shows the binary’s own line',
    (_where, fence) => {
      const shown = fence.code
        .split('\n')
        .filter((line) => line.trim() !== '')
        .map((line) => line.trimEnd());

      expect(dispatched.filter((command) => !shown.some((line) => line.startsWith(`variance ${command} `) || line === `variance ${command}`))).toEqual([]);
      expect(shown.filter((line) => !USAGE_LINES.includes(line))).toEqual([]);
    },
  );

  it.todo(
    'every flag `.github/actions/variance/action.yml` hands the CLI is one the parser accepts — needs the action read as text and its `run:` lines pulled apart here, since the rules above see a command line only where a markdown fence holds it and the action is the one caller that is neither prose nor a test',
  );
});
