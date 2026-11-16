/** Source-language names, extension tables, and traversal capabilities. */

import { MODULE_EXTENSIONS } from './read.js';
/** Extensions the stylesheet reader claims. */
export const STYLE_EXTENSIONS = ['.css', '.scss', '.sass', '.less'];

/**
 * The languages this build can read.
 *
 * `module` is JavaScript and TypeScript in every dialect, read by `oxc` — which
 * stays, on measurement, rather than being folded into the general path
 * ([ADR-0066](https://github.com/Variance-Authority/variance-authority/blob/main/docs/context/adr/0066-a-language-is-a-reader-not-a-sense.md)).
 * `style` is the stylesheet reader. Everything after them is read through
 * tree-sitter, and is added here only once its reader and its resolution
 * algorithm both exist: an extension in this table is a promise that a file
 * carrying it will be opened and answered, and a language listed before it can
 * be read would make every file of it silently edgeless.
 */
export type LanguageId = 'module' | 'style' | 'python' | 'rust' | 'java' | 'kotlin' | 'swift';

/** Extensions the Python reader claims. A stub is read exactly like a module. */
export const PYTHON_EXTENSIONS = ['.py', '.pyi'];

/** Extensions the Rust reader claims. */
export const RUST_EXTENSIONS = ['.rs'];

/** Extensions the Java reader claims. */
export const JAVA_EXTENSIONS = ['.java'];

/**
 * Extensions the Kotlin reader claims.
 *
 * `.kts` is a Kotlin script — a Gradle build file is the common one — and it is
 * read by the same reader because it is the same language. What it *resolves* to
 * is usually nothing, since a build script imports plugins rather than files,
 * and nothing is the right answer for it.
 */
export const KOTLIN_EXTENSIONS = ['.kt', '.kts'];

/** Extensions the Swift reader claims. */
export const SWIFT_EXTENSIONS = ['.swift'];

const EXTENSIONS: Readonly<Record<LanguageId, readonly string[]>> = {
  module: MODULE_EXTENSIONS,
  style: STYLE_EXTENSIONS,
  python: PYTHON_EXTENSIONS,
  rust: RUST_EXTENSIONS,
  java: JAVA_EXTENSIONS,
  kotlin: KOTLIN_EXTENSIONS,
  swift: SWIFT_EXTENSIONS,
};

/** Every language, in the order a reader is looked for. */
export const LANGUAGES = Object.keys(EXTENSIONS) as readonly LanguageId[];

const BY_EXTENSION = new Map<string, LanguageId>(
  LANGUAGES.flatMap((id) => EXTENSIONS[id].map((extension) => [extension, id] as const)),
);

/** Every extension some reader claims. What a scan will open, and nothing else. */
export const READABLE: ReadonlySet<string> = new Set(BY_EXTENSION.keys());

/**
 * Which language a name is read as, or nothing when no reader claims it.
 *
 * Takes the whole suffix [`parseWay`](./files.ts) computed rather than the path,
 * because the suffix is what the parse cache is keyed on and a second walk from
 * the path is the shape that lets the key and the reader disagree silently.
 */
export function languageOf(suffix: string): LanguageId | undefined {
  return BY_EXTENSION.get(suffix.slice(suffix.lastIndexOf('.')));
}

/**
 * Whether declarations in this language are indexed as component declarations.
 *
 * Only `module`. The component index keeps the names a React component is
 * written under — a capitalised function, class or binding of the module's own
 * statements ([`declarations.rs`](../native/src/declarations.rs)) — and a Python
 * class is not a component in any sense that index means.
 */
export function indexesComponents(id: LanguageId): boolean {
  return id === 'module';
}

/**
 * Whether the scan records the members a file in this language declares.
 *
 * Only `module`. A member — a property, a method, a field — is read off the
 * `oxc` parse, and no tree-sitter reader records one, so a member question
 * answers for JavaScript and TypeScript and has to say so for the rest.
 */
export function readsMembers(id: LanguageId): boolean {
  return id === 'module';
}

/**
 * Whether this language's edges are file-grain or coarser than that.
 *
 * Every language here but Swift names a file, however indirectly: a Python
 * import names a module that is a file, a Rust `use` names a path through one,
 * a JVM import names a class that is one. Swift names a **module**, which is a
 * whole target, and nothing in the language goes below it
 * (`native/src/source_languages.rs`). So a Swift file's edges reach every file in the
 * target rather than the one the symbol came from, and they over-reach by
 * design — the direction selection is allowed to be wrong in.
 *
 * Asked here rather than stored on the record, because it is a fact about the
 * language and not about the file: every Swift file answers the same, and a
 * record carrying it would carry the same word three hundred times over. What
 * needs it is whatever explains a selection to a person, and that already knows
 * which language it is looking at.
 */
export function grainOf(id: LanguageId): 'file' | 'target' {
  return id === 'swift' ? 'target' : 'file';
}

/**
 * Whether a file in this language is code rather than an asset.
 *
 * What it decides is the edge kind, and through it every traversal a caller
 * bounds to running code. A stylesheet is reached *by* code and is not code; a
 * Python module is code in precisely the sense a JavaScript one is. Asked of
 * the target's language rather than the importer's, because how a file was
 * written is what it is — `import './theme.css'` from a module is an asset edge
 * and always was ([`kindFor`](./resolve.ts)).
 */
export function carriesCode(id: LanguageId): boolean {
  return id !== 'style';
}

/** Every extension `kindFor` keeps a request's kind for: the ones whose language is code. */
export const CODE_EXTENSIONS = [...READABLE].filter((suffix) => {
  const language = languageOf(suffix);
  return language !== undefined && carriesCode(language);
});
