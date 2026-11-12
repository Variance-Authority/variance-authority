import { execFile, execFileSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { digestString } from '../digest.js';
import { nativeAvailable } from '../native.js';
import { gitReads } from './__fixtures__/git-reads.js';
import { gitStarted } from './__fixtures__/git-started.js';
import { changedLines } from './diff-lines.js';
import { openTestCoverage } from './format-view.js';
import { encodeTestCoverage } from './format.js';
import type { TestCoverage } from './index.js';
import { blobsAt, readBlobsAt, readTextsAt, textAtRecording, textsAt } from './recorded-text.js';
import { narrowByExecutionFromView } from './select.js';

const FILES = 150;
const path = (at: number): string => `src/f${`${at}`.padStart(3, '0')}.ts`;
const body = (at: number): string => `export const at = ${at};\n${'// '.repeat(200)}\n`;

async function checkout<T>(run: (root: string, commit: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(resolve(tmpdir(), 'variance-recorded-text-'));
  try {
    await mkdir(resolve(root, 'src'));
    for (let at = 0; at < FILES; at += 1) {
      await writeFile(resolve(root, path(at)), body(at), 'utf8');
    }
    const git = async (...args: string[]): Promise<string> =>
      (await promisify(execFile)('git', args, { cwd: root })).stdout.trim();
    await git('init', '--quiet');
    await git('config', 'user.email', 'fixture@example.invalid');
    await git('config', 'user.name', 'Fixture');
    await git('add', '--all');
    await git('commit', '--quiet', '--message', 'the text the ranges were cut from');
    return await run(root, await git('rev-parse', 'HEAD'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const every = (from: number, to: number): number[] =>
  Array.from({ length: to - from }, (_, at) => from + at);

describe('the text at a recording', () => {
  it('answers every path the caller named', async () => {
    await checkout(async (root, commit) => {
      const sourceAt = textAtRecording(
        root,
        every(0, FILES).map(path),
      );

      for (const at of every(0, FILES)) {
        expect(sourceAt(path(at), commit), path(at)).toBe(body(at));
      }
    });
  });

  it('answers a path behind the one asked last', async () => {
    await checkout(async (root, commit) => {
      const sourceAt = textAtRecording(
        root,
        every(0, FILES).map(path),
      );

      // Forward to the far end, then back for twenty of them.
      expect(sourceAt(path(FILES - 1), commit)).toBe(body(FILES - 1));
      for (const at of every(0, 20).reverse()) {
        expect(sourceAt(path(at), commit), path(at)).toBe(body(at));
      }
    });
  });

  it.runIf(nativeAvailable())('asks whether the checkout is a partial clone once, however many paths are missing', async () => {
    await checkout(async (root, commit) => {
      const added = ['src/f000-added.ts', `src/f${FILES - 1}-added.ts`];
      const sourceAt = textAtRecording(root, [...every(0, FILES).map(path), ...added]);
      const trace = resolve(root, '.git', 'trace2.json');
      process.env['GIT_TRACE2_EVENT'] = trace;
      try {
        for (const at of every(0, FILES)) expect(sourceAt(path(at), commit), path(at)).toBe(body(at));
        for (const file of added) expect(sourceAt(file, commit), file).toBeUndefined();
      } finally {
        delete process.env['GIT_TRACE2_EVENT'];
      }

      const started = (await readFile(trace, 'utf8')).split('\n').filter((line) => line.includes('"event":"start"'));
      expect(started.filter((line) => line.includes('"cat-file"'))).toHaveLength(1);
      expect(started.filter((line) => line.includes('"config"'))).toHaveLength(1);
    });
  });

  it('reads paths at several commits from one process', async () => {
    await checkout(async (root, first) => {
      const git = async (...args: string[]): Promise<string> => (await promisify(execFile)('git', args, { cwd: root })).stdout.trim();
      await writeFile(resolve(root, path(0)), 'export const at = "since";\n', 'utf8');
      await git('commit', '--quiet', '--all', '--message', 'since');
      const second = await git('rev-parse', 'HEAD');
      const trace = resolve(root, '.git', 'trace2.json');
      process.env['GIT_TRACE2_EVENT'] = trace;
      let texts: ReturnType<typeof textsAt>;
      try {
        texts = textsAt(root, new Map([[first, [path(0), path(1), 'src/added-since.ts']], [second, [path(0)]]]));
      } finally {
        delete process.env['GIT_TRACE2_EVENT'];
      }

      expect(texts).toEqual(new Map([[first, new Map([[path(0), body(0)], [path(1), body(1)]])], [second, new Map([[path(0), 'export const at = "since";\n']])]]));
      const started = (await readFile(trace, 'utf8')).split('\n').filter((line) => line.includes('"event":"start"') && line.includes('"cat-file"'));
      expect(started).toHaveLength(1);
    });
  });

  it('answers a path the caller never named', async () => {
    await checkout(async (root, commit) => {
      // The list is what a partial clone fetches, not what may be asked: a
      // caller that narrowed it to the paths it holds a digest for must still
      // get an answer for anything else the selector reaches.
      const sourceAt = textAtRecording(root, [path(0)]);

      expect(sourceAt(path(100), commit)).toBe(body(100));
      expect(sourceAt(path(0), commit)).toBe(body(0));
    });
  });

  it('answers nothing for a path the commit does not hold, and keeps answering it', async () => {
    await checkout(async (root, commit) => {
      const sourceAt = textAtRecording(root, ['src/added-since.ts', path(0)]);

      expect(sourceAt('src/added-since.ts', commit)).toBeUndefined();
      expect(sourceAt('src/added-since.ts', commit)).toBeUndefined();
      expect(sourceAt(path(0), commit)).toBe(body(0));
    });
  });

  it('fails naming the commit when this clone does not hold it, rather than answering every path missing', async () => {
    await checkout(async (root) => {
      // A shallow checkout, or one fetched at depth 1, never held the recording's commit.
      const absent = 'f'.repeat(40);

      expect(() => textsAt(root, new Map([[absent, [path(0)]]]))).toThrow(/commit ffffffffffff is not in this checkout's object store/);
    });
  });

  it('fails with git\'s reason when the tree names a blob the object store lacks, rather than answering it missing', async () => {
    await checkout(async (root, commit) => {
      const blob = execFileSync('git', ['rev-parse', `${commit}:${path(1)}`], { cwd: root, encoding: 'utf8' }).trim();
      rmSync(resolve(root, '.git', 'objects', blob.slice(0, 2), blob.slice(2)));

      expect(() => textsAt(root, new Map([[commit, [path(0), path(1)]]]))).toThrow(/^git could not read the files asked about at commit [0-9a-f]{12}: .*\S/s);
    });
  });

  it("names what git could not read by file and commit, beside the texts it could, for a reader that names the gap", async () => {
    await checkout(async (root, commit) => {
      const blob = execFileSync('git', ['rev-parse', `${commit}:${path(1)}`], { cwd: root, encoding: 'utf8' }).trim();
      rmSync(resolve(root, '.git', 'objects', blob.slice(0, 2), blob.slice(2)));
      const absent = 'f'.repeat(40);

      const { texts, refused } = readTextsAt(root, new Map([[commit, [path(0), path(1), 'src/never.ts']], [absent, [path(0)]]]));

      expect(texts).toEqual(new Map([[commit, new Map([[path(0), body(0)]])], [absent, new Map()]]));
      expect(new Set(refused.keys())).toEqual(new Set([commit, absent]));
      expect([...refused.get(commit)!.keys()]).toEqual([path(1)]);
      expect(refused.get(commit)!.get(path(1))).toMatch(/^git could not read the files asked about at commit [0-9a-f]{12}: .*\S/s);
      expect(refused.get(absent)).toEqual(new Map([[path(0), expect.stringMatching(/^commit ffffffffffff is not in this checkout's object store/)]]));
    });
  });

  it('names each path\'s blob without reading it, and refuses a commit this clone does not hold rather than naming every path absent', async () => {
    await checkout(async (root, commit) => {
      const name = `git:${execFileSync('git', ['rev-parse', `${commit}:${path(0)}`], { cwd: root, encoding: 'utf8' }).trim()}`;
      const absent = 'f'.repeat(40);

      const { texts, refused } = readBlobsAt(root, new Map([[commit, [path(0), 'src/never.ts']], [absent, [path(0)]]]));

      expect(texts).toEqual(new Map([[commit, new Map([[path(0), name]])], [absent, new Map()]]));
      expect(refused).toEqual(new Map([[absent, new Map([[path(0), expect.stringMatching(/^commit ffffffffffff is not in this checkout's object store/)]])]]));
      expect(() => blobsAt(root, new Map([[absent, [path(0)]]]))).toThrow(/commit ffffffffffff is not in this checkout's object store/);
    });
  });

  it('answers nothing at all without a position to read from', async () => {
    await checkout(async (root) => {
      const sourceAt = textAtRecording(root, [path(0)]);

      expect(sourceAt(path(0), undefined)).toBeUndefined();
    });
  });
});

describe('the text at a recording of a path the caller never named', () => {
  it('is read for a hundred paths from one process', async () => {
    await checkout(async (root, commit) => {
      const sourceAt = textAtRecording(root, [path(FILES - 1)]);
      const started = gitStarted(root, () => {
        for (const at of every(0, 100)) expect(sourceAt(path(at), commit), path(at)).toBe(body(at));
      });

      expect(started.filter((argv) => argv[1] !== 'config')).toHaveLength(1);
    });
  });

  it('is the commit\'s text when the file on disk was edited, deleted or added since', async () => {
    await checkout(async (root, commit) => {
      await writeFile(resolve(root, path(10)), `${body(10)}// since\n`, 'utf8');
      await unlink(resolve(root, path(11)));
      await writeFile(resolve(root, 'src/added-since.ts'), 'export {};\n', 'utf8');
      const sourceAt = textAtRecording(root, [path(FILES - 1)]);

      expect(sourceAt(path(10), commit)).toBe(body(10));
      expect(sourceAt(path(11), commit)).toBe(body(11));
      expect(sourceAt('src/added-since.ts', commit)).toBeUndefined();
    });
  });
});

describe('the texts a selection reads', () => {
  it('are the texts of the files it frames, from one process, not the whole diff', async () => {
    await checkout(async (root, commit) => {
      // Every file changed, and a row for only the two at either end of the
      // sorted diff: the selection frames those two and nothing between them.
      const framed = [path(0), path(FILES - 1)];
      for (const at of every(0, FILES)) await writeFile(resolve(root, path(at)), body(at).replace(`= ${at};`, `= ${at + 1};`), 'utf8');
      const diff = (await promisify(execFile)('git', ['diff', '--no-renames', commit], { cwd: root })).stdout;
      const recorded: TestCoverage = {
        version: 3,
        instrumentation: 'fixture-instrumentation',
        commit,
        tests: framed.map((file) => ({ file: `test/${file}`, complete: true, preconditions: [] })),
        modules: framed.map((file, at) => ({
          file,
          sourceDigest: digestString(body(at === 0 ? 0 : FILES - 1)),
          instrumented: true,
          blocks: [{ ordinal: 0, kind: 'module', digest: `block:${file}`, name: '', path: 'module', startLine: 1, endLine: 3, source: true, testFiles: [`test/${file}`] }],
        })),
      };
      const coverage = openTestCoverage(encodeTestCoverage(recorded));

      let narrowing: ReturnType<typeof narrowByExecutionFromView> | undefined;
      let reads = (_commit: string, _file: string): number => 0;
      const started = gitStarted(root, () => {
        reads = gitReads(() => {
          narrowing = narrowByExecutionFromView(coverage, diff, { sourceAt: textAtRecording(root, changedLines(diff).keys()) });
        });
      });

      expect(narrowing?.stale).toEqual([]);
      expect(narrowing?.entered).toEqual(framed.map((file) => `test/${file}`));
      expect(started.filter((argv) => argv.includes('cat-file'))).toHaveLength(1);
      for (const file of framed) expect(reads(commit, file), file).toBe(1);
      expect(reads(commit, path(1))).toBe(0);
    });
  });
});

/**
 * A blobless clone of a source holding `every(0, 5)` at a commit and edits
 * after it, whose server writes a line to `requests` per request it answers.
 */
async function partialClone(
  run: (clone: string, commit: string, requests: () => Promise<number>, base: string) => Promise<void>,
): Promise<void> {
  const base = await mkdtemp(resolve(tmpdir(), 'variance-recorded-partial-'));
  const [source, clone, requests, serve] = ['source', 'clone', 'requests', 'serve'].map((name) => resolve(base, name));
  const git = async (at: string, ...args: string[]): Promise<string> =>
    (await promisify(execFile)('git', args, { cwd: at })).stdout.trim();
  try {
    await mkdir(resolve(source, 'src'), { recursive: true });
    for (const at of every(0, 5)) await writeFile(resolve(source, path(at)), then(at), 'utf8');
    await git(source, 'init', '--quiet');
    await git(source, 'config', 'user.email', 'fixture@example.invalid');
    await git(source, 'config', 'user.name', 'Fixture');
    await git(source, 'config', 'uploadpack.allowFilter', 'true');
    await git(source, 'config', 'uploadpack.allowAnySHA1InWant', 'true');
    await git(source, 'add', '--all');
    await git(source, 'commit', '--quiet', '--message', 'the text the ranges were cut from');
    const commit = await git(source, 'rev-parse', 'HEAD');
    for (const at of every(0, 5)) await writeFile(resolve(source, path(at)), `${then(at)}// since\n`, 'utf8');
    await writeFile(resolve(source, 'src/added-since.ts'), 'export {};\n', 'utf8');
    await git(source, 'add', '--all');
    await git(source, 'commit', '--quiet', '--message', 'since');

    await writeFile(serve, `#!/bin/sh\necho request >> '${requests}'\nexec git upload-pack "$@"\n`, { mode: 0o755 });
    await git(base, 'clone', '--quiet', '--filter=blob:none', `file://${source}`, clone);
    await git(clone, 'config', 'remote.origin.uploadpack', serve);
    await writeFile(requests, '', 'utf8');
    const answered = async (): Promise<number> => (await readFile(requests, 'utf8')).split('\n').filter(Boolean).length;
    await run(clone, commit, answered, base);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
}

const then = (at: number): string => `export const at = ${at};\n`;

describe('the text at a recording in a partial clone', () => {
  it.runIf(nativeAvailable())('is fetched for every path named in one request', async () => {
    await partialClone(async (clone, commit, requests) => {
      const sourceAt = textAtRecording(clone, [...every(0, 5).map(path), 'src/added-since.ts']);
      for (const at of every(0, 5)) expect(sourceAt(path(at), commit), path(at)).toBe(then(at));
      expect(sourceAt('src/added-since.ts', commit)).toBeUndefined();
      expect(await requests()).toBe(1);
    });
  });

  it.runIf(nativeAvailable())('is fetched again for a list the caller names later, not for the one it replaced', async () => {
    await partialClone(async (clone, commit, requests) => {
      const sourceAt = textAtRecording(clone, every(0, 5).map(path));
      const asking = [path(0), path(1)];
      expect(sourceAt(path(0), commit, asking)).toBe(then(0));
      expect(sourceAt(path(1), commit, asking)).toBe(then(1));
      expect(await requests()).toBe(1);

      const later = [path(2), path(3)];
      expect(sourceAt(path(2), commit, later)).toBe(then(2));
      expect(sourceAt(path(3), commit, later)).toBe(then(3));
      expect(await requests()).toBe(2);
    });
  });

  // Git 2.43, the one Ubuntu 24.04 ships, exits at the first object it may
  // not fetch instead of answering `missing`, as this shim does.
  it.runIf(nativeAvailable() && process.platform !== 'win32')('is fetched in one request from a git that stops at the first object it may not fetch', async () => {
    await partialClone(async (clone, commit, requests, base) => {
      const searched = process.env['PATH'] ?? '';
      const real = searched.split(delimiter).map((dir) => join(dir, 'git')).find((file) => existsSync(file))!;
      const shim = resolve(base, 'bin');
      await mkdir(shim);
      const stops = `[ -n "$GIT_NO_LAZY_FETCH" ] && [ "$1" = cat-file ] && { echo 'fatal: could not fetch' >&2; exit 128; }`;
      await writeFile(resolve(shim, 'git'), `#!/bin/sh\n${stops}\nexec '${real}' "$@"\n`, { mode: 0o755 });
      process.env['PATH'] = `${shim}${delimiter}${searched}`;
      try {
        const sourceAt = textAtRecording(clone, every(0, 5).map(path));
        for (const at of every(0, 5)) expect(sourceAt(path(at), commit), path(at)).toBe(then(at));
      } finally {
        process.env['PATH'] = searched;
      }
      expect(await requests()).toBe(1);
    });
  });

  it.runIf(process.platform !== 'win32')('fails with git\'s own reason when no remote will serve a text, rather than answering it missing', async () => {
    await partialClone(async (clone, commit) => {
      // The remote that promised the blobs is gone.
      await promisify(execFile)('git', ['config', 'remote.origin.uploadpack', '/nonexistent/upload-pack'], { cwd: clone });
      const sourceAt = textAtRecording(clone, every(0, 5).map(path));

      expect(() => sourceAt(path(0), commit)).toThrow(/^git could not read the files asked about at commit [0-9a-f]{12}: .*\S/s);
    });
  });
});

/** Whether git runs git-lfs here: a fixture that commits through LFS needs it. */
const lfsInstalled = ((): boolean => {
  try {
    execFileSync('git', ['lfs', 'version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

const POINTER =
  'version https://git-lfs.github.com/spec/v1\noid sha256:4d7a214614ab2935c943f9e0ff69d22eadbb8f32b1258daaa5e2ca24d17e2393\nsize 22\n';

type Git = (...args: string[]) => Promise<string>;

/** A checkout holding `src/small.ts` and whatever `commit` adds through LFS. */
async function lfsCheckout(commit: (root: string, git: Git) => Promise<void>, run: (root: string, commit: string) => void): Promise<void> {
  const root = await mkdtemp(resolve(tmpdir(), 'variance-recorded-lfs-'));
  try {
    await mkdir(resolve(root, 'src'));
    const git: Git = async (...args) => (await promisify(execFile)('git', args, { cwd: root })).stdout.trim();
    await git('init', '--quiet');
    await git('config', 'user.email', 'fixture@example.invalid');
    await git('config', 'user.name', 'Fixture');
    await writeFile(resolve(root, 'src/small.ts'), 'export const small = 1;\n', 'utf8');
    await commit(root, git);
    run(root, await git('rev-parse', 'HEAD'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

/** Commits `src/big.ts` as a pointer with no object behind it. */
async function pointerAlone(root: string, git: Git): Promise<void> {
  await writeFile(resolve(root, '.gitattributes'), 'src/big.ts filter=lfs diff=lfs merge=lfs -text\n', 'utf8');
  await writeFile(resolve(root, 'src/big.ts'), POINTER, 'utf8');
  await git('-c', 'filter.lfs.clean=cat', '-c', 'filter.lfs.process=', '-c', 'filter.lfs.required=false', 'add', '--all');
  await git('commit', '--quiet', '--message', 'a pointer with no object');
}

/** Commits `src/big.ts` through LFS, its object in the local store. */
async function throughLfs(root: string, git: Git): Promise<void> {
  await git('lfs', 'install', '--local');
  await git('lfs', 'track', 'src/big.ts');
  await writeFile(resolve(root, 'src/big.ts'), 'export const big = 1;\n', 'utf8');
  await git('add', '--all');
  await git('commit', '--quiet', '--message', 'through LFS');
}

/** How many of `started` asked git-lfs for a pointer's content. */
const smudges = (started: string[][]): number => started.filter((argv) => argv.slice(1, 3).join(' ') === 'lfs smudge').length;

describe('the text at a recording of a file git-lfs tracks', () => {
  it('is refused with the reason when git-lfs cannot give its content, rather than read as the source', async () => {
    // A pointer committed with no object behind it: what a clone holds where the
    // LFS objects were never pushed, or where git-lfs is not installed to fetch them.
    await lfsCheckout(pointerAlone, (root, commit) => {
      expect(() => textsAt(root, new Map([[commit, ['src/big.ts', 'src/small.ts']]]))).toThrow(
        new RegExp(`src/big\\.ts at ${commit} is a git-LFS pointer, and git-lfs could not give its content: .+Run \`git lfs install --local\`, and \`git lfs fetch origin ${commit}\``, 's'),
      );
    });
  });

  it('is refused when the checkout holds the pointer too, rather than read as the source', async () => {
    // A checkout made without git-lfs: the bytes on disk are the commit's blob,
    // and that blob is the pointer.
    await lfsCheckout(pointerAlone, (root, commit) => {
      const sourceAt = textAtRecording(root, []);
      expect(sourceAt('src/small.ts', commit)).toBe('export const small = 1;\n');

      expect(() => sourceAt('src/big.ts', commit)).toThrow(/src\/big\.ts at [0-9a-f]+ is a git-LFS pointer, and git-lfs could not give its content/);
    });
  });

  it.runIf(lfsInstalled)('is the content git-lfs keeps for it, not the pointer git holds', async () => {
    await lfsCheckout(throughLfs, (root, commit) => {
      expect(textsAt(root, new Map([[commit, ['src/big.ts', 'src/small.ts']]]))).toEqual(
        new Map([[commit, new Map([['src/big.ts', 'export const big = 1;\n'], ['src/small.ts', 'export const small = 1;\n']])]]),
      );
    });
  });

  it.runIf(lfsInstalled)('asks git-lfs once, however often it is asked, while the reader holds it', async () => {
    await lfsCheckout(throughLfs, (root, commit) => {
      const sourceAt = textAtRecording(root, []);
      const started = gitStarted(root, () => {
        for (let ask = 0; ask < 5; ask += 1) expect(sourceAt('src/big.ts', commit)).toBe('export const big = 1;\n');
      });

      expect(smudges(started)).toBe(1);
    });
  });

  it.runIf(lfsInstalled)('takes git-lfs alone: the open process already read the pointer', async () => {
    await lfsCheckout(throughLfs, (root, commit) => {
      const sourceAt = textAtRecording(root, []);
      expect(sourceAt('src/small.ts', commit)).toBe('export const small = 1;\n');
      const started = gitStarted(root, () => {
        expect(sourceAt('src/big.ts', commit)).toBe('export const big = 1;\n');
      });

      expect(started.filter((argv) => argv[1] === 'ls-tree' || argv[1] === 'cat-file')).toEqual([]);
      expect(smudges(started)).toBe(1);
    });
  });

  it.runIf(lfsInstalled)('asks git-lfs at every ask when git-lfs refuses it, since a refusal is not held', async () => {
    await lfsCheckout(pointerAlone, (root, commit) => {
      const sourceAt = textAtRecording(root, []);
      const started = gitStarted(root, () => {
        for (let ask = 0; ask < 5; ask += 1) expect(() => sourceAt('src/big.ts', commit)).toThrow(/git-lfs could not give its content/);
      });

      expect(smudges(started)).toBe(5);
    });
  });
});
