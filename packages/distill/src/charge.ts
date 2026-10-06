// compass: variance-authority/runtime/attention
import {
  innermostAt,
  type ExecutionIndex,
  type FileReferences,
  type TestCoverage,
} from '@variance-authority/sense/test-selection';
import { posix } from 'node:path';
import type { ImportReach } from './own.js';

/**
 * Where a used file references an import no case of the test file ran, read
 * against the regions the record keeps for the file.
 *
 * `never`: it references none of the import's names. `effect`: it imports the
 * module with no binding, `import './x'`, so loading it is the point. `load`: a
 * reference runs when the file loads, the first one named, or sits in a function
 * that ran while it loaded. `handed`: it re-exports a name
 * from the import, so the use is its importers'. `ran`: a case of the test
 * file ran a function that references it, so the import was needed and nothing
 * called into it. `functions`: it is referenced only in functions no case of
 * the test file ran; each names its region, its first line and how many test
 * files called it, `ran` how many ran any of them, `loading` how many load the
 * file. `unmeasured`: a reference sits on a line, `line`, no region the record
 * keeps holds, or the file has a `require` or `import()` no name traces and no
 * reference.
 *
 * Precedence, with references: `load`, `handed`, `ran`, `unmeasured`,
 * `functions`. Without: `handed`, `effect`, `unmeasured`, `never`. A crossing
 * made while the module loaded is not a call, as the file reading counts entry.
 */
export type ImportCharge =
  | { readonly kind: 'never' }
  | { readonly kind: 'effect' }
  | { readonly kind: 'load'; readonly line: number; readonly name: string }
  | { readonly kind: 'handed' }
  | { readonly kind: 'ran'; readonly functions: readonly { readonly name: string; readonly line: number }[] }
  | {
    readonly kind: 'functions';
    readonly functions: readonly { readonly name: string; readonly line: number; readonly ran: number }[];
    readonly ran: number;
    readonly loading: number;
  }
  | { readonly kind: 'unmeasured'; readonly line?: number };

/** What an import is charged from. */
export interface ChargeInput {
  /** Where a file references what it imports. */
  readonly references: (file: string) => FileReferences | undefined;
  readonly coverage: TestCoverage;
  readonly execution: ExecutionIndex;
  /** The test file's cases, by their place in the case index. */
  readonly mine: ReadonlySet<number>;
}

type Block = ExecutionIndex['modules'][number]['blocks'][number];

/**
 * The charge of each import `importer` → `imported`, read once per import
 * however many modules it owns. Nothing when the importer's text was not
 * read, or the import does not land on `imported` by any specifier the
 * reader resolved.
 */
export function chargesOf(input: ChargeInput): (importer: string, imported: string) => ImportCharge | undefined {
  const executed = new Map(input.execution.modules.map((module) => [module.file, module.blocks]));
  const loaders = new Map(input.coverage.modules.map((module) => [
    module.file,
    module.blocks.find((block) => block.kind === 'module')?.loadedBy ?? [],
  ]));
  const read = new Map<string, FileReferences | undefined>();
  const charged = new Map<string, ImportCharge | undefined>();
  const called = (block: Block) => block.crossings.filter((crossing) => crossing.loaded !== true);
  const testFiles = (block: Block): ReadonlySet<string> =>
    new Set(called(block).map(({ test }) => input.execution.tests[test]!.file));

  const referencesOf = (file: string) => {
    if (!read.has(file)) read.set(file, input.references(file));
    return read.get(file);
  };

  const charge = (importer: string, imported: string): ImportCharge | undefined => {
    const found = referencesOf(importer);
    if (found === undefined) return undefined;
    const references = found.references.filter(({ file }) => file === imported);
    if (references.length === 0) {
      if (found.passed.includes(imported)) return { kind: 'handed' };
      if (found.effects.includes(imported)) return { kind: 'effect' };
      if (found.untraced) return { kind: 'unmeasured' };
      return found.imported.includes(imported) ? { kind: 'never' } : undefined;
    }
    const load = references.find((reference) => reference.load);

    const blocks = executed.get(importer) ?? [];
    const regions = new Map<Block, (typeof references)[number]>();
    let unmeasured: number | undefined;
    for (const reference of references) {
      const at = innermostAt(blocks, reference.line).filter((block) => block.kind !== 'module');
      if (at.length === 0) unmeasured ??= reference.line;
      for (const block of at) if (!regions.has(block)) regions.set(block, reference);
    }
    const named = (block: Block) => ({ name: block.name || block.path, line: block.startLine });
    const mine = (crossing: Block['crossings'][number]) => input.mine.has(crossing.test);
    const ran = [...regions.keys()].filter((block) => called(block).some(mine));
    if (load !== undefined) return { kind: 'load', line: load.line, name: load.name };
    const atLoad = [...regions].find(([block]) => block.crossings.some((crossing) => crossing.loaded === true && mine(crossing)));
    if (atLoad !== undefined) return { kind: 'load', line: atLoad[1].line, name: atLoad[1].name };
    if (found.passed.includes(imported)) return { kind: 'handed' };
    if (ran.length > 0) return { kind: 'ran', functions: ran.map(named) };
    if (unmeasured !== undefined) return { kind: 'unmeasured', line: unmeasured };
    const union = new Set<string>();
    const functions = [...regions.keys()].map((block) => {
      const files = testFiles(block);
      for (const file of files) union.add(file);
      return { ...named(block), ran: files.size };
    });
    return { kind: 'functions', functions, ran: union.size, loading: new Set(loaders.get(importer) ?? []).size };
  };

  return (importer, imported) => {
    const key = `${importer}\0${imported}`;
    if (!charged.has(key)) charged.set(key, charge(importer, imported));
    return charged.get(key);
  };
}

/**
 * One line that says what the test file `file` can do about an import, by its
 * reach. A mock is proposed with a factory: an automock requires the module to
 * read its shape, which is the load it is there to stop. The factory stands a
 * function in for every value `exports` names, since the mock replaces the
 * module for every file the test loads; a function can be called, constructed,
 * extended and read. One is proposed only where the importer reads none of
 * the import, or reads it only in functions no case of the test file ran: a
 * stand-in read at load is used at load or kept for a case, and one a case
 * runs, or the importer hands on, changes what the case does. None is proposed
 * where what the module exports is not known. Absent when nothing is.
 */
export function reachLine(
  file: string,
  { importer, imported, reach, charge, exports }: {
    importer: string;
    imported: string;
    reach: ImportReach;
    charge?: ImportCharge;
    exports?: readonly string[];
  },
): string | undefined {
  switch (reach) {
    case 'test':
      // Deleting is the fix only when the file reads nothing it imports; otherwise the line under it says where it does.
      return `error: ${file} imports ${imported}, and none of its cases enters what that loads` +
        (charge?.kind === 'never' ? ': delete the import.' : '.');
    case 'subject': {
      if (exports === undefined) return undefined;
      if (charge?.kind !== 'never' && charge?.kind !== 'functions') return undefined;
      const specifier = posix.relative(posix.dirname(file), imported).replace(/\.[cm]?[jt]sx?$/, '');
      return `Or mock it in this file, so ${importer} does not load it: ` +
        `jest.mock('${specifier.startsWith('.') ? specifier : `./${specifier}`}', () => (${factoryOf(exports)}));`;
    }
    case 'beyond':
      return `warning: this file does not import ${importer}; mocking ${imported} here would tie it to code it does not know: ` +
        `fix it in ${importer}.`;
  }
}

/** The object a mock's factory returns: a function for each value the module exports, `default` as an ES module's. */
function factoryOf(exports: readonly string[]): string {
  const names = exports.map((name) => `${/^[A-Za-z_$][\w$]*$/.test(name) ? name : JSON.stringify(name)}: jest.fn()`);
  return `{ ${exports.includes('default') ? '__esModule: true, ' : ''}${names.join(', ')} }`;
}

/** One line that says where the importer references the import, and what to change. */
export function chargeLine(importer: string, imported: string, charge: ImportCharge): string {
  const at = (functions: readonly { readonly name: string; readonly line: number }[]) =>
    functions.map(({ name, line }) => `${name} (line ${line})`).join(', ');
  switch (charge.kind) {
    case 'never':
      return `${importer} reads nothing it imports from ${imported}: delete the import, unless loading ${imported} is the point.`;
    case 'effect':
      return `${importer} imports ${imported} only to load it: ` +
        "if this file's cases need nothing it sets up, import it where that is needed.";
    case 'load':
      return `${importer} reads ${charge.name} from ${imported} at line ${charge.line} when it loads: ` +
        'move that reference into the function that needs it.';
    case 'handed':
      return `${importer} re-exports what it imports from ${imported}, so its importers use it: ` +
        `import past ${importer} where they do.`;
    case 'ran':
      return `A case ran ${at(charge.functions)}, which ${charge.functions.length === 1 ? 'reads' : 'read'} ${imported} ` +
        'and calls nothing in it: make that reference lazy.';
    case 'functions':
      return `${importer} reads ${imported} only in ${at(charge.functions)}, which no case of this file ran; ` +
        `${charge.ran} of ${charge.loading} test file(s) that load ${importer} run one: ` +
        `move them out of ${importer}, or import ${imported} lazily inside them.`;
    case 'unmeasured':
      return charge.line === undefined
        ? `${importer} has a \`require\` or \`import()\` no name traces, so where it reads ${imported} is unmeasured.`
        : `${importer} reads ${imported} at line ${charge.line}, where the record keeps no region: unmeasured.`;
  }
}
