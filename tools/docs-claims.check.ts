import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseConfig } from '@variance-authority/cli';
import { FENCES, MARKDOWN, ROOT, lineOf } from './markdown.js';

/**
 * Claims the documentation makes about the repository.
 *
 * A file count, a directory listing, a config example, a route — each one is a
 * fact stated in prose that something else in the repository also states. All
 * string work: the count from `git ls-files`, the config from the real parser,
 * the routes from the site's own directory tree.
 *
 * The claims about the command line are next door in `docs-cli.check.ts`. They
 * read one source file rather than the repository, and there are enough of them
 * to be their own question.
 */

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

  /** The backticked words in one glossary row. Column alignment is not part of it. */
  const worded = (term: string) =>
    [...(new RegExp(`^\\|\\s*\\*\\*${term}\\*\\*\\s*\\|(.+)$`, 'm').exec(INDEX)?.[1] ?? '').matchAll(
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

/** Package registries keep reference ownership; the start guide links outward. */
describe('the site routes package visitors to adopter integrations', () => {
  const GUIDE = readFileSync(join(ROOT, 'docs/start.md'), 'utf8');
  const STARTS = [
    '@variance-authority/observe',
    '@variance-authority/playwright-test',
    '@variance-authority/route-collector',
    '@variance-authority/storybook-collector',
    '@variance-authority/unit-test',
  ];

  it.each(STARTS)('names the %s start', (name) => {
    expect(GUIDE).toContain(name);
  });

  const manifests = execFileSync('git', ['ls-files', ':(glob)packages/*/package.json'], { cwd: ROOT, encoding: 'utf8' }).trim().split('\n');

  it.each(manifests)('%s links to its reference', (path) => {
    const manifest = JSON.parse(readFileSync(join(ROOT, path), 'utf8')) as { homepage?: string };
    expect(manifest.homepage).toBe(`https://variance-authority.dev/reference/packages/${path.split('/')[1]}`);
  });

  it('renders the canonical first-observation guide', () => {
    const page = readFileSync(join(ROOT, 'site/app/(docs)/start/page.tsx'), 'utf8');
    expect(page).toContain('productDocument("start")');
    expect(page).toContain('<MarkdownDocument');
  });
});

/**
 * Every competitor table on the site quotes the compared document.
 *
 * `docs/comparison.md` is the repository's one carefully sourced statement about
 * Percy, Chromatic, Argos, and Applitools — every vendor fact in it links the
 * vendor's own published page, and its second section states what each does
 * better than this project. The site does not get a second opinion: every
 * fragment a component marks with `doc()` must be a verbatim fragment of that
 * document, so a page can claim fairness as a checked property rather than a
 * tone.
 *
 * Read by glob, because the single-file version of this rule is what let the
 * landing table drift. That page renders its own component with its own `doc()`
 * marker and a comment promising this check; nothing read it, and five vendor
 * cells had turned into slash-compounds the document never wrote. The shared
 * rows now make one table, and the glob makes the marker mean the same thing in
 * whichever component a future page puts its own words in.
 *
 * Matching is case-insensitive and ignores line wrap, backticks, and curly
 * quotes, because those are formatting; the words are the claim. A fragment the
 * document does not support is not exempted, it is unmarked: the landing page's
 * footnotes say "this project" in the landing page's voice and carry no marker,
 * so `doc()` never means "quoted, except where it isn't".
 */
describe('the comparison tables quote the compared document', () => {
  const COMPONENTS = execFileSync('git', ['ls-files', 'site/app/components'], {
    cwd: ROOT,
    encoding: 'utf8',
  })
    .trim()
    .split('\n')
    .filter((file) => /Comparison[A-Za-z]*\.tsx$/.test(file));

  const flatten = (text: string): string =>
    text
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/`|\*\*/g, '')
      .replace(/[\u201c\u201d]/g, '"')
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/\s+/g, ' ')
      .toLowerCase();

  const COMPARED = flatten(readFileSync(join(ROOT, 'docs/comparison.md'), 'utf8'));

  // Block comments blanked first, because every one of these components explains
  // the marker by naming it and a header that says `doc()` is not a claim. Blanked
  // rather than removed so the line a fragment is reported at is the line it is on.
  const SOURCES = COMPONENTS.map(
    (file) =>
      [
        file,
        readFileSync(join(ROOT, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, (comment) =>
          comment.replace(/[^\n]/g, ' '),
        ),
      ] as const,
  );

  const CLAIMS = SOURCES.flatMap(([file, text]) =>
    [...text.matchAll(/doc\(\s*"((?:[^"\\]|\\.)+)"\s*,?\s*\)/g)].map(
      (match) =>
        [`${file}:${lineOf(text, match.index)}`, JSON.parse(`"${match[1]!}"`) as string] as const,
    ),
  );

  it('reads every component that quotes, so a new page cannot arrive unchecked', () => {
    // Three: the shared rows, and the framing each page puts around them. The
    // floor is what stops the glob from silently narrowing back to one file.
    expect(COMPONENTS.length).toBeGreaterThan(2);
    expect(CLAIMS.length).toBeGreaterThan(30);
  });

  it.each(SOURCES)(
    '%s parses every doc() call, so a fragment the extractor cannot read fails here',
    (file, text) => {
      expect(CLAIMS.filter(([where]) => where.startsWith(`${file}:`)).length).toBe(
        (text.match(/doc\(/g) ?? []).length,
      );
    },
  );

  it.each(CLAIMS)('%s backs "%s"', (_where, claim) => {
    expect(COMPARED).toContain(flatten(claim));
  });

  it('is rendered on the comparison page', () => {
    const page = readFileSync(join(ROOT, 'site/app/(docs)/reference/comparison/page.tsx'), 'utf8');
    expect(page).toContain('<Comparison />');
  });

  it('is routed from the landing page without duplicating the reference', () => {
    const page = readFileSync(join(ROOT, 'site/app/page.tsx'), 'utf8');
    const bargain = readFileSync(
      join(ROOT, 'site/app/components/OperatingBargain.tsx'),
      'utf8',
    );
    expect(page).toContain('<OperatingBargain />');
    expect(bargain).toContain('href="/reference/comparison"');
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
