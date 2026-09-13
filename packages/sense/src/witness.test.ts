import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { aliasesIn, directoriesOf, movedDirectories, witnessesOf } from './witness.js';

/**
 * A witness is a claim about what *cannot* change an answer.
 *
 * Everything here is that claim from one side or the other: too few witnesses is
 * a stale record handed to a caller, too many is the whole-repository toll this
 * exists to remove. So the tests that matter are the ones naming a directory
 * that must be watched even though nothing resolved through it, and the ones
 * naming a directory that must not be watched even though it is nearby.
 */

const NO_DIRECTORIES = new Map();

describe('the directories a record depends on', () => {
  it('watches where a relative request looked, and where an index would be', () => {
    const directories = directoriesOf(['src/panel/button/index.ts']);

    // `./button` from `src/panel` is answered by a file in `src/panel` named
    // `button.*`, or by an index inside `src/panel/button`. Both have to move a
    // witness, because either one appearing changes the answer.
    expect(witnessesOf({
      file: 'src/panel/Panel.tsx',
      requests: ['./button'],
      edges: [],
      directories,
      aliases: undefined,
    })).toEqual(['src/panel', 'src/panel/button']);
  });

  it('watches a request that resolved to nothing at all', () => {
    // The whole point of deriving witnesses lexically. Nothing answered
    // `./later`, so there is no edge to read a directory off, and it is exactly
    // this request that will start resolving when somebody adds the file.
    expect(witnessesOf({
      file: 'src/Button.tsx',
      requests: ['./later.js'],
      edges: [],
      directories: NO_DIRECTORIES,
      aliases: undefined,
    })).toEqual(['src']);
  });

  it('watches where the answer actually landed', () => {
    // A `package.json` `main` sends `./pkg` to a file no lexical reading of the
    // specifier predicts. The directory holding the answer is a witness so that
    // a sibling appearing there is still seen.
    expect(witnessesOf({
      file: 'index.ts',
      requests: ['./pkg'],
      edges: ['vendor/pkg/dist/main.js'],
      directories: NO_DIRECTORIES,
      aliases: undefined,
    })).toEqual(['', 'vendor/pkg/dist']);
  });

  it('ignores a request that names nothing a tree can hold', () => {
    expect(witnessesOf({
      file: 'src/app.ts',
      requests: ['node:fs', 'data:text/javascript,0', '', '   '],
      edges: [],
      directories: NO_DIRECTORIES,
      aliases: undefined,
    })).toEqual([]);
  });

  it('drops a request that climbs out of the repository', () => {
    expect(witnessesOf({
      file: 'src/app.ts',
      requests: ['../../../elsewhere/thing.js'],
      edges: [],
      directories: NO_DIRECTORIES,
      aliases: undefined,
    })).toEqual([]);
  });

  it('leaves a bare request unwatched when nothing bounds it', () => {
    // `react` is answered from `node_modules`, which the tree does not hold, so
    // no tracked path can change it and no directory needs watching for it.
    expect(witnessesOf({
      file: 'src/app.ts',
      requests: ['react', 'react-dom/client'],
      edges: [],
      directories: NO_DIRECTORIES,
      aliases: undefined,
    })).toEqual([]);
  });

  it('watches where a configured alias sends a bare request', async () => {
    const root = await fixture({
      'tsconfig.json': '{ "compilerOptions": { "paths": { "@app/*": ["src/*"] } } }',
    });
    const aliases = await aliasesIn(root, ['tsconfig.json']);

    expect(witnessesOf({
      file: 'docs/page.tsx',
      requests: ['@app/button'],
      edges: [],
      directories: directoriesOf(['src/button/index.ts']),
      aliases,
    })).toEqual(['src', 'src/button']);
  });
});

describe('naming a directory by what it holds', () => {
  it('names every directory on the way down, root included', () => {
    const directories = directoriesOf(['package.json', 'src/panel/Panel.tsx']);

    expect([...directories.keys()].sort()).toEqual(['', 'src', 'src/panel']);
  });

  it('moves only the directory a path appeared in', () => {
    const before = directoriesOf(['src/a.ts', 'docs/b.md']);
    const after = directoriesOf(['src/a.ts', 'src/c.ts', 'docs/b.md']);

    // The property the whole change exists for: one file added, one directory
    // moved, and every record that never named `src` keeps its edges.
    expect([...movedDirectories(before, after)]).toEqual(['src']);
  });

  it('moves the parent as well when a directory itself appears', () => {
    const before = directoriesOf(['src/a.ts']);
    const after = directoriesOf(['src/a.ts', 'src/panel/b.ts']);

    expect([...movedDirectories(before, after)].sort()).toEqual(['src', 'src/panel']);
  });

  it('moves a directory that went away', () => {
    const before = directoriesOf(['src/panel/b.ts', 'src/a.ts']);
    const after = directoriesOf(['src/a.ts']);

    expect([...movedDirectories(before, after)].sort()).toEqual(['src', 'src/panel']);
  });

  it('holds still when a file is edited, because it names no contents', () => {
    expect([...movedDirectories(
      directoriesOf(['src/a.ts', 'src/b.ts']),
      directoriesOf(['src/b.ts', 'src/a.ts']),
    )]).toEqual([]);
  });
});

describe('where a configuration says a bare request can land', () => {
  it('reads a substitution through a wildcard', async () => {
    const root = await fixture({
      'tsconfig.json': '{ "compilerOptions": { "paths": { "@app/*": ["src/*", "vendor/*"] } } }',
    });
    const aliases = await aliasesIn(root, ['tsconfig.json']);

    expect(aliases?.candidatesFor('@app/button')).toEqual(['src/button', 'vendor/button']);
    expect(aliases?.candidatesFor('other/button')).toEqual([]);
  });

  it('reads an exact pattern, and a `baseUrl` that makes every request relative', async () => {
    const root = await fixture({
      'tsconfig.json':
        '{ "compilerOptions": { "baseUrl": "./src", "paths": { "shim": ["compat/shim.ts"] } } }',
    });
    const aliases = await aliasesIn(root, ['tsconfig.json']);

    expect(aliases?.candidatesFor('shim')).toEqual(['src/shim', 'src/compat/shim.ts']);
  });

  it('reads the comments and trailing commas a `tsconfig` is allowed to carry', async () => {
    const root = await fixture({
      'tsconfig.json': `{
        // a line comment, and a "quoted /* decoy */" that is not one
        /* a block comment */
        "compilerOptions": { "paths": { "@app/*": ["src/*"], }, },
      }`,
    });

    expect((await aliasesIn(root, ['tsconfig.json']))?.candidatesFor('@app/x')).toEqual(['src/x']);
  });

  it('folds a relative `extends` chain, nearest file winning', async () => {
    const root = await fixture({
      'tsconfig.base.json': '{ "compilerOptions": { "paths": { "@base/*": ["base/*"] } } }',
      'app/tsconfig.json':
        '{ "extends": "../tsconfig.base.json", "compilerOptions": { "paths": { "@app/*": ["src/*"] } } }',
    });
    const aliases = await aliasesIn(root, ['tsconfig.base.json', 'app/tsconfig.json']);

    // `paths` are resolved against the file that declared them, so the base's
    // pattern is still the base's, and the app's overrides rather than merges.
    expect(aliases?.candidatesFor('@base/x')).toEqual(['base/x']);
    expect(aliases?.candidatesFor('@app/x')).toEqual(['app/src/x']);
  });

  it('places a `paths` it inherited at the file that wrote it', async () => {
    const root = await fixture({
      'tsconfig.json': '{ "compilerOptions": { "paths": { "@mui/*": ["./packages/mui/src/*"] } } }',
      'packages/lab/tsconfig.json': '{ "extends": "../../tsconfig.json" }',
    });
    const aliases = await aliasesIn(root, ['tsconfig.json', 'packages/lab/tsconfig.json']);

    // A package config that extends the root and overrides nothing declares the
    // root's answer. Re-basing it at the package would name
    // `packages/lab/packages/mui/src`, a directory no repository has, and every
    // record whose specifier matched would carry a witness for it.
    expect(aliases?.candidatesFor('@mui/Button')).toEqual(['packages/mui/src/Button']);
  });

  it('gives up on a configuration it cannot read', async () => {
    const root = await fixture({ 'tsconfig.json': '{ this is not JSON' });

    // Not a bound it can weaken — a bound it does not have. The caller turns
    // this into the whole path set rather than into an empty answer.
    expect(await aliasesIn(root, ['tsconfig.json'])).toBeUndefined();
  });

  it('gives up on an `extends` that names a package', async () => {
    const root = await fixture({
      'tsconfig.json': '{ "extends": "@tsconfig/node20/tsconfig.json" }',
    });

    // The file lives in `node_modules`, which the tree does not hold, so what it
    // declares cannot be read and must not be guessed at.
    expect(await aliasesIn(root, ['tsconfig.json'])).toBeUndefined();
  });

  it('gives up on a configuration that is not there', async () => {
    expect(await aliasesIn(await fixture({}), ['tsconfig.json'])).toBeUndefined();
  });

  it('answers nothing, rather than giving up, for a tree that configures nothing', async () => {
    const aliases = await aliasesIn(await fixture({}), ['package.json', 'src/app.ts']);

    expect(aliases?.candidatesFor('react')).toEqual([]);
  });
});

const made: string[] = [];

afterAll(async () => {
  for (const dir of made) await rm(dir, { recursive: true, force: true });
});

async function fixture(files: Readonly<Record<string, string>>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'variance-witness-'));
  made.push(root);
  for (const [path, contents] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), contents, 'utf8');
  }

  return root;
}
