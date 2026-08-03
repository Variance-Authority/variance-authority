import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
// The real parser, not a restatement of its schema. Requires the build, as
// everything else here does.
import { parseConfig } from '@variance-authority/cli';

/**
 * The documentation, checked against the code it describes.
 *
 * Every claim in this repository's markdown is a claim about something that is
 * also in this repository, and until now none of them were checked. A README is
 * read by someone deciding whether to adopt the thing, and by an agent deciding
 * what to call — both of them act on it, and neither can tell a sentence that was
 * true last month from one that is true now.
 *
 * The defect class is specific and it is not "typos". Prose does not rot at
 * random: it rots wherever it names something the compiler also names, because
 * the compiler renames things and the prose does not follow. So this checks
 * exactly the sentences that carry a machine-checkable name:
 *
 * 1. every relative link and `#anchor` resolves
 * 2. every `path:line` reference resolves, and lands on what the prose says is there
 * 3. every repository path written in backticks exists
 * 4. every `ts` example compiles, against the built packages, with no import it
 *    does not use
 * 5. the commands the documentation shows are the commands the binary dispatches
 *
 * Rule 4 is the one that pays, and
 * [ADR-0014](../docs/context/adr/0014-examples-are-call-sites.md) is the
 * argument for it: **an example is a call site the compiler cannot see, so it is
 * the only call site an API rename does not reach.** Eleven of the twenty
 * examples here named a signature that had existed and had since changed — a
 * removed option, a renamed field, a parameter that became required — every one
 * of them safe to change precisely because the compiler found the other call
 * sites, and every one of them left in the code a reader copies first.
 *
 * ## What a fence is compiled against
 *
 * A snippet is not a program: it names things it never declares. `renderer`,
 * `viewport`, `capture` — the reader is expected to have those already, and a
 * checker that demanded them written out would push every example towards
 * ceremony nobody would read.
 *
 * So {@link CONTEXT} supplies them, and the rule it follows is what makes this
 * worth doing: **a name is typed from the signature that consumes it**, never
 * from a type written here. `viewport` is *whatever `createPlaywrightRenderer`
 * takes*, spelled as `Parameters<…>[0]['viewport']`. Nothing in this file can
 * drift from the API, because nothing in this file restates it — and a fence
 * that reaches for a name no signature produces fails to compile, which is how a
 * plausible invention like `sourceIndex` gets caught while `source` passes.
 *
 * Requires a build, for the same reason `boundaries.test.ts` does: the fences are
 * compiled against each package's published `.d.ts`, which is the thing a
 * consumer would actually import.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const MARKDOWN: readonly string[] = execFileSync('git', ['ls-files', '*.md'], {
  cwd: ROOT,
  encoding: 'utf8',
})
  .trim()
  .split('\n');

/** Top-level directories that make a backticked path a claim about this repository. */
const REPO_DIRS = ['packages/', 'examples/', 'cases/', 'docs/', 'tools/', 'docker/', '.github/'];

/**
 * Paths and references that name something outside this repository.
 *
 * Listed with the reason rather than inferred from a pattern, so that adding one
 * is a decision somebody made rather than a hole that opened. Every entry here is
 * a path in *somebody else's* project, quoted to show what their output looks
 * like.
 */
const FOREIGN: Readonly<Record<string, string>> = {
  // Playwright's own failure message, quoted in the comparison.
  'tests/home.spec.ts': "an incumbent's spec file, quoted from its output",

  // esbuild's error, quoted verbatim in a journal. `dist/` is generated and
  // untracked, so the reference is to a build output rather than to source —
  // and editing a quoted error message to keep a checker happy would falsify
  // the record of what the tool actually said.
  'packages/core/dist/hash.js': 'a build artifact named in a quoted bundler error',
};

interface Fence {
  readonly file: string;
  /** Line of the opening ``` in the markdown, 1-based. */
  readonly line: number;
  readonly lang: string;
  readonly code: string;
}

function fencesIn(file: string): readonly Fence[] {
  const text = readFileSync(join(ROOT, file), 'utf8');
  const found: Fence[] = [];

  for (const match of text.matchAll(/^```([\w-]*)\n([\s\S]*?)^```/gm)) {
    found.push({
      file,
      line: text.slice(0, match.index).split('\n').length,
      lang: match[1] ?? '',
      code: match[2] ?? '',
    });
  }
  return found;
}

const FENCES = MARKDOWN.flatMap(fencesIn);

/** Markdown with the fenced blocks blanked out, so a prose rule cannot read an example. */
function prose(file: string): string {
  return readFileSync(join(ROOT, file), 'utf8').replace(
    /^```[\w-]*\n[\s\S]*?^```/gm,
    (block) => block.replace(/[^\n]/g, ' '),
  );
}

function lineOf(text: string, index: number): number {
  return text.slice(0, index).split('\n').length;
}

describe('every link resolves', () => {
  const slug = (heading: string): string =>
    heading
      .toLowerCase()
      .replace(/`/g, '')
      .replace(/[^\w\- ]/g, '')
      .trim()
      .replace(/ /g, '-');

  const headings = (file: string): ReadonlySet<string> => {
    const found = new Set<string>();
    let fenced = false;

    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (/^\s*```/.test(line)) fenced = !fenced;
      else if (!fenced) {
        const heading = /^#{1,6}\s+(.*)$/.exec(line);
        if (heading !== null) found.add(slug(heading[1]!));
      }
    }
    return found;
  };

  it.each(MARKDOWN)('%s', (file) => {
    const text = readFileSync(join(ROOT, file), 'utf8');
    const broken: string[] = [];

    for (const match of text.matchAll(/\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
      const target = match[2]!;
      if (/^(https?:|mailto:)/.test(target)) continue;

      // A bare `#anchor` splits to an empty path, which resolves to this file —
      // so an in-page link is checked against this file's own headings.
      const [path, anchor] = target.split('#') as [string, string | undefined];
      const resolved = path === '' ? join(ROOT, file) : resolve(dirname(join(ROOT, file)), path);

      if (!existsSync(resolved)) {
        broken.push(`${file}:${lineOf(text, match.index)} → ${target}`);
        continue;
      }
      if (anchor === undefined) continue;

      const document = statSync(resolved).isDirectory() ? join(resolved, 'README.md') : resolved;
      if (!existsSync(document) || !document.endsWith('.md')) {
        broken.push(`${file}:${lineOf(text, match.index)} → ${target} (anchor on a non-document)`);
        continue;
      }
      if (!headings(document).has(anchor)) {
        broken.push(`${file}:${lineOf(text, match.index)} → ${target} (no such heading)`);
      }
    }

    expect(broken).toEqual([]);
  });
});

/**
 * A path in backticks is a claim that the file is there.
 *
 * Only paths under this repository's own directories: `variance.config.json` and
 * `storybook-static/index.json` are things a *reader* has, and a checker that
 * demanded they exist here would be checking the wrong repository.
 */
describe('every path named in prose exists', () => {
  it.each(MARKDOWN)('%s', (file) => {
    const text = prose(file);
    const missing: string[] = [];

    for (const match of text.matchAll(/`([\w./@-]+\.\w{1,5})(?::\d+)?`/g)) {
      const path = match[1]!;
      if (!REPO_DIRS.some((dir) => path.startsWith(dir))) continue;
      if (path in FOREIGN) continue;
      if (!existsSync(join(ROOT, path))) missing.push(`${file}:${lineOf(text, match.index)} → ${path}`);
    }

    expect(missing).toEqual([]);
  });
});

/**
 * `Component src/file.tsx:42` is two claims, and the second is the one that rots.
 *
 * The file moves and the line number does not, so the reference keeps resolving
 * and starts landing on something else. Twelve of these were pointing at
 * unrelated source before anybody read one. Where the prose names what is there,
 * the line has to define it.
 */
describe('every file:line reference lands where it says', () => {
  const TRACKED = new Set(
    execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).trim().split('\n'),
  );

  /**
   * The file a reference names, resolved the way a reader would resolve it.
   *
   * Relative to the document first, then from the repository root, then by unique
   * suffix — a case's README says `src/surface.tsx` about its own tree, and the
   * index one directory up says the same words about the same file.
   */
  function locate(file: string, path: string): string | null {
    const beside = relative(ROOT, resolve(dirname(join(ROOT, file)), path));
    if (TRACKED.has(beside)) return beside;
    if (TRACKED.has(path)) return path;

    const suffix = [...TRACKED].filter((tracked) => tracked.endsWith(`/${path}`));
    return suffix.length === 1 ? suffix[0]! : null;
  }

  it.each(MARKDOWN)('%s', (file) => {
    const text = readFileSync(join(ROOT, file), 'utf8');
    const wrong: string[] = [];

    for (const match of text.matchAll(
      /(?:([A-Z][A-Za-z0-9_]*)\s+)?`?([\w./-]+\.(?:tsx?|mjs|cjs|js|jsx))`?:(\d+)/g,
    )) {
      const [, named, path = '', digits = ''] = match;
      if (path in FOREIGN) continue;

      const where = `${file}:${lineOf(text, match.index)}`;
      const target = locate(file, path);
      if (target === null) {
        wrong.push(`${where} → ${path} (no such file)`);
        continue;
      }

      const lines = readFileSync(join(ROOT, target), 'utf8').split('\n');
      const line = Number(digits);
      if (line < 1 || line > lines.length) {
        wrong.push(`${where} → ${target}:${line} (the file has ${lines.length} lines)`);
        continue;
      }

      // Only when the prose names what is there. `at packages/core/src/region.ts:82`
      // claims a place and nothing about it; `Heading src/surface.tsx:153` claims
      // that line 153 is where `Heading` is.
      if (named !== undefined && !new RegExp(`\\b${named}\\b`).test(lines[line - 1]!)) {
        wrong.push(`${where} → ${target}:${line} does not mention ${named}: ${lines[line - 1]!.trim()}`);
      }
    }

    expect(wrong).toEqual([]);
  });
});

/**
 * What a fence may reach for, and where each name's type comes from.
 *
 * The key is a bare name, or `<markdown path>#<name>` when two examples use one
 * word for two things — `before` is a pair of documents to `observe` and a pair
 * of rasters to `png`, and collapsing them would type-check both against
 * whichever won.
 *
 * The value is a type *expression*, and it may not name a type this file
 * invented. Every entry reads its type out of the signature that consumes the
 * name, so the day an option is renamed the fence using it stops compiling
 * rather than being quietly re-typed here.
 */
const CONTEXT: Readonly<Record<string, string>> = {
  // core
  capture: `Parameters<typeof import('@variance-authority/core').normalize>[0]`,
  recapture: `Parameters<typeof import('@variance-authority/core').normalize>[0]`,
  mask: `Parameters<typeof import('@variance-authority/core').isolateRegions>[0]`,

  // dom / react
  container: `Parameters<typeof import('@variance-authority/dom').collect>[0]`,
  subject: `Parameters<typeof import('@variance-authority/dom').acquireDocument>[1]['subject']`,
  fonts: `NonNullable<Parameters<typeof import('@variance-authority/dom').acquireDocument>[1]['fonts']>`,
  viewport: `Parameters<typeof import('@variance-authority/dom').acquireDocument>[1]['viewport']`,

  // observe
  renderer: `import('@variance-authority/observe').ObserveOptions['renderer']`,
  store: `import('@variance-authority/observe').ObserveOptions['store']`,
  snapshot: `NonNullable<import('@variance-authority/observe').ObserveOptions['snapshot']>`,
  source: `NonNullable<import('@variance-authority/observe').ObserveOptions['source']>`,
  'packages/observe/README.md#before': `Parameters<typeof import('@variance-authority/observe').observePair>[0]`,
  'packages/observe/README.md#after': `Parameters<typeof import('@variance-authority/observe').observePair>[1]`,
  'packages/observe/README.md#document': `Parameters<typeof import('@variance-authority/observe').observeAgainstBaseline>[0]`,

  // png
  before: `Parameters<typeof import('@variance-authority/png').compareRasters>[0]`,
  after: `Parameters<typeof import('@variance-authority/png').compareRasters>[1]`,
  chromiumPng: `Parameters<typeof import('@variance-authority/png/difference').observePngDifference>[0]['firstImage']`,
  webkitPng: `Parameters<typeof import('@variance-authority/png/difference').observePngDifference>[0]['secondImage']`,

  // raster
  first: `Parameters<typeof import('@variance-authority/raster').gateStability>[0][number]`,
  second: `Parameters<typeof import('@variance-authority/raster').gateStability>[0][number]`,
  chromiumPixels: `Parameters<typeof import('@variance-authority/raster/difference').observeDifference>[0]['firstImage']`,
  webkitPixels: `Parameters<typeof import('@variance-authority/raster/difference').observeDifference>[0]['secondImage']`,
  current: `Awaited<ReturnType<typeof import('@variance-authority/raster/difference').observeDifference>>`,

  // playwright / remote
  'packages/playwright/README.md#document': `Parameters<Awaited<ReturnType<typeof import('@variance-authority/playwright').createPlaywrightRenderer>>['render']>[0]`,
  iifeBundleInstallingYourAgent: `Parameters<typeof import('@variance-authority/playwright').createHarness>[0]['bundle']`,
  harness: `Parameters<typeof import('@variance-authority/storybook').harnessPage>[0]`,

  // report / mcp / history / server
  runReport: `Parameters<typeof import('@variance-authority/report/file').writeRunReport>[1]`,
  report: `Parameters<NonNullable<ReturnType<typeof import('@variance-authority/mcp/tools').toolByName>>['run']>[0]`,
  token:`Parameters<typeof import('@variance-authority/server').serveHistory>[0]['token']`,

  // session — the one place a fence invents a shape, because the loop it shows is
  // the reader's own: a list of things to render, which this package never names.
  'packages/session/README.md#document': `Parameters<typeof import('@variance-authority/session').createSession>[0]['document']`,
  createRoot: `typeof import('react-dom/client').createRoot`,
  subjects: `readonly {
    readonly ref: Parameters<ReturnType<typeof import('@variance-authority/session').createSession>['run']>[0];
    readonly element: Parameters<ReturnType<typeof import('react-dom/client').createRoot>['render']>[0];
  }[]`,
};

/** Names a fence declares itself, which the prelude must not declare again. */
function declaredIn(source: ts.SourceFile): ReadonlySet<string> {
  const names = new Set<string>();

  const add = (name: ts.BindingName): void => {
    if (ts.isIdentifier(name)) names.add(name.text);
    else for (const element of name.elements) if (!ts.isOmittedExpression(element)) add(element.name);
  };

  for (const statement of source.statements) {
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) add(declaration.name);
    } else if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) {
      if (statement.name !== undefined) names.add(statement.name.text);
    } else if (ts.isImportDeclaration(statement)) {
      for (const name of importedNames(statement)) names.add(name);
    }
  }
  return names;
}

function importedNames(statement: ts.ImportDeclaration): readonly string[] {
  const clause = statement.importClause;
  if (clause === undefined) return [];

  const names = clause.name === undefined ? [] : [clause.name.text];
  const bindings = clause.namedBindings;

  if (bindings === undefined) return names;
  if (ts.isNamespaceImport(bindings)) return [...names, bindings.name.text];
  return [...names, ...bindings.elements.map((element) => element.name.text)];
}

interface Checked extends Fence {
  /** Absolute path of the file handed to the compiler; never written to disk. */
  readonly path: string;
  readonly text: string;
  /** Prelude lines prepended, so a diagnostic can be reported against the markdown. */
  readonly offset: number;
  readonly source: ts.SourceFile;
}

/**
 * Where a proposal lives, decided by directory rather than by filename.
 *
 * `docs/specs/README.md` ends in `README.md` and is not an example; a fence added
 * to it would have gone to the compiler under the old filename rule. The two
 * buckets happen to partition every `ts` fence today, and `every fence is checked
 * one way or the other` below is what keeps that an arrangement rather than an
 * accident.
 */
const PROPOSAL_DIRS = ['docs/specs/', 'docs/context/adr/'];

const isTypeScript = (fence: Fence): boolean => fence.lang === 'ts' || fence.lang === 'tsx';
const isProposal = (fence: Fence): boolean => PROPOSAL_DIRS.some((dir) => fence.file.startsWith(dir));
const isExample = (fence: Fence): boolean => !isProposal(fence) && fence.file.endsWith('README.md');

/**
 * Examples, which are READMEs only, and the distinction is not a convenience.
 *
 * A fence in a README is an instruction: it is there to be copied, and a reader
 * who copies it runs it. A fence in a spec or an ADR is a *proposal* — spec 0007
 * is `not built`, and an interface in a spec describes the code the spec exists
 * to argue for. Demanding those compile would invert what a spec is.
 *
 * They are not unchecked, though: see `every type a proposal names still exists`
 * below, which asks the weaker question a proposal can answer.
 */
const EXAMPLES: readonly Checked[] = FENCES.filter((fence) => isTypeScript(fence) && isExample(fence)).map(
  (fence) => {
    const parsed = ts.createSourceFile('fence.tsx', fence.code, ts.ScriptTarget.ES2022, true);
    const declared = declaredIn(parsed);

    const prelude = Object.entries(CONTEXT)
      .filter(([key]) => {
        const [scope, name] = key.includes('#') ? (key.split('#') as [string, string]) : [null, key];
        if (scope !== null && scope !== fence.file) return false;
        if (scope === null && `${fence.file}#${name}` in CONTEXT) return false;
        return !declared.has(name) && new RegExp(`\\b${name}\\b`).test(fence.code);
      })
      .map(([key, type]) => `declare const ${key.split('#').pop()!}: ${type};`);

    const text = `${prelude.join('\n')}\n${fence.code}`;
    return {
      ...fence,
      path: join(ROOT, dirname(fence.file), '__example__', `${fence.line}.${fence.lang}`),
      text,
      offset: prelude.length + 1,
      source: ts.createSourceFile('fence.tsx', text, ts.ScriptTarget.ES2022, true),
    };
  },
);

/**
 * One program over every example, compiled against what a consumer would import.
 *
 * The files are virtual and sit next to the README they came from, so
 * `@variance-authority/observe` resolves the way it does for anybody else in this
 * workspace: through the package's `exports`, to its built `.d.ts`.
 */
const DIAGNOSTICS: ReadonlyMap<string, readonly ts.Diagnostic[]> = (() => {
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    lib: ['lib.es2022.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    types: ['node'],
    jsx: ts.JsxEmit.ReactJSX,
    strict: true,
    exactOptionalPropertyTypes: true,
    noUncheckedIndexedAccess: true,
    verbatimModuleSyntax: true,
    skipLibCheck: true,
    noEmit: true,
  };

  const virtual = new Map(EXAMPLES.map((example) => [example.path, example.text]));
  const host = ts.createCompilerHost(options, true);
  const readReal = host.readFile.bind(host);
  const existsReal = host.fileExists.bind(host);
  const sourceReal = host.getSourceFile.bind(host);

  const program = ts.createProgram([...virtual.keys()], options, {
    ...host,
    fileExists: (file) => virtual.has(file) || existsReal(file),
    readFile: (file) => virtual.get(file) ?? readReal(file),
    getSourceFile: (file, language, onError, shouldCreate) => {
      const text = virtual.get(file);
      return text === undefined
        ? sourceReal(file, language, onError, shouldCreate)
        : ts.createSourceFile(file, text, language, true);
    },
  });

  const byFile = new Map<string, ts.Diagnostic[]>();
  for (const diagnostic of [...program.getSyntacticDiagnostics(), ...program.getSemanticDiagnostics()]) {
    const file = diagnostic.file?.fileName;
    if (file === undefined || !virtual.has(file)) continue;
    byFile.set(file, [...(byFile.get(file) ?? []), diagnostic]);
  }
  return byFile;
})();

describe('every documented example compiles', () => {
  it('finds examples to check', () => {
    // A regex that stops matching would turn this whole suite green by checking
    // nothing, which is the failure mode of every documentation checker.
    expect(EXAMPLES.length).toBeGreaterThan(15);
  });

  it('supplies no name that no example uses', () => {
    // {@link CONTEXT} is documentation about documentation, and it rots the same
    // way: an entry left behind by an edited example keeps a type expression
    // alive against an API nobody is demonstrating any more.
    const dead = Object.keys(CONTEXT).filter((key) => {
      const [scope, name] = key.includes('#') ? (key.split('#') as [string, string]) : [null, key];
      return !EXAMPLES.some(
        (example) =>
          (scope === null || scope === example.file) && new RegExp(`\\b${name}\\b`).test(example.code),
      );
    });

    expect(dead).toEqual([]);
  });

  it.each(EXAMPLES.map((example) => [`${example.file}:${example.line}`, example] as const))(
    '%s',
    (_where, example) => {
      const reported = (DIAGNOSTICS.get(example.path) ?? []).map((diagnostic) => {
        const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ');
        if (diagnostic.start === undefined) return message;

        const { line } = example.source.getLineAndCharacterOfPosition(diagnostic.start);
        // Reported against the markdown, because that is the file somebody edits.
        // `+ 1` twice: zero-based line, and the opening fence itself.
        return `${example.file}:${example.line + 1 + line - example.offset + 1}: ${message}`;
      });

      expect(reported).toEqual([]);
    },
  );

  it.each(EXAMPLES.map((example) => [`${example.file}:${example.line}`, example] as const))(
    '%s imports nothing it does not use',
    (_where, example) => {
      const imported = new Set<string>();
      for (const statement of example.source.statements) {
        if (ts.isImportDeclaration(statement)) for (const name of importedNames(statement)) imported.add(name);
      }

      const used = new Set<string>();
      const walk = (node: ts.Node): void => {
        if (ts.isIdentifier(node) && !ts.isImportSpecifier(node.parent) && !ts.isImportClause(node.parent)) {
          used.add(node.text);
        }
        ts.forEachChild(node, walk);
      };
      ts.forEachChild(example.source, walk);

      // An import the example never calls is the example telling a reader to
      // install a name that does nothing — and it is what a broken example looks
      // like after somebody edited the code around it and not the imports.
      expect([...imported].filter((name) => !used.has(name))).toEqual([]);
    },
  );
});

/**
 * The weaker question a proposal can answer.
 *
 * A spec's fence cannot be compiled — it describes code the spec exists to argue
 * for — but it does not only propose. It also *borrows*: `Digest`, `ProfileId`,
 * `SemanticSnapshot` are the repository's, quoted so the proposal has something to
 * attach to. Those borrowed names are checkable, and the mechanism needs no status
 * field and no allowlist, because **a proposal declares what it proposes and
 * references what already exists** — so subtracting the declarations is the
 * not-built exemption.
 *
 * ## What this catches, and the much larger thing it does not
 *
 * It catches a rename to *nothing*: `Digest` becoming `Hash` with no `Digest` left
 * anywhere. It does **not** catch a rename to something else, and it does not
 * compare shapes at all. Spec 0002 was measured against its own implementation
 * while this was written: every type it names exists, and its `HistoryStore` had
 * drifted in all five methods anyway. That defect was found by reading and fixed
 * by hand, and nothing here would have found it — see ADR-0014 for why member
 * comparison was tried and rejected rather than merely skipped.
 */
const PROPOSAL_FENCES = FENCES.filter((fence) => isTypeScript(fence) && isProposal(fence));

/**
 * TypeScript's own, listed one at a time rather than exempting `lib.*.d.ts`.
 *
 * Exempting the whole lib would drop `Window`, which this repository declares in
 * `packages/history/src/store.ts` and spec 0002 names three times — a rename of it
 * would silently resolve to `lib.dom`'s and say nothing. The two hygiene tests
 * below are what keep this list from growing into that hole.
 */
const BUILT_IN: Readonly<Record<string, string>> = {
  Partial: "TypeScript's own utility type",
  Record: "TypeScript's own utility type",
  Promise: "the language's",
};

/** Every exported type-ish declaration in tracked source, by name. Source, so no build is needed. */
const DECLARED: ReadonlyMap<string, readonly string[]> = (() => {
  const found = new Map<string, string[]>();
  const files = execFileSync('git', ['ls-files', '*.ts', '*.tsx'], { cwd: ROOT, encoding: 'utf8' })
    .trim()
    .split('\n')
    .filter((file) => !/\.(test|spec)\.tsx?$/.test(file));

  for (const file of files) {
    const source = ts.createSourceFile(file, readFileSync(join(ROOT, file), 'utf8'), ts.ScriptTarget.ES2022, true);
    for (const statement of source.statements) {
      const exported =
        ts.canHaveModifiers(statement) &&
        ts.getModifiers(statement)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) === true;
      if (!exported) continue;

      const name =
        ts.isInterfaceDeclaration(statement) ||
        ts.isTypeAliasDeclaration(statement) ||
        ts.isClassDeclaration(statement) ||
        ts.isEnumDeclaration(statement) ||
        ts.isFunctionDeclaration(statement)
          ? statement.name?.text
          : undefined;
      if (name === undefined) continue;

      const line = source.getLineAndCharacterOfPosition(statement.getStart(source)).line + 1;
      found.set(name, [...(found.get(name) ?? []), `${file}:${line}`]);
    }
  }
  return found;
})();

/**
 * Type names a fence references, minus the ones it declares itself.
 *
 * The shapes matter. Two of the fences here are fragments — an interface member,
 * an object literal — so each is tried as statements, as an interface body, and as
 * a type alias, and the **union** over every shape that parses cleanly is taken.
 * Not the first clean one: `{ expect: Band }` parses as a labelled statement with
 * zero diagnostics and yields no references at all, so "first clean" would report
 * a checked fence that checked nothing, which is the silent pass this repository
 * refuses everywhere else.
 */
function referencedTypes(code: string): { readonly names: ReadonlySet<string>; readonly read: boolean } {
  const shapes = [code, `interface __Fence__ {\n${code}\n}`, `type __Fence__ = ${code};`];
  const names = new Set<string>();
  const declared = new Set<string>();
  let read = false;

  for (const shape of shapes) {
    const source = ts.createSourceFile('proposal.ts', shape, ts.ScriptTarget.ES2022, true);
    // `parseDiagnostics` is not on the public type, and is the only way to ask
    // whether recovery happened; a recovered parse invents nodes.
    const diagnostics = (source as unknown as { parseDiagnostics?: readonly unknown[] }).parseDiagnostics ?? [];
    if (diagnostics.length > 0) continue;
    read = true;

    const walk = (node: ts.Node): void => {
      if (ts.isTypeReferenceNode(node) || ts.isExpressionWithTypeArguments(node)) {
        const entity = ts.isTypeReferenceNode(node) ? node.typeName : node.expression;
        let leftmost: ts.Node = entity;
        while (ts.isQualifiedName(leftmost)) leftmost = leftmost.left;
        if (ts.isIdentifier(leftmost)) names.add(leftmost.text);
      }
      if (
        (ts.isInterfaceDeclaration(node) ||
          ts.isTypeAliasDeclaration(node) ||
          ts.isClassDeclaration(node) ||
          ts.isFunctionDeclaration(node)) &&
        node.name !== undefined
      ) {
        declared.add(node.name.text);
      }
      if (ts.isTypeParameterDeclaration(node)) declared.add(node.name.text);
      ts.forEachChild(node, walk);
    };
    ts.forEachChild(source, walk);
  }

  declared.add('__Fence__');
  return { names: new Set([...names].filter((name) => !declared.has(name))), read };
}

describe('every type a proposal names still exists', () => {
  const ROSTER = new Set(PROPOSAL_FENCES.flatMap((fence) => [...referencedTypes(fence.code).names]));

  it('checks every ts fence one way or the other', () => {
    // A fence that is neither compiled nor name-checked is a fence nothing reads.
    // Adding one to a journal, or to `docs/architecture.md`, has to be a decision
    // rather than a default.
    const unchecked = FENCES.filter((fence) => isTypeScript(fence) && !isExample(fence) && !isProposal(fence));
    expect(unchecked.map((fence) => `${fence.file}:${fence.line}`)).toEqual([]);
  });

  it('finds proposals to check', () => {
    expect(PROPOSAL_FENCES.length).toBeGreaterThan(0);
  });

  it.each(PROPOSAL_FENCES.map((fence) => [`${fence.file}:${fence.line}`, fence] as const))(
    '%s is readable',
    (_where, fence) => {
      // A fence no shape can parse would otherwise be exempt in silence. An
      // elision written as `…` is the likely cause, and the fix is to write a
      // fragment TypeScript can parse rather than to widen this.
      expect(referencedTypes(fence.code).read).toBe(true);
    },
  );

  it.each(PROPOSAL_FENCES.map((fence) => [`${fence.file}:${fence.line}`, fence] as const))(
    '%s',
    (where, fence) => {
      const missing = [...referencedTypes(fence.code).names]
        .filter((name) => !(name in BUILT_IN) && !DECLARED.has(name))
        .map((name) => `${where} → ${name}`);

      // A spec borrows names from code that exists. When one stops existing, the
      // fence still reads as though it had not.
      expect(missing).toEqual([]);
    },
  );

  it('exempts no built-in this repository also declares', () => {
    // The `Window` guard. An exemption that shadows a real type is a hole shaped
    // exactly like a passing test.
    expect(Object.keys(BUILT_IN).filter((name) => DECLARED.has(name))).toEqual([]);
  });

  it('exempts no built-in no proposal names', () => {
    expect(Object.keys(BUILT_IN).filter((name) => !ROSTER.has(name))).toEqual([]);
  });
});

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
   * The two rules above are each half-blind in the same place. `spec 0003`
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
 * A spec says what it is, once.
 *
 * Three places carry a spec's status — its own header, the vocabulary that
 * defines the words, and the sequence table that lists every spec — and they
 * have already disagreed: two `built` specs contradicted their own headers a
 * commit ago, and the table's prose still described a spec as greenfield while a
 * Dockerfile for it sat in `docker/`. A status is the one field a reader uses to
 * decide whether to implement something, so a stale one costs a session.
 *
 * Checked rather than argued, because the three copies exist for good reasons —
 * a reader opening one spec should not have to open the index, and a reader
 * scanning the index should not have to open nine files — and the cost of a
 * legitimate duplication is that something has to hold it together.
 */
describe('every spec agrees with the index about itself', () => {
  const INDEX = readFileSync(join(ROOT, 'docs/specs/README.md'), 'utf8');

  const SPECS = MARKDOWN.filter((file) => /^docs\/specs\/\d{4}-/.test(file)).sort();

  /** The words the vocabulary table defines, which are the only ones a spec may use. */
  const VOCABULARY = [...INDEX.matchAll(/^\| `([^`]+)` \| /gm)].map((match) => match[1]!);

  /** `| [0001](0001-…md) | … | … | `status` | … |` — number to status. */
  const LISTED = new Map(
    [...INDEX.matchAll(/^\| \[(\d{4})\]\([^)]+\) \|[^|]*\|[^|]*\| `([^`]+)` \|/gm)].map(
      (match) => [match[1]!, match[2]!] as const,
    ),
  );

  const statusOf = (file: string): string | null =>
    /^\*\*Status:\*\* `([^`]+)`/m.exec(readFileSync(join(ROOT, file), 'utf8'))?.[1] ?? null;

  it('reads a vocabulary and a sequence table out of the index', () => {
    expect(VOCABULARY.length).toBeGreaterThan(0);
    expect(LISTED.size).toBe(SPECS.length);
  });

  it.each(SPECS)('%s', (file) => {
    const number = /(\d{4})-/.exec(file)![1]!;
    const status = statusOf(file);

    expect(status, `${file} states no status`).not.toBeNull();
    expect(VOCABULARY, `${file} uses a word the vocabulary does not define`).toContain(status);
    expect(LISTED.get(number), `the sequence table and ${file} disagree`).toBe(status);
  });

  it('lists no spec that does not exist', () => {
    expect([...LISTED.keys()].filter((number) => !SPECS.some((file) => file.includes(`/${number}-`)))).toEqual([]);
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
