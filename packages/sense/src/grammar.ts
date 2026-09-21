/**
 * The tree-sitter grammars a build has, and what it answers without one.
 *
 * `oxc` reads JavaScript and TypeScript and is not replaced here
 * ([ADR-0066](../../../docs/context/adr/0066-a-language-is-a-reader-not-a-sense.md)
 * measures why). Every other language is read through a tree-sitter grammar, and
 * a grammar is a separate npm package carrying a WebAssembly build of one
 * parser. They are optional dependencies, so a checkout can be missing any of
 * them — and what that must produce is the whole reason this module is a seam
 * rather than a bare import.
 *
 * ## A grammar that is not there
 *
 * An absent grammar makes a language *unreadable*, not *edgeless*. Every file in
 * it is recorded with `unknown` set, which widens the runs that touch it and
 * says why in words a person can act on. The alternative — no grammar, no
 * requests, no complaint — is a repository whose Python nobody parsed reporting
 * the same shape as a repository with no Python in it, and a selector built on
 * that ships a green run over a surface nobody looked at.
 *
 * This is the same rule [ADR-0065](../../../docs/context/adr/0065-source-scanning-is-one-native-side.md)
 * states for the native scanner, arrived at from the other side. There the rule
 * is that a missing binary may not change an answer; here a missing grammar
 * changes the answer to *I do not know*, which is the one change that is honest.
 *
 * ## Why loading is a separate step
 *
 * `web-tree-sitter` initialises its WebAssembly runtime asynchronously and
 * parses synchronously afterwards. The readers are synchronous — they are called
 * from inside a parse cache keyed on a digest — so the loading happens once,
 * before a scan begins, and `parserFor` is a lookup from then on. A caller that
 * never loads gets nothing back and the file is recorded as unreadable, which is
 * the same answer as a missing grammar and correct for the same reason.
 */

import { createRequire } from 'node:module';
import type { LanguageId } from './language.js';

/**
 * What a grammar is loaded from, best source first.
 *
 * Each entry is an npm package and the file inside it, and the list is tried in
 * order. The upstream grammar package is always first — it is the one the
 * language's own maintainers version — and `tree-sitter-wasms` is the fallback
 * because two of these grammars ship no WebAssembly build at all: `tree-sitter-swift`
 * and `tree-sitter-kotlin` publish the C parser and expect a compiler, and an
 * aggregator that has already run one is the only prebuilt source there is.
 *
 * So Swift and Kotlin have one candidate and the rest have two, which is not an
 * asymmetry worth designing away: the list is what makes the difference
 * invisible to everything downstream.
 */
const GRAMMARS: Partial<Record<LanguageId, readonly string[]>> = {
  python: ['tree-sitter-python/tree-sitter-python.wasm', 'tree-sitter-wasms/out/tree-sitter-python.wasm'],
  rust: ['tree-sitter-rust/tree-sitter-rust.wasm', 'tree-sitter-wasms/out/tree-sitter-rust.wasm'],
  java: ['tree-sitter-java/tree-sitter-java.wasm', 'tree-sitter-wasms/out/tree-sitter-java.wasm'],
  kotlin: ['tree-sitter-wasms/out/tree-sitter-kotlin.wasm'],
  swift: ['tree-sitter-wasms/out/tree-sitter-swift.wasm'],
};

/**
 * A parser, narrowed to what a reader uses.
 *
 * Declared here rather than imported so that this package's types do not depend
 * on an optional dependency being installed: a checkout without the grammars
 * still type-checks, which is the same claim the runtime makes.
 */
export interface GrammarNode {
  readonly type: string;
  readonly text: string;
  readonly startPosition: { readonly row: number; readonly column: number };
  readonly namedChildren: readonly GrammarNode[];
  readonly hasError: boolean;
  readonly isMissing: boolean;
  childForFieldName(name: string): GrammarNode | null;
  childrenForFieldName(name: string): readonly GrammarNode[];
  equals(other: GrammarNode): boolean;
}

export interface GrammarParser {
  parse(source: string): { readonly rootNode: GrammarNode } | null;
}

const loaded = new Map<LanguageId, GrammarParser>();
const refused = new Map<LanguageId, string>();

/**
 * Load every grammar this build has, once.
 *
 * Returns the languages that could not be loaded, so a caller that wants to say
 * so in a report has it without asking each language in turn. Called again it
 * loads nothing: a grammar is a few hundred kilobytes of WebAssembly and a scan
 * is the only thing that needs one.
 */
export async function loadGrammars(): Promise<ReadonlyMap<LanguageId, string>> {
  const require = createRequire(import.meta.url);
  let runtime: typeof import('web-tree-sitter') | undefined;

  for (const [id, entries] of Object.entries(GRAMMARS) as [LanguageId, readonly string[]][]) {
    if (loaded.has(id) || refused.has(id)) continue;

    let last = `no candidate for ${id}`;
    for (const entry of entries) {
      try {
        runtime ??= await import('web-tree-sitter');
        await runtime.Parser.init();
        const language = await runtime.Language.load(require.resolve(entry));
        const parser = new runtime.Parser();
        parser.setLanguage(language);
        loaded.set(id, parser as unknown as GrammarParser);
        break;
      } catch (error) {
        // The first line only. A module-resolution failure carries the whole
        // require stack, and this string goes into a record that is read in a
        // terminal beside three hundred others.
        last = firstLine(error instanceof Error ? error.message : String(error));
      }
    }
    if (!loaded.has(id)) refused.set(id, last);
  }

  return refused;
}

function firstLine(message: string): string {
  const cut = message.indexOf('\n');
  return cut === -1 ? message : message.slice(0, cut);
}

/** The parser for a language, or nothing when this build has no grammar for it. */
export function parserFor(id: LanguageId): GrammarParser | undefined {
  return loaded.get(id);
}

/**
 * Why a file in this language could not be read, for the record's `unknown`.
 *
 * Names the package to install, because the person reading a widened run is the
 * person who can end it, and "no grammar" without the name of one is a dead end.
 */
export function missingGrammar(file: string, id: LanguageId): string {
  const entries = GRAMMARS[id];
  const reason = refused.get(id);
  const install = entries === undefined || entries.length === 0
    ? `no grammar is registered for ${id}`
    : `install \`${entries.map((entry) => entry.slice(0, entry.indexOf('/'))).join('` or `')}\``;

  return `${file} is ${id}, which this build has no reader for — ${install}. ` +
    `What it imports is unknown${reason === undefined ? '' : ` (${reason})`}.`;
}
