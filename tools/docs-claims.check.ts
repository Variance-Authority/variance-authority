import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseConfig } from '@variance-authority/cli';
import { FENCES, MARKDOWN, ROOT, fencesIn, lineOf } from './markdown.js';

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

/**
 * Every package the documentation names is a package that exists.
 *
 * ADR-0042 renamed packages for what they are *for* rather than what they
 * import, and a rename is exactly the event prose cannot survive on its own:
 * the code moves in one commit and the sentence describing it keeps working,
 * because a sentence has no compiler. A reader who runs `yarn add` on a name
 * this repository retired gets a registry error and no way to guess the new one.
 *
 * Source is checked alongside prose, and that is where the rule earned itself:
 * two example scripts still imported a `harness-playwright` package under this
 * scope, a name the rename retired, so both had been failing at module
 * resolution with their READMEs still advertising the command. Nothing else looks at them —
 * neither is imported by a test, which is what let them rot quietly.
 *
 * `docs/context/` is excluded on purpose. ADRs and journals are a record of what
 * was decided when, and an ADR that names the package it decided to rename is
 * correct precisely because that package no longer exists.
 */
describe('every package this repository names exists', () => {
  const WORKSPACES = new Set(
    execFileSync('git', ['ls-files', 'package.json', '*/package.json', '*/*/package.json'], {
      cwd: ROOT,
      encoding: 'utf8',
    })
      .trim()
      .split('\n')
      .map((file) => JSON.parse(readFileSync(join(ROOT, file), 'utf8')).name as string),
  );

  const SOURCE = execFileSync(
    'git',
    ['ls-files', '*.ts', '*.tsx', '*.js', '*.jsx', '*.mjs'],
    { cwd: ROOT, encoding: 'utf8' },
  )
    .trim()
    .split('\n')
    .filter((file) => existsSync(join(ROOT, file)));

  const NAMED = [
    ...MARKDOWN.filter((file) => !file.startsWith('docs/context/')),
    ...SOURCE,
  ].flatMap((file) => {
    const text = readFileSync(join(ROOT, file), 'utf8');
    return [...text.matchAll(/@variance-authority\/[a-z0-9-]+/g)].map(
      (match) => [`${file}:${lineOf(text, match.index)}`, match[0]] as const,
    );
  });

  it('finds names to check, so this rule cannot pass by reading nothing', () => {
    expect(NAMED.length).toBeGreaterThan(20);
    expect(WORKSPACES.size).toBeGreaterThan(20);
  });

  it.each(NAMED)('%s names %s', (_where, name) => {
    expect([...WORKSPACES], `${name} is documented and no workspace is called that`).toContain(
      name,
    );
  });
});

/** A box is a directory directly under `packages/`; nothing deeper is one. */
const PACKAGES = execFileSync('git', ['ls-files', 'packages/*/package.json'], {
  cwd: ROOT,
  encoding: 'utf8',
})
  .trim()
  .split('\n')
  // `*` matches `/` in a git pathspec, so this glob also reaches the miniature
  // workspace `packages/package` keeps under `src/__fixtures__`.
  .filter((file) => file.split('/').length === 3)
  .map((file) => file.split('/')[1]!);

/**
 * The inventory in `docs/architecture.md` is the package list, not a sample of it.
 *
 * That table answers *what does this cost me* — one row per box, with what a
 * consumer must supply — and a reader who finds a list stops looking. It has gone
 * stale once already: 331c6fa repaired seventeen rows against twenty-three
 * directories, on the argument that a table omitting a quarter of the answer is
 * worse than no table at all. It went stale again the moment a twenty-fifth
 * package landed, in a commit whose build, lint, checks and suite were all green,
 * because nothing read it.
 *
 * Both directions, because they fail differently. A missing row hides a box from
 * the only place that enumerates them; a row with no directory sells something
 * that is not there.
 */
describe('the architecture inventory lists every package', () => {
  const INVENTORY =
    readFileSync(join(ROOT, 'docs/architecture.md'), 'utf8')
      .split('\n## ')
      .find((section) => section.startsWith('Packages\n')) ?? '';

  const LISTED = [...INVENTORY.matchAll(/^\| `([a-z0-9-]+)` \|/gm)].map((match) => match[1]!);

  it('finds a table to check, so this rule cannot pass by reading nothing', () => {
    expect(PACKAGES.length).toBeGreaterThan(20);
    expect(LISTED.length).toBeGreaterThan(20);
  });

  it('lists every package there is, and nothing that is not one', () => {
    expect([...LISTED].sort()).toEqual([...PACKAGES].sort());
  });
});

/**
 * The vocabulary the documentation index defines is the vocabulary the code has.
 *
 * `docs/README.md` is the first page an outside reader opens, and the only place
 * that says what a band, a digest, a root, a docket or a verdict is. A glossary
 * is the worst thing in a repository to leave unchecked: it is written once, read
 * by everyone who arrives after, and nothing about a stale entry looks wrong.
 *
 * Both lists come out of the source rather than out of the built package, so this
 * fails on the commit that renames a band and not on the one that rebuilds.
 */
describe('the documented vocabulary is the real one', () => {
  const INDEX = readFileSync(join(ROOT, 'docs/README.md'), 'utf8');

  /** The backticked words in one table row of the glossary. */
  const worded = (term: string) =>
    [...(new RegExp(`^\\| \\*\\*${term}\\*\\* \\|(.+)$`, 'm').exec(INDEX)?.[1] ?? '').matchAll(
      /`([a-z-]+)`/g,
    )].map((match) => match[1]!);

  const listed = (file: string, name: string) =>
    [...(new RegExp(`${name}[^=]*= \\[([^\\]]+)\\]`).exec(readFileSync(join(ROOT, file), 'utf8'))?.[1] ?? '')
      .matchAll(/'([a-z-]+)'/g)].map((match) => match[1]!);

  it('finds a glossary to check, so this rule cannot pass by reading nothing', () => {
    expect(worded('band').length).toBeGreaterThan(3);
    expect(worded('verdict').length).toBeGreaterThan(3);
  });

  it('names every band, in the order the loudest one is read from', () => {
    expect(worded('band')).toEqual(listed('packages/core/src/compare/band.ts', 'const BANDS'));
  });

  it('names every verdict, in severity order, and `unobserved` after them', () => {
    expect(worded('verdict')).toEqual([
      ...listed('packages/core/src/judge/verdict.ts', 'const SEVERITY'),
      'unobserved',
    ]);
  });
});

/**
 * The fleet listing on the site is the one every manifest points at.
 *
 * All 28 manifests set `homepage` to the `#packages` anchor, so a package the
 * grid does not name publishes a registry link to a page that does not mention
 * it. The grid also went unrendered once — written, imported by nothing, and
 * therefore checked by nothing — which is how it came to list 22 of 25 boxes
 * without a single failing test.
 *
 * Against the package directories rather than against the architecture table, so
 * the site and the documentation cannot agree with each other and both be wrong.
 */
describe('the site names every package', () => {
  const GRID = readFileSync(join(ROOT, 'site/app/components/Packages.tsx'), 'utf8');

  const NAMED = [...GRID.matchAll(/\bname: "([a-z0-9-]+)"/g)].map((match) => match[1]!);

  it('finds a grid to check, so this rule cannot pass by reading nothing', () => {
    expect(NAMED.length).toBeGreaterThan(20);
  });

  it('shows every package there is, and nothing that is not one', () => {
    expect([...NAMED].sort()).toEqual([...PACKAGES].sort());
  });

  it('is on the page the anchor promises', () => {
    const page = readFileSync(join(ROOT, 'site/app/page.tsx'), 'utf8');
    expect(page).toContain('<Packages />');
    expect(GRID).toContain('id="packages"');
  });
});

/**
 * Every relative link goes somewhere.
 *
 * The cheapest rule here and the one with the widest reach: documentation that
 * cross-references itself is documentation that can be moved out from under its
 * own references. Absolute links are left alone — an external URL that rots is
 * the other end's decision, and checking it would make this suite need a network.
 */
describe('every relative link resolves', () => {
  const LINKS = MARKDOWN.flatMap((file) => {
    const text = readFileSync(join(ROOT, file), 'utf8');
    return [...text.matchAll(/\]\(([^)\s]+)\)/g)]
      .map((match) => [`${file}:${lineOf(text, match.index)}`, match[1]!] as const)
      .filter(([, target]) => !/^(?:https?:|mailto:|#)/.test(target))
      .map(([where, target]) => [where, target, resolve(dirname(join(ROOT, file)), target.replace(/[#?].*$/, ''))] as const);
  });

  it('finds links to check, so this rule cannot pass by reading nothing', () => {
    expect(LINKS.length).toBeGreaterThan(50);
  });

  it.each(LINKS)('%s links to %s', (_where, target, path) => {
    expect(existsSync(path), `${target} is linked and nothing is there`).toBe(true);
  });
});
