import { spawn } from 'node:child_process';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  decodeManifest,
  linePath,
  manifestPaths,
  type Descends,
  type LineCell,
  type ShareLine,
  type ShareMiss,
} from '@variance-authority/core/share';

/** Where a git line cell's remote is, and where it keeps its own repository. */
export interface GitLineOptions {
  /** The remote's URL, as `git remote get-url` prints it. */
  readonly url: string;
  /** The bare repository this cell keeps. Created on first use. */
  readonly gitDir: string;
  /** Where the lines sit. Defaults to `refs/variance`. */
  readonly namespace?: string;
  /** How long a fetched line is reused before it is fetched again. Defaults to 0. */
  readonly reuseMs?: number;
  /** How long one git command may take. Defaults to 60 seconds. */
  readonly timeoutMs?: number;
  /**
   * The `http.extraheader` your clone sends to `url`. `actions/checkout` writes
   * its token there, in the clone's own configuration, where this repository
   * cannot see it. Given to every command through the environment, and never
   * written to disk.
   */
  readonly extraHeader?: string;
}

const REMOTE = 'share';
const EMPTY = '0'.repeat(40);

type Git = (args: readonly string[], input?: Uint8Array, env?: Record<string, string>) => Promise<Ran>;

/** Git in the cell's own repository, prepared on first use. */
function gitIn(options: GitLineOptions): Git {
  const timeout = options.timeoutMs ?? 60_000;
  const header = headerEnv(options.extraHeader);
  let ready: Promise<void> | undefined;
  return async (args, input, env = {}) => {
    ready ??= prepare(options, timeout);
    await ready;
    return runGit(['--git-dir', options.gitDir, ...args], { input, env: { ...header, ...env }, timeout });
  };
}

/** A configuration value git reads from the environment, after any the environment already names. */
function headerEnv(value: string | undefined): Record<string, string> {
  if (value === undefined) return {};
  const at = Number(process.env['GIT_CONFIG_COUNT'] ?? '0') || 0;
  return {
    GIT_CONFIG_COUNT: String(at + 1),
    [`GIT_CONFIG_KEY_${String(at)}`]: 'http.extraheader',
    [`GIT_CONFIG_VALUE_${String(at)}`]: value,
  };
}

/**
 * Whether one commit of `branch` strictly descends from another, as git answers
 * it from that branch's history on the remote.
 *
 * Fetched once, with `--filter=tree:0`, into the same repository the cell
 * keeps: commits alone, never a tree or a blob, and never into your clone. A
 * commit the fetch did not bring, or a fetch that failed, is `undefined`, which
 * `publishLine` answers by replacing.
 */
export function gitDescends(options: GitLineOptions, branch: string): Descends {
  const git = gitIn(options);
  const tracked = `refs/variance-history/${branch}`;
  let fetched: Promise<boolean> | undefined;
  return async (descendant, ancestor) => {
    if (descendant === ancestor) return false;
    fetched ??= git(['fetch', '--no-tags', '--no-write-fetch-head', '--filter=tree:0', REMOTE, `+refs/heads/${branch}:${tracked}`])
      .then((ran) => ran.code === 0);
    if (!(await fetched)) return undefined;
    const ran = await git(['merge-base', '--is-ancestor', ancestor, descendant]);
    return ran.code === 0 ? true : ran.code === 1 ? false : undefined;
  };
}

/**
 * A line as a ref: `refs/variance/mainline/main` is one commit whose tree holds
 * the manifest, the entries it names and the images they name.
 *
 * The repository that hosts the code hosts the line, so a checkout that can
 * fetch its own branch can fetch its mainline's record with the credentials it
 * already has, and nothing sits under `refs/heads/` for a clone to download.
 *
 * Everything runs in a bare repository this cell owns, under the cache, and
 * never in the user's clone. It is a partial clone of the remote: a fetch
 * brings commits and trees, and a blob comes when it is read. That is what
 * keeps a publish from downloading every image the line holds to write a tree
 * that names them, and a push from sending one the remote already has.
 */
export function createGitLineCell(options: GitLineOptions): LineCell {
  const namespace = (options.namespace ?? 'refs/variance').replace(/\/+$/, '');
  const git = gitIn(options);

  const refOf = (line: ShareLine): string | ShareMiss => {
    const ref = `${namespace}/${linePath(line)}`;
    // Git refuses these in a ref name, and the folding `linePath` does leaves them.
    if (/\.\.|\.lock(\/|$)|\/\.|@\{/.test(ref)) {
      return { kind: 'refused', detail: `${line.name}: git cannot name a ref ${ref}` };
    }
    return ref;
  };

  async function fetched(ref: string): Promise<string | ShareMiss> {
    const marker = join(options.gitDir, 'variance-fetched', ref);
    const reuse = options.reuseMs ?? 0;
    if (reuse > 0) {
      const held = await stat(marker).then((file) => Date.now() - file.mtimeMs < reuse, () => false);
      if (held) {
        const at = (await readFile(marker, 'utf8')).trim();
        return at === '' ? { kind: 'absent' } : at;
      }
    }
    const ran = await git(['fetch', '--no-tags', '--no-write-fetch-head', `--filter=blob:none`, REMOTE, `+${ref}:${ref}`]);
    let at: string | ShareMiss;
    if (ran.code === 0) {
      at = text((await git(['rev-parse', '--verify', `${ref}^{commit}`])).stdout).trim();
    } else if (/couldn't find remote ref|no such ref/i.test(ran.stderr)) {
      await git(['update-ref', '-d', ref]);
      at = { kind: 'absent' };
    } else {
      return missOf(ran);
    }
    await mkdir(dirname(marker), { recursive: true });
    await writeFile(marker, typeof at === 'string' ? at : '');
    return at;
  }

  async function blobAt(commit: string, path: string): Promise<Uint8Array | ShareMiss> {
    const ran = await git(['cat-file', 'blob', `${commit}:${path}`]);
    if (ran.code === 0) return ran.stdout;
    if (/does not exist|not a valid object name|path .* does not exist/i.test(ran.stderr)) return { kind: 'absent' };
    return missOf(ran);
  }

  return {
    async load(line) {
      const ref = refOf(line);
      if (typeof ref !== 'string') return ref;
      const at = await fetched(ref);
      if (typeof at !== 'string') return at;
      const manifest = await blobAt(at, 'manifest.json');
      return manifest instanceof Uint8Array ? { manifest, version: at } : manifest;
    },
    async blob(line, path) {
      const ref = refOf(line);
      if (typeof ref !== 'string') return ref;
      const at = await git(['rev-parse', '--verify', `${ref}^{commit}`]);
      if (at.code !== 0) return { kind: 'absent' };
      return blobAt(text(at.stdout).trim(), path);
    },
    async store(line, write) {
      const ref = refOf(line);
      if (typeof ref !== 'string') return ref;
      const manifest = decodeManifest(write.manifest);
      if ('kind' in manifest) return { kind: 'unreadable', detail: 'the manifest to write is not one' };

      const index = join(options.gitDir, `variance-index-${String(process.pid)}-${String(Date.now())}`);
      const env = { GIT_INDEX_FILE: index };
      // Built on the held tree, so every blob it already names is carried by
      // name and never read. Then pruned to what the new manifest names, so the
      // ref holds the line and not its history.
      if (write.expected !== undefined) {
        const read = await git(['read-tree', write.expected], undefined, env);
        if (read.code !== 0) return missOf(read);
      }
      const keep = new Set<string>(['manifest.json', ...manifestPaths(manifest)]);
      const listed = write.expected === undefined ? '' : text((await git(['ls-tree', '-r', '--name-only', write.expected])).stdout);
      const lines: string[] = [];
      for (const path of listed.split('\n')) {
        if (path !== '' && !keep.has(path)) lines.push(`0 ${EMPTY}\t${path}`);
      }
      for (const [path, bytes] of [...write.blobs, ['manifest.json', write.manifest] as const]) {
        const hashed = await git(['hash-object', '-w', '--stdin'], bytes);
        if (hashed.code !== 0) return missOf(hashed);
        lines.push(`100644 ${text(hashed.stdout).trim()}\t${path}`);
      }
      const updated = await git(['update-index', '--add', '--index-info'], bytes(`${lines.join('\n')}\n`), env);
      if (updated.code !== 0) return missOf(updated);
      const tree = await git(['write-tree', '--missing-ok'], undefined, env);
      await rm(index, { force: true });
      if (tree.code !== 0) return missOf(tree);
      // No parent: a line is its latest, and what it replaced is the remote's to collect.
      const commit = await git(['commit-tree', text(tree.stdout).trim(), '-m', `variance: ${line.kind} ${line.name}`], undefined, IDENTITY);
      if (commit.code !== 0) return missOf(commit);
      const sha = text(commit.stdout).trim();

      // A parentless commit leaves the held one no edge of the push, so git
      // would pack every blob the held tree names, fetching each image from the
      // remote to send it straight back. Listing the held commit as a shallow
      // boundary makes the pack treat its whole tree as already there. It has
      // no parent, so the boundary hides nothing. Removed after, so no fetch
      // sees it; a publish racing on this cache that loses it only fetches.
      const shallow = join(options.gitDir, 'shallow');
      if (write.expected !== undefined) await writeFile(shallow, `${write.expected}\n`);
      const pushed = await git([
        'push', '--no-verify', '--porcelain',
        `--force-with-lease=${ref}:${write.expected ?? ''}`,
        REMOTE, `${sha}:${ref}`,
      ]);
      await rm(shallow, { force: true });
      if (pushed.code !== 0) {
        if (/stale info|\[rejected\]|fetch first|already exists/i.test(text(pushed.stdout) + pushed.stderr)) return 'conflict';
        return missOf(pushed);
      }
      await git(['update-ref', ref, sha]);
      return 'written';
    },
  };
}

const IDENTITY = {
  GIT_AUTHOR_NAME: 'variance',
  GIT_AUTHOR_EMAIL: 'variance@localhost',
  GIT_COMMITTER_NAME: 'variance',
  GIT_COMMITTER_EMAIL: 'variance@localhost',
};

async function prepare(options: GitLineOptions, timeout: number): Promise<void> {
  const exists = await stat(join(options.gitDir, 'HEAD')).then(() => true, () => false);
  const at = ['--git-dir', options.gitDir];
  if (!exists) {
    await mkdir(options.gitDir, { recursive: true });
    await runGit(['init', '--bare', '-q', options.gitDir], { timeout });
  }
  // Every time rather than once, so a remote whose URL changed is followed.
  for (const [key, value] of [
    ['core.repositoryformatversion', '1'],
    ['extensions.partialClone', REMOTE],
    [`remote.${REMOTE}.url`, options.url],
    [`remote.${REMOTE}.promisor`, 'true'],
    [`remote.${REMOTE}.partialCloneFilter`, 'blob:none'],
  ] as const) {
    await runGit([...at, 'config', key, value], { timeout });
  }
}

interface Ran {
  readonly code: number;
  readonly stdout: Uint8Array;
  readonly stderr: string;
}

/**
 * Git with no terminal: a credential it would prompt for is a refusal, and a
 * command past its time is a store that did not answer.
 */
function runGit(
  args: readonly string[],
  options: { readonly input?: Uint8Array | undefined; readonly env?: Record<string, string>; readonly timeout: number },
): Promise<Ran> {
  return new Promise((resolve) => {
    const child = spawn('git', [...args], {
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', ...options.env },
      timeout: options.timeout,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => out.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => err.push(chunk));
    child.on('error', (error) => resolve({ code: -1, stdout: new Uint8Array(), stderr: error.message }));
    child.on('close', (code, signal) => {
      const stdout = Buffer.concat(out);
      resolve({
        code: code ?? -1,
        stdout: new Uint8Array(stdout.buffer, stdout.byteOffset, stdout.byteLength),
        stderr: signal === null ? Buffer.concat(err).toString('utf8') : `git ${args[2] ?? ''} timed out`,
      });
    });
    child.stdin.end(options.input);
  });
}

function missOf(ran: Ran): ShareMiss {
  const detail = ran.stderr.trim().split('\n').at(-1) ?? `git exited ${String(ran.code)}`;
  if (/authentication failed|permission denied|could not read username|terminal prompts disabled|403|repository not found/i.test(ran.stderr)) {
    return { kind: 'refused', detail };
  }
  return { kind: 'unreachable', detail };
}

function text(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('utf8');
}

function bytes(value: string): Uint8Array {
  return Buffer.from(value, 'utf8');
}
