import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { variancePrecondition } from '@variance-authority/sense/precondition';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findEntry, publishLine, readLine, type ShareEntry } from '@variance-authority/core/share';
import { createGitLineCell, gitDescends, headerEnv } from './share-git.js';

const MAIN = { kind: 'mainline', name: 'release/2.0' } as const;
const REF = 'refs/variance/mainline/release/2.0';
const IMAGE = 'e'.repeat(64);
const ascii = (text: string): Uint8Array => Uint8Array.from(text, (char) => char.charCodeAt(0));
const entry = (name: string, commit: string, text: string, images?: string[]): ShareEntry => ({
  name,
  commit,
  bytes: ascii(text),
  ...(images !== undefined ? { images } : {}),
});
const descends = async (): Promise<boolean> => false;

/**
 * Against a real bare repository over `file://`, which speaks the same
 * protocol a hosted remote does, filters and leases included.
 */
describe('createGitLineCell', () => {
  beforeEach(() => variancePrecondition({ remote: 'accepts' }));
  let home = '';
  let url = '';
  let remote = '';
  const git = (dir: string, ...args: string[]): string =>
    execFileSync('git', ['--git-dir', dir, ...args], { encoding: 'utf8', env: { ...process.env, GIT_NO_LAZY_FETCH: '1' } });

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'va-git-line-'));
    remote = join(home, 'remote.git');
    execFileSync('git', ['init', '--bare', '-q', remote]);
    git(remote, 'config', 'uploadpack.allowFilter', 'true');
    git(remote, 'config', 'uploadpack.allowAnySHA1InWant', 'true');
    url = `file://${remote}`;
  });

  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  const cellAt = (name: string) => createGitLineCell({ url, gitDir: join(home, name) });

  it('holds a line as one commit, and reads it from another cache', async () => {
    const image = async (): Promise<Uint8Array> => ascii('png');
    await publishLine(cellAt('a'), MAIN, [entry('report-v1', 'aaaa', 'one', [IMAGE])], { descends, image });
    await publishLine(cellAt('a'), MAIN, [entry('report-v1', 'bbbb', 'two', [IMAGE])], { descends, image });
    expect(git(remote, 'rev-list', '--count', REF).trim()).toBe('1');

    const read = await readLine(cellAt('b'), MAIN);
    if ('kind' in read) throw new Error(read.kind);
    const found = findEntry(read.manifest, 'report-v1');
    if ('kind' in found) throw new Error(found.kind);
    expect(found.commit).toBe('bbbb');
    expect(await read.entry(found)).toEqual(ascii('two'));
    expect(await read.image(IMAGE)).toEqual(ascii('png'));
  });

  it('publishes over a held image without reading it, and drops what nothing names', async () => {
    const image = async (): Promise<Uint8Array> => ascii('png');
    await publishLine(cellAt('a'), MAIN, [entry('report-v1', 'aaaa', 'one', [IMAGE])], { descends, image });
    await publishLine(cellAt('fresh'), MAIN, [entry('suite-v1/web', 'aaaa', 'web')], { descends, image });
    const blob = git(remote, 'rev-parse', `${REF}:images/${IMAGE}`).trim();
    expect(() => git(join(home, 'fresh'), 'cat-file', '-e', blob)).toThrow();

    await publishLine(cellAt('fresh'), MAIN, [entry('report-v1', 'bbbb', 'two')], { descends, image });
    expect(git(remote, 'ls-tree', '-r', '--name-only', REF).split('\n').filter((path) => path.startsWith('images/'))).toEqual([]);
  });

  it('re-reads and keeps both entries when another cache wrote first', async () => {
    const image = async (): Promise<Uint8Array> => ascii('png');
    const slow = cellAt('slow');
    await publishLine(slow, MAIN, [entry('suite-v1/web', 'aaaa', 'web')], { descends, image });
    const racing = {
      ...slow,
      async store(...args: Parameters<typeof slow.store>) {
        racing.store = slow.store;
        await publishLine(cellAt('fast'), MAIN, [entry('suite-v1/app', 'aaaa', 'app')], { descends, image });
        return slow.store(...args);
      },
    };
    const result = await publishLine(racing, MAIN, [entry('report-v1', 'aaaa', 'r')], { descends, image });
    expect(result).toMatchObject({ written: ['report-v1'], attempts: 2 });
    const read = await readLine(cellAt('reader'), MAIN);
    if ('kind' in read) throw new Error(read.kind);
    expect(read.manifest.entries.map((held) => held.name)).toEqual(['report-v1', 'suite-v1/app', 'suite-v1/web']);
  });

  // The lease above is checked against what the remote advertised. A remote
  // that moves while the pack uploads — a hosted remote, while another run's
  // publish lands — refuses at its own ref update instead, `[remote rejected]`.
  it('re-reads and keeps both entries when another cache wrote while the push was in flight', async () => {
    const image = async (): Promise<Uint8Array> => ascii('png');
    await publishLine(cellAt('slow'), MAIN, [entry('suite-v1/web', 'aaaa', 'web')], { descends, image });
    const before = git(remote, 'rev-parse', REF).trim();
    await publishLine(cellAt('fast'), MAIN, [entry('suite-v1/app', 'aaaa', 'app')], { descends, image });
    const landed = git(remote, 'rev-parse', REF).trim();
    git(remote, 'update-ref', REF, before);
    const hook = join(remote, 'hooks', 'pre-receive');
    await writeFile(
      hook,
      [
        '#!/bin/sh',
        'unset GIT_QUARANTINE_PATH GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES',
        `git update-ref ${REF} ${landed}`,
        'rm -f "$0"',
        '',
      ].join('\n'),
      { mode: 0o755 },
    );

    const result = await publishLine(cellAt('slow'), MAIN, [entry('report-v1', 'aaaa', 'r')], { descends, image });
    expect(result).toMatchObject({ written: ['report-v1'], attempts: 2 });
    const read = await readLine(cellAt('reader'), MAIN);
    if ('kind' in read) throw new Error(read.kind);
    expect(read.manifest.entries.map((held) => held.name)).toEqual(['report-v1', 'suite-v1/app', 'suite-v1/web']);
  });

  it('reports a push the remote refuses while the line stands where it was read', async () => {
    variancePrecondition({ remote: 'refuses' });
    const image = async (): Promise<Uint8Array> => ascii('png');
    await publishLine(cellAt('a'), MAIN, [entry('suite-v1/web', 'aaaa', 'web')], { descends, image });
    const before = git(remote, 'rev-parse', REF).trim();
    await writeFile(join(remote, 'hooks', 'pre-receive'), '#!/bin/sh\necho "declined by policy" >&2\nexit 1\n', { mode: 0o755 });

    const result = await publishLine(cellAt('a'), MAIN, [entry('report-v1', 'aaaa', 'r')], { descends, image });
    expect(result).toMatchObject({ kind: 'unreachable', detail: expect.stringMatching(/pre-receive hook declined.*declined by policy/) });
    expect(git(remote, 'rev-parse', REF).trim()).toBe(before);
  });

  it('reports the refused push when the remote cannot say where the line is after it', async () => {
    variancePrecondition({ remote: 'refuses' });
    const image = async (): Promise<Uint8Array> => ascii('png');
    await publishLine(cellAt('a'), MAIN, [entry('suite-v1/web', 'aaaa', 'web')], { descends, image });
    const gone = join(home, 'gone.git');
    await writeFile(
      join(remote, 'hooks', 'pre-receive'),
      `#!/bin/sh\necho "declined by policy" >&2\nmv "${remote}" "${gone}"\nexit 1\n`,
      { mode: 0o755 },
    );

    const result = await publishLine(cellAt('a'), MAIN, [entry('report-v1', 'aaaa', 'r')], { descends, image });
    expect(result).toMatchObject({ kind: 'unreachable', detail: expect.stringMatching(/pre-receive hook declined.*declined by policy/) });
  });

  it('tells nothing published from a remote that cannot be reached', async () => {
    variancePrecondition({ remote: 'unreachable' });
    expect(await readLine(cellAt('a'), MAIN)).toEqual({ kind: 'absent' });
    const gone = createGitLineCell({ url: `file://${join(home, 'nowhere.git')}`, gitDir: join(home, 'c') });
    expect(await readLine(gone, MAIN)).toMatchObject({ kind: 'unreachable' });
  });

  it('answers descent from the branch history alone, and says when it cannot', async () => {
    const commit = (tree: string, ...parents: string[]): string =>
      execFileSync('git', ['--git-dir', remote, 'commit-tree', tree, ...parents.flatMap((one) => ['-p', one]), '-m', 'c'], {
        encoding: 'utf8',
        env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' },
      }).trim();
    const tree = execFileSync('git', ['--git-dir', remote, 'mktree'], { input: '', encoding: 'utf8' }).trim();
    const first = commit(tree);
    const second = commit(tree, first);
    git(remote, 'update-ref', 'refs/heads/main', second);

    const descent = gitDescends({ url, gitDir: join(home, 'a') }, 'main');
    expect(await descent(second, first)).toBe(true);
    expect(await descent(first, second)).toBe(false);
    expect(await descent(first, first)).toBe(false);
    expect(await descent('f'.repeat(40), first)).toBeUndefined();
    expect(await gitDescends({ url, gitDir: join(home, 'b') }, 'gone')(second, first)).toBeUndefined();
  });
});

describe('headerEnv', () => {
  const URL = 'https://github.com/Variance-Authority/variance-authority';
  const HEADER = 'AUTHORIZATION: basic dG9rZW4=';
  const given = (key: string, value = HEADER): NodeJS.ProcessEnv => ({
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: key,
    GIT_CONFIG_VALUE_0: value,
  });
  const added = { GIT_CONFIG_COUNT: '2', GIT_CONFIG_KEY_1: 'http.extraheader', GIT_CONFIG_VALUE_1: HEADER };

  it('does not give git a header the environment already gives it for the share URL', () => {
    expect(headerEnv(HEADER, URL, given('http.https://github.com/.extraheader'))).toEqual({});
    expect(headerEnv(HEADER, URL, given('http.extraHeader'))).toEqual({});
    expect(headerEnv(HEADER, URL, {})).toEqual({
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'http.extraheader',
      GIT_CONFIG_VALUE_0: HEADER,
    });
  });

  it('gives it when the same value sits under another URL or another key', () => {
    expect(headerEnv(HEADER, URL, given('http.https://other.example/.extraheader'))).toEqual(added);
    expect(headerEnv(HEADER, URL, given('http.https://github.com/Variance.extraheader'))).toEqual(added);
    expect(headerEnv(HEADER, URL, given('core.sshCommand'))).toEqual(added);
    expect(headerEnv(HEADER, URL, given('http.https://github.com/.extraheader', 'AUTHORIZATION: basic b3RoZXI='))).toEqual(added);
  });
});
