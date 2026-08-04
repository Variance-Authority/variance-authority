import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONTEXT } from './doc-example-context.mjs';

/**
 * Write every README example out as a real source file.
 *
 * ADR-0014's claim is that **an example is a call site the compiler cannot see**,
 * so it is the only call site an API rename does not reach. The fix for that is
 * to make the compiler see it — not to rebuild a compiler somewhere else.
 *
 * This used to be a test. It read the fences, synthesized a prelude, built an
 * in-memory `CompilerHost` with `fileExists`/`readFile`/`getSourceFile`
 * overridden, ran `ts.createProgram` over virtual paths, and mapped diagnostics
 * back to markdown line numbers — around 280 lines of compiler driving inside a
 * file whose other rules are `existsSync` and a regex. It also meant the test
 * suite depended on the TypeScript compiler API, which is why the repository was
 * still carrying TypeScript 5 after moving to 7.
 *
 * The examples are now files in a workspace, and `tsc --build` compiles them the
 * way it compiles everything else. There is no second compiler, no virtual
 * filesystem, and no diagnostic remapping: an error names the generated file, and
 * the generated file names the README line it came from on line one.
 *
 * Regenerated on every build rather than committed, so it cannot go stale.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'docs-examples/src');

/**
 * A fence in a spec or an ADR is a *proposal* — it describes code the document
 * exists to argue for, so demanding it compile would invert what a spec is.
 * Those are checked by a much weaker rule elsewhere. Only READMEs land here.
 */
const PROPOSAL_DIRS = ['docs/specs/', 'docs/context/adr/'];

function fences(file) {
  const text = readFileSync(join(ROOT, file), 'utf8');
  const found = [];

  for (const match of text.matchAll(/^```([\w-]*)\n([\s\S]*?)^```/gm)) {
    const lang = match[1] ?? '';
    if (lang !== 'ts' && lang !== 'tsx') continue;
    found.push({
      file,
      line: text.slice(0, match.index).split('\n').length,
      lang,
      code: match[2] ?? '',
    });
  }
  return found;
}

/**
 * Names the fence declares for itself, which the prelude must not declare again.
 *
 * Textual rather than parsed, and that is a deliberate downgrade. The failure
 * mode of getting this wrong is a duplicate-identifier error naming the exact
 * line — loud, immediate, and fixable in one edit. Carrying a parser to make it
 * precise costs more than the mistake does.
 */
function declares(code, name) {
  const word = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(
    [
      // `const name`, `function name`, `type name`.
      `\\b(?:const|let|var|function|class|interface|type|enum)\\s+${word}\\b`,
      // `const { name } = ...`. Anchored to the opening brace and the `=`,
      // because an unanchored gap swallows anything on the line: `for (const
      // subject of subjects)` reads as a declaration of `subjects`, the prelude
      // drops it, and the example fails to compile for the opposite reason.
      `\\b(?:const|let|var)\\s+[{[][^=;\\n]*\\b${word}\\b[^=;\\n]*[}\\]]\\s*=`,
      `\\bimport\\s[^;]*\\b${word}\\b[^;]*from`,
    ].join('|'),
  ).test(code);
}

function preludeFor(code) {
  return Object.entries(CONTEXT)
    .filter(([key]) => {
      const [scope, name] = key.includes('#') ? key.split('#') : [null, key];
      if (scope !== null) return false;
      return new RegExp(`\\b${name}\\b`).test(code) && !declares(code, name);
    })
    .map(([key, type]) => `declare const ${key}: ${type};`);
}

/** Per-file overrides, for a name that means something different in one README. */
function scopedPreludeFor(file, code) {
  return Object.entries(CONTEXT)
    .filter(([key]) => key.startsWith(`${file}#`))
    .filter(([key]) => {
      const name = key.split('#').pop();
      return new RegExp(`\\b${name}\\b`).test(code) && !declares(code, name);
    })
    .map(([key, type]) => `declare const ${key.split('#').pop()}: ${type};`);
}

const markdown = execFileSync('git', ['ls-files', '*.md'], { cwd: ROOT, encoding: 'utf8' })
  .trim()
  .split('\n');

const examples = markdown
  .filter((file) => file.endsWith('README.md'))
  .filter((file) => !PROPOSAL_DIRS.some((dir) => file.startsWith(dir)))
  .flatMap(fences);

mkdirSync(OUT, { recursive: true });
for (const stale of readdirSync(OUT)) rmSync(join(OUT, stale));

for (const example of examples) {
  const scoped = scopedPreludeFor(example.file, example.code);
  const shadowed = new Set(scoped.map((line) => line.split(/\s+/)[2].replace(':', '')));
  const prelude = preludeFor(example.code).filter(
    (line) => !shadowed.has(line.split(/\s+/)[2].replace(':', '')),
  );

  const name = `${example.file.replace(/[/.]/g, '_')}__${example.line}.${example.lang}`;
  writeFileSync(
    join(OUT, name),
    `// Generated from ${example.file}:${example.line} by tools/doc-examples.mjs.\n` +
      `// Edit the README, not this file. Regenerated on every build.\n` +
      [...scoped, ...prelude].join('\n') +
      `\n${example.code}`,
  );
}

if (examples.length === 0) {
  // A generator that silently produces nothing turns the whole gate into a
  // no-op, and the build would still be green.
  console.error('tools/doc-examples.mjs found no README examples; refusing to write an empty gate');
  process.exit(1);
}

console.log(`doc-examples: wrote ${examples.length} example(s) to docs-examples/src`);
