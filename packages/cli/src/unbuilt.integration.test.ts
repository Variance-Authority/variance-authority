import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { unbuiltOf } from './unbuilt.js';

/**
 * A package whose build stopped part way: its `dist/` holds an entry that imports
 * an output the build never wrote. The error is the one Node raises loading it, so
 * the test reads the shape the program meets, not one written to match the code.
 * Node raises it in a process of its own, because an import here goes through the
 * test runner's loader, which fails differently.
 */

const made: string[] = [];
afterEach(() => {
  for (const at of made.splice(0)) rmSync(at, { recursive: true, force: true });
});

function loadFailure(files: Record<string, string>, entry: string): unknown {
  const at = realpathSync(mkdtempSync(join(tmpdir(), 'va-unbuilt-')));
  made.push(at);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(at, path, '..'), { recursive: true });
    writeFileSync(join(at, path), text);
  }
  const load =
    `import(${JSON.stringify(pathToFileURL(join(at, entry)).href)}).then(` +
    `() => process.exit(1), (e) => process.stdout.write(JSON.stringify({ message: e.message, code: e.code, url: e.url })));`;
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', load], { encoding: 'utf8' });
  if (run.status !== 0) throw new Error(`${entry} loaded: ${run.stderr}`);
  const { message, ...fields } = JSON.parse(run.stdout) as { message: string; code?: string; url?: string };
  return Object.assign(new Error(message), fields);
}

describe('a module the build never wrote', () => {
  it('names the package and the missing output, and asks for that package to be rebuilt', () => {
    const error = loadFailure(
      {
        'png/package.json': JSON.stringify({ name: '@example/png', type: 'module' }),
        'png/dist/index.js': "export { mask } from './mask.js';\n",
      },
      'png/dist/index.js',
    );
    expect(unbuiltOf(error)).toBe(
      'variance could not load: `@example/png` is only partly built, and its `dist/mask.js` does not exist. ' +
        'Rebuild `@example/png`, then run the command again.',
    );
  });

  it('says to reinstall a package installed under node_modules', () => {
    const error = loadFailure(
      {
        'app/node_modules/@example/png/package.json': JSON.stringify({ name: '@example/png', type: 'module' }),
        'app/node_modules/@example/png/dist/index.js': "export { mask } from './mask.js';\n",
      },
      'app/node_modules/@example/png/dist/index.js',
    );
    expect(unbuiltOf(error)).toBe(
      'variance could not load: `@example/png` is only partly built, and its `dist/mask.js` does not exist. ' +
        'Reinstall `@example/png`, then run the command again.',
    );
  });

  it('is not said of an error that is not a missing module', () => {
    expect(unbuiltOf(new Error('boom'))).toBeUndefined();
  });

  it('is not said of a package that is not installed at all', () => {
    const error = loadFailure({ 'loose/entry.mjs': "import 'va-no-such-package';\n" }, 'loose/entry.mjs');
    expect(unbuiltOf(error)).toBeUndefined();
  });

  it('is not said when no package holds the missing file', () => {
    const error = loadFailure({ 'loose/entry.mjs': "import './gone.mjs';\n" }, 'loose/entry.mjs');
    expect(unbuiltOf(error)).toBeUndefined();
  });

  it.todo('names the package and the file when an output was left empty or cut short — needs the file a `SyntaxError` was raised in, which Node carries only in its stack text');
});
