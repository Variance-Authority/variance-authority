/**
 * Which language a file is read as, and what that choice governs.
 *
 * Every language answers the same two questions in its own syntax — *what does
 * this file ask for* and *what does it publish* — and a specifier is a string in
 * all of them. So a language is not a second `sense`: it is a reader that fills
 * [`Read`](./read.ts) and a resolution algorithm that turns the specifiers in it
 * into paths in this tree ([ADR-0066](../../../docs/context/adr/0066-a-language-is-a-reader-not-a-sense.md)).
 * Nothing above [`record.ts`](./record.ts) learns a new type, and the graph the
 * fold walks holds one kind of node whatever produced it.
 *
 * This module is the low half of that: the extension tables, and the name a file
 * is read under. The reader is chosen in [`record.ts`](./record.ts) and the
 * resolution algorithm in [`resolve.ts`](./resolve.ts), each beside the thing it
 * dispatches, because neither can be named here without this file importing the
 * whole package.
 *
 * ## The id is not the extension
 *
 * `.ts`, `.jsx` and `.cts` are one language; `.scss` and `.less` are another.
 * What the id names is the pair of algorithms, and files sharing a pair share an
 * id however differently they are written. It is also what a resolution answer
 * is keyed by, because the same specifier written in two languages is two
 * different questions: `./colors` from a stylesheet may find `_colors.scss` and
 * from a module must not.
 *
 * ## A language nothing can read
 *
 * `languageOf` returning nothing is the answer for a file this build has no
 * reader for, and it is not the same as a file with no edges. The distinction is
 * kept because the alternative is the failure this package exists to refuse: a
 * repository whose Python nobody read must not be indistinguishable from a
 * repository with no Python in it.
 */

import { MODULE_EXTENSIONS } from './read.js';
import { STYLE_EXTENSIONS } from './style.js';

/**
 * The languages this build can read.
 *
 * `module` is JavaScript and TypeScript in every dialect, read by `oxc` — which
 * stays, on measurement, rather than being folded into the general path
 * ([ADR-0066](../../../docs/context/adr/0066-a-language-is-a-reader-not-a-sense.md)).
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
 * Only `module`. The component index reads JSX and the conventions around it
 * ([`core/attribute`](../../core/src/attribute)), and a Python class is not a
 * component in any sense that index means.
 */
export function indexesComponents(id: LanguageId): boolean {
  return id === 'module';
}

/**
 * Whether this language's edges are file-grain or coarser than that.
 *
 * Every language here but Swift names a file, however indirectly: a Python
 * import names a module that is a file, a Rust `use` names a path through one,
 * a JVM import names a class that is one. Swift names a **module**, which is a
 * whole target, and nothing in the language goes below it
 * ([`swift.ts`](./swift.ts)). So a Swift file's edges reach every file in the
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
