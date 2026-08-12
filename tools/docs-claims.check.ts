import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseConfig } from '@variance-authority/cli';
import { FENCES, MARKDOWN, ROOT, fencesIn, lineOf, prose } from './markdown.js';

/**
 * Claims the documentation makes about itself, and about the binary.
 *
 * A command list, a file count, a directory listing, a config example — each one
 * is a fact stated in prose that something else in the repository also states.
 * All string work: the commands come from the binary's own table, the count from
 * `git ls-files`, the config from the real parser.
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
  const bin = readFileSync(join(ROOT, 'packages/cli/src/bin.ts'), 'utf8');
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
   * commands is what the first draft of this rule did, and it was wrong.
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

    return lines.every((line) => {
      if (!line.startsWith('variance ')) return false;
      if (!/[[<]/.test(line)) return false;

      const remaining = line
        .replace(/#.*$/, '')
        .replace(/\[[^\]]*\]/g, '')
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

/**
 * A count of the files this suite reads, stated in prose, is the count.
 *
 * Trivial to check and it has been wrong twice. The second time was a number
 * measured *mid-transaction* — two files staged as deleted and two not yet
 * tracked — which is the failure worth guarding, because the writer had just
 * run the command and had every reason to believe the answer.
 *
 * Deliberately narrow: only the phrase "N markdown files", which can mean one
 * thing. A rule that tried to check every number in the prose would be checking
 * measurements, and a measurement is a claim about a run rather than about the
 * repository as it stands.
 *
 * **"the other N" is read as N + 1**, because the root README says "this and the
 * other 68 markdown files" and is right. The alternative was to reword that
 * sentence so a simpler rule would accept it, which is the wrong direction: a
 * checker that quietly forces one phrasing is a checker that edits the prose it
 * was supposed to be checking.
 */
describe('a stated file count is the file count', () => {
  const STATED = MARKDOWN.flatMap((file) => {
    const text = prose(file);
    return [...text.matchAll(/(the other )?(\d+)\s+markdown files/g)].map(
      (match) =>
        [
          `${file}:${lineOf(text, match.index)}`,
          Number(match[2]) + (match[1] === undefined ? 0 : 1),
        ] as const,
    );
  });

  it('finds a count to check, so this rule cannot pass by reading nothing', () => {
    expect(STATED.length).toBeGreaterThan(0);
  });

  it.each(STATED)('%s', (_where, stated) => {
    expect(stated).toBe(MARKDOWN.length);
  });
});

/**
 * The specs directory means one thing: what is not finished.
 *
 * It used to mean four things at once — nine files across `not built`, `built,
 * not wired`, `built, never run` and `built` — and the states were not readable
 * from a filename or a number. Five of the nine described capabilities that
 * ship. One said `not built` while a Dockerfile for it sat in `docker/`. Another
 * named five of the CLI's six commands. A directory that has to be decoded stops
 * being read, and the debt it existed to make visible was what hid it.
 *
 * So the entry criterion is now the whole design: **a spec lives exactly as long
 * as its capability is incomplete**, and the answer to "what is left" is the file
 * listing. This holds the one thing that could quietly break it — a spec present
 * but missing from the index, or listed there and gone from disk — because either
 * puts a reader back to reading two places and believing the wrong one.
 *
 * What a spec *says* is deliberately not checked. Prose about work that has not
 * happened has nothing to check it against; that is what makes it a spec.
 */
describe('the specs directory lists exactly what is unfinished', () => {
  const INDEX = 'docs/specs/README.md';
  const index = readFileSync(join(ROOT, INDEX), 'utf8');

  const SPECS = MARKDOWN.filter((file) => /^docs\/specs\/\d{4}-/.test(file)).sort();

  /** Spec filenames the index links to, from anywhere in it. */
  const LINKED = new Set(
    [...index.matchAll(/\((\d{4}-[\w-]+\.md)\)/g)].map((match) => `docs/specs/${match[1]!}`),
  );

  it('has an index that links to something, so this cannot pass by matching nothing', () => {
    expect(LINKED.size).toBeGreaterThan(0);
  });

  it.each(SPECS)('%s is listed in the index', (file) => {
    expect([...LINKED], `${file} exists and the index does not mention it`).toContain(file);
  });

  it('links to no spec that has been discharged', () => {
    // The other direction, and the one deletion breaks: a discharged spec leaves
    // a link behind that resolves to nothing. `every link resolves` above would
    // also catch it — this says *which* rule was broken, which is the difference
    // between "fix the link" and "you deleted a spec and stopped there".
    expect([...LINKED].filter((file) => !SPECS.includes(file))).toEqual([]);
  });
});

/**
 * A documented config is parsed by the parser that would reject it.
 *
 * The same rule as the examples, one surface over: a config in a README is a file
 * a reader copies, and the only thing that decides whether it is a config is
 * `parseConfig`. A key that was renamed leaves the example looking exactly as
 * plausible as it did before, and the reader finds out from an operator error on
 * their first run.
 *
 * Identified by the comment naming the file, which is how a reader identifies it
 * too — the `mcp` README's `jsonc` block says `claude_desktop_config.json` and is
 * a different product's schema.
 */
describe('every documented config parses', () => {
  const CONFIGS = FENCES.filter(
    (fence) => fence.lang === 'jsonc' && /^\/\/\s*variance\.config\.json/.test(fence.code),
  );

  it('finds configs to check', () => {
    expect(CONFIGS.length).toBeGreaterThan(0);
  });

  it.each(CONFIGS.map((fence) => [`${fence.file}:${fence.line}`, fence] as const))('%s', (where, fence) => {
    // Comments out, because the fence is `jsonc` for the reader's benefit and the
    // file a reader saves is JSON.
    const json = fence.code.replace(/^\s*\/\/.*$/gm, '');

    expect(() =>
      parseConfig(JSON.parse(json), { source: where, baseDir: dirname(join(ROOT, fence.file)) }),
    ).not.toThrow();
  });
});
