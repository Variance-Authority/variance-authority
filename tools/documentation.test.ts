import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

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
 * Rule 4 is the one that pays. Four packages have shipped an example that could
 * not run — a `const` used before its declaration, an import never called, an
 * option named something the function does not accept — and every one of them
 * was copied from a README by whoever wrote it, which is exactly what a reader
 * does with it next. An example is the only part of a README that can be
 * *executed*, and until it is, it is the part most likely to be wrong.
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
 * Examples, which are READMEs only, and the distinction is not a convenience.
 *
 * A fence in a README is an instruction: it is there to be copied, and a reader
 * who copies it runs it. A fence in a spec or an ADR is a *proposal* — specs 0001
 * and 0002 are marked `not built`, and their interfaces describe types that do
 * not exist yet on purpose. Demanding those compile would demand the code the
 * spec exists to argue for, which inverts what a spec is.
 *
 * The cost is real and belongs here rather than in a comment nobody reads: a
 * spec's fence can name a type that was renamed under it and nothing will say so.
 */
const EXAMPLES: readonly Checked[] = FENCES.filter(
  (fence) => (fence.lang === 'ts' || fence.lang === 'tsx') && fence.file.endsWith('README.md'),
).map(
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
 * The commands the documentation shows, and the commands the binary has.
 *
 * Both directions, because both failures happened. A command in the documentation
 * that the binary refuses is a reader typing something and getting `unknown
 * command`; a command the binary dispatches that nothing documents is a capability
 * nobody can find.
 */
describe('the documented command line is the real one', () => {
  const bin = readFileSync(join(ROOT, 'packages/cli/src/bin.ts'), 'utf8');
  const dispatched = [...(/const COMMANDS = \[([^\]]+)\]/.exec(bin)?.[1] ?? '').matchAll(/'([\w-]+)'/g)].map(
    (match) => match[1]!,
  );

  it('reads the binary', () => {
    expect(dispatched.length).toBeGreaterThan(0);
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
});
