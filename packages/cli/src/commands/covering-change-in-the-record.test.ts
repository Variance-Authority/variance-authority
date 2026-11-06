import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFlags } from '../args.js';
import { parseCoveringArgs } from '../covering-args.js';
import { flagsFor, synopsisFor } from '../usage.js';
import { formatCovering, type Covering } from './covering.js';
import { changeSince, listedChange } from './covering-since.js';
import { coveringAnswer } from './covering-suites.js';
import { BEFORE, cloneOf, DISCOUNTS, git, published, recordIn } from './mainline-fixture.js';
import { suiteBase } from './suite-base.js';

// `ci-info` decides CI once, when it loads, so the module is cut: these questions are asked outside CI.
vi.mock('ci-info', () => ({ isCI: false }));
// Cut because a commit git cannot read fails the diff from it first, so this answer reaches the read only from here.
const commit = vi.hoisted(() => ({ unread: undefined as string | undefined }));
vi.mock('@variance-authority/sense', async (importOriginal) => {
  const original = await importOriginal<typeof import('@variance-authority/sense')>();
  const cut = <Ask extends (...args: never[]) => unknown>(ask: Ask) => (...args: Parameters<Ask>) =>
    commit.unread === undefined ? ask(...args) : { unread: commit.unread };
  return { ...original, existedAt: cut(original.existedAt), existingAt: cut(original.existingAt) };
});

/**
 * The change `--since` names is the merge base's diff to the tree, and the
 * record only says how to read it. So what the record already holds stays in the
 * change, and a path is the file: one the record's commit did not hold is not
 * held, whatever the mainline renamed it from, and the answer says so.
 */

let home: string;
const cwd = process.cwd();

beforeEach(async () => {
  home = await realpath(await mkdtemp(join(tmpdir(), 'variance-covering-change-')));
});

afterEach(async () => {
  commit.unread = undefined;
  process.chdir(cwd);
  vi.unstubAllEnvs();
  await rm(home, { recursive: true, force: true });
});

const asCi = () => vi.stubEnv('VARIANCE_AUTHORITY_CACHE', join(home, 'ci-cache'));
const asClone = () => vi.stubEnv('VARIANCE_AUTHORITY_CACHE', join(home, 'clone-cache'));
const parse = (argv: readonly string[]) => parseCoveringArgs(readFlags(argv, 'covering', flagsFor('covering'), synopsisFor('covering')));
const asked = (argv: readonly string[]) => coveringAnswer(parse(argv)) as Promise<Covering>;
const since = ['--since', 'origin/main', '--suite', 'unit'];
const EDITED = 'export function applyDiscount(price: number): number {\n  return price * 0.8;\n}\n';

/** A clone of a mainline that published nothing, ready to commit. */
async function aClone() {
  asCi();
  const ci = await published(home, { publish: false });
  const clone = await cloneOf(home, ci.origin);
  await git(clone, 'config', 'user.email', 'fixture@example.test');
  await git(clone, 'config', 'user.name', 'Fixture');
  asClone();
  process.chdir(clone);
  return { ...ci, clone };
}

const namesOf = (answer: Covering) => answer.changed?.flatMap((change) => change.regions.flatMap((region) => region.tests.map((test) => test.id)));

describe('a change the record already holds', () => {
  it('reads the change in the checkout `--root` names, from any directory', async () => {
    const { clone } = await aClone();
    await writeFile(join(clone, 'src/total.ts'), EDITED);
    await git(clone, 'commit', '--quiet', '-am', 'the change');
    await recordIn(clone, await git(clone, 'rev-parse', 'HEAD'), ['test/total.test.ts'], [DISCOUNTS]);
    process.chdir(home);

    const answer = await asked([...since, '--root', clone]);

    expect(namesOf(answer)).toContain(DISCOUNTS.id);
  });

  it('names a file from a `--root` below the repository top, at the merge base and at the record', async () => {
    const dir = join(home, 'repository');
    const nested = join(dir, 'packages/app');
    await mkdir(join(nested, 'src'), { recursive: true });
    await writeFile(join(nested, 'src/a.ts'), 'one\n');
    await git(dir, 'init', '--quiet', '--initial-branch=main');
    await git(dir, 'config', 'user.email', 'a@example.com');
    await git(dir, 'config', 'user.name', 'a');
    await git(dir, 'add', '-A');
    await git(dir, 'commit', '--quiet', '-m', 'the mainline');
    await git(dir, 'branch', 'mainline');
    await writeFile(join(nested, 'src/a.ts'), 'two\n');
    await git(dir, 'commit', '--quiet', '-am', 'the change');
    const at = await git(dir, 'rev-parse', 'HEAD');
    await writeFile(join(nested, 'src/a.ts'), 'three\n');

    const listed = await listedChange('mainline', nested);

    expect([...(await changeSince(listed, 'mainline', nested, undefined)).keys()]).toEqual(['src/a.ts']);
    expect([...(await changeSince(listed, 'mainline', nested, at)).keys()]).toEqual(['src/a.ts']);
  });

  it('answers for a committed change the record ran, the tree clean', async () => {
    const { clone } = await aClone();
    await writeFile(join(clone, 'src/total.ts'), EDITED);
    await git(clone, 'commit', '--quiet', '-am', 'the change');
    const head = await git(clone, 'rev-parse', 'HEAD');
    await recordIn(clone, head, ['test/total.test.ts'], [DISCOUNTS]);

    const answer = await asked(since);

    expect(answer.at).toBe(head);
    expect(answer.changed?.map((change) => change.file)).toEqual(['src/total.ts']);
    expect(namesOf(answer)).toContain(DISCOUNTS.id);
  });

  describe('read in the numbers of the commit it ran at', () => {
    const FILE = 'src/long.ts';
    const held = Array.from({ length: 20 }, (_, at) => `line ${String(at + 1)}`);
    const written = (dir: string, lines: readonly string[]) => writeFile(join(dir, FILE), `${lines.join('\n')}\n`);

    /** A mainline holding `held`, and a record of the branch commit past it that holds `branch`. */
    async function recordOfTheBranch(branch: readonly string[]) {
      const dir = join(home, 'held');
      await mkdir(join(dir, 'src'), { recursive: true });
      await git(dir, 'init', '--quiet', '--initial-branch=main');
      await git(dir, 'config', 'user.email', 'a@example.com');
      await git(dir, 'config', 'user.name', 'a');
      await written(dir, held);
      await git(dir, 'add', '-A');
      await git(dir, 'commit', '--quiet', '-m', 'the mainline');
      await git(dir, 'branch', 'mainline');
      await written(dir, branch);
      await git(dir, 'commit', '--quiet', '-am', 'the record');
      process.chdir(dir);
      return { dir, at: await git(dir, 'rev-parse', 'HEAD') };
    }
    const answered = async (dir: string, at: string) => changeSince(await listedChange('mainline', dir), 'mainline', dir, at);

    it('names a line the change wrote where the record holds it, past lines the tree put above it', async () => {
      const branch = held.map((line, at) => (at === 4 ? 'the change' : line));
      const { dir, at } = await recordOfTheBranch(branch);
      await written(dir, ['new one', 'new two', ...branch]);

      expect(await answered(dir, at)).toEqual(new Map([[FILE, [{ start: 1, end: 1, added: 'new one\nnew two' }, { start: 5, end: 5 }]]]));
    });

    it('charges the lines either side of what the change removed, which the record no longer holds', async () => {
      const { dir, at } = await recordOfTheBranch([...held.slice(0, 4), ...held.slice(5)]);

      expect(await answered(dir, at)).toEqual(new Map([[FILE, [{ start: 4, end: 5 }]]]));
    });

    it('charges the first line when the change removed the one above it', async () => {
      const { dir, at } = await recordOfTheBranch(held.slice(1));

      expect(await answered(dir, at)).toEqual(new Map([[FILE, [{ start: 1, end: 1 }]]]));
    });

    it('reads a hunk the tree wrote over the change whole, in the record it stands in', async () => {
      const branch = held.map((line, at) => (at === 4 ? 'the change' : line));
      const { dir, at } = await recordOfTheBranch(branch);
      await written(dir, branch.map((line, index) => (index === 4 ? 'the change again' : line)));

      expect(await answered(dir, at)).toEqual(new Map([[FILE, [{ start: 5, end: 5 }]]]));
    });
  });

  it('lists a file the change added and the record holds', async () => {
    const { clone } = await aClone();
    await writeFile(join(clone, 'src/added.ts'), 'export const added = 1;\n');
    await git(clone, 'add', '-A');
    await git(clone, 'commit', '--quiet', '-m', 'the change');
    const head = await git(clone, 'rev-parse', 'HEAD');
    await recordIn(clone, head, ['test/total.test.ts'], [DISCOUNTS]);

    const answer = await asked(since);

    expect(answer.changed?.map((change) => change.file)).toEqual(['src/added.ts']);
  });

  it('lists a file the change deleted, which the record no longer holds, as read by no row', async () => {
    const { clone } = await aClone();
    await git(clone, 'rm', '--quiet', 'test/other.test.ts');
    await git(clone, 'commit', '--quiet', '-m', 'the change');
    await recordIn(clone, await git(clone, 'rev-parse', 'HEAD'), ['test/total.test.ts'], [DISCOUNTS]);

    const answer = await asked(since);

    expect(answer.changed?.map((change) => [change.file, change.recorded])).toEqual([['test/other.test.ts', false]]);
  });
});

describe('a file the mainline renamed since the record', () => {
  /** A clone that holds the record of the mainline's first commit, with `move` then landed on the mainline. */
  async function renamedOnTheMainline(move: (dir: string) => Promise<void>) {
    const { clone, dir, first } = await aClone();
    await recordIn(clone, first, ['test/total.test.ts'], [DISCOUNTS]);
    await move(dir);
    await git(dir, 'add', '-A');
    await git(dir, 'commit', '--quiet', '-m', 'main moves the file');
    await git(dir, 'push', '--quiet', 'origin', 'main');
    await git(clone, 'pull', '--quiet', 'origin', 'main');
    return { clone, first };
  }
  const renames = (dir: string) => git(dir, 'mv', 'src/total.ts', 'src/sum.ts');

  it('says the commit the record was made at held no file by the name, in every format, and lends it no case of the old one', async () => {
    const { clone, first } = await renamedOnTheMainline(renames);
    await writeFile(join(clone, 'src/sum.ts'), EDITED);

    const answer = await asked(since);
    const said = `${first.slice(0, 12)}, the commit the record was made at, held no file by this name`;

    expect(answer.at).toBe(first);
    expect(answer.changed).toMatchObject([{ file: 'src/sum.ts', recorded: false, regions: [], absentAt: first }]);
    expect(formatCovering(answer, 'text', Date.now())).toContain(said);
    expect(formatCovering(answer, 'text', Date.now())).toContain('`variance covering --file`');
    expect(formatCovering(answer, 'refs', Date.now())).toContain(said);
    expect(JSON.parse(formatCovering(answer, 'json', Date.now()))).toMatchObject({ changed: [{ file: 'src/sum.ts', absentAt: first }] });
  });

  it('reads the path alone, whatever the mainline wrote into the file as it renamed it', async () => {
    const { clone } = await renamedOnTheMainline(async (dir) => {
      await renames(dir);
      await writeFile(join(dir, 'src/sum.ts'), `// the mainline's line\n${BEFORE}`);
    });
    await writeFile(join(clone, 'src/sum.ts'), `// the mainline's line\n${EDITED}`);

    const lines = await changeSince(await listedChange('origin/main', clone), 'origin/main', clone, (await asked(since)).at);

    expect([...lines.keys()]).toEqual(['src/sum.ts']);
  });

  it('reads the change from one record commit once, however many suites stand on it', async () => {
    const { clone } = await renamedOnTheMainline(renames);
    await writeFile(join(clone, 'src/sum.ts'), EDITED);
    const { at } = await asked(since);
    const trace = join(home, 'git-trace');
    const listed = await listedChange('origin/main', clone);
    vi.stubEnv('GIT_TRACE', trace);

    const [one, other] = [await changeSince(listed, 'origin/main', clone, at), await changeSince(listed, 'origin/main', clone, at)];

    expect(other).toEqual(one);
    expect((await readFile(trace, 'utf8')).match(/built-in: git diff .*--no-renames/gu)).toHaveLength(1);
  });

  it('says so of a renamed file the change deleted', async () => {
    const { clone, first } = await renamedOnTheMainline(renames);
    await git(clone, 'rm', '--quiet', 'src/sum.ts');

    const answer = await asked(since);

    expect(answer.changed).toMatchObject([{ file: 'src/sum.ts', recorded: false, regions: [], absentAt: first }]);
  });

  it('keeps the old name in the answer, with the cases that ran it, when the change wrote there too', async () => {
    const { clone, first } = await renamedOnTheMainline(renames);
    await writeFile(join(clone, 'src/sum.ts'), EDITED);
    await writeFile(join(clone, 'src/total.ts'), EDITED);

    const answer = await asked(since);

    expect(answer.changed).toMatchObject([
      { file: 'src/sum.ts', recorded: false, absentAt: first },
      { file: 'src/total.ts', recorded: true },
    ]);
    expect(answer.changed?.[1]).not.toHaveProperty('absentAt');
    expect(namesOf(answer)).toContain(DISCOUNTS.id);
  });
});

describe('a question that does not fetch, once the mainline selected is another', () => {
  const text = async () => {
    const held = join(home, 'held.ts');
    await writeFile(held, BEFORE);
    return held;
  };
  const question = async () => ['--file', 'src/total.ts', '--suite', 'unit', '--text', await text()];

  /** A clone of two mainlines that fetched `main`'s record, `release` not yet selected. */
  async function fetchedForMain() {
    asCi();
    const ci = await published(home);
    await git(ci.dir, 'push', '--quiet', 'origin', 'main:release');
    const clone = await cloneOf(home, ci.origin);
    const config = join(clone, 'variance.config.json');
    await writeFile(config, (await readFile(config, 'utf8')).replace('"mainlines":["main"]', '"mainlines":["main","release"]'));
    asClone();
    process.chdir(clone);
    await suiteBase(clone, { env: {} });
    return { ...ci, clone };
  }
  const RELEASE = { GITHUB_BASE_REF: 'release' };

  it('reuses what was fetched for the mainline selected', async () => {
    const { clone, first } = await fetchedForMain();

    const answer = await asked(await question());

    expect(answer.at).toBe(first);
    expect(answer.source).toMatchObject({ from: 'mainline', mainline: 'main' });
    expect(await suiteBase(clone, { env: {}, fetch: 'never' })).toMatchObject({ from: 'mainline', mainline: { earlier: { reused: 'nearest' } } });
  });

  it('holds nothing to read from a record of the mainline selected before', async () => {
    const { clone } = await fetchedForMain();
    await asked(await question());
    vi.stubEnv('GITHUB_BASE_REF', 'release');

    expect(await suiteBase(clone, { env: RELEASE, fetch: 'never' })).toMatchObject({
      from: 'none',
      missed: { mainline: 'release', miss: { kind: 'unfetched' }, shareAsked: false },
    });
    await expect(asked(await question())).rejects.toThrow('record of "unit": the share was not asked; this read does not fetch.');
  });

  it("falls to the primary checkout's record, and says so", async () => {
    const { clone, first } = await fetchedForMain();
    await git(clone, 'config', 'user.email', 'fixture@example.test');
    await git(clone, 'config', 'user.name', 'Fixture');
    await writeFile(join(clone, 'src/moved.ts'), 'export const moved = 1;\n');
    await git(clone, 'add', '-A');
    await git(clone, 'commit', '--quiet', '-m', 'the primary checkout moves');
    const primary = await git(clone, 'rev-parse', 'HEAD');
    await recordIn(clone, primary, ['test/total.test.ts'], [DISCOUNTS]);
    const worktree = join(home, 'feature');
    await git(clone, 'worktree', 'add', '--quiet', '--detach', worktree, 'HEAD');
    vi.stubEnv('GITHUB_BASE_REF', 'release');
    process.chdir(worktree);

    const answer = await asked(await question());

    expect(answer.at).not.toBe(first);
    expect(answer.at).toBe(primary);
    expect(answer.source?.says).toContain('primary checkout');
  });
});

describe('a change of files the record\'s commit did not hold', () => {
  /** A recorded clone with `count` new files staged in it. */
  async function addedSinceTheRecord(count: number) {
    const { clone, first } = await aClone();
    await recordIn(clone, first, ['test/total.test.ts'], [DISCOUNTS]);
    for (let at = 0; at < count; at++) await writeFile(join(clone, `src/added-${at}.ts`), `export const added = ${at};\n`);
    await git(clone, 'add', '-A');
    return { first };
  }

  it('asks git once for all of them, not once a file', async () => {
    const { first } = await addedSinceTheRecord(12);
    const trace = join(home, 'git-trace');
    vi.stubEnv('GIT_TRACE', trace);

    const answer = await asked(since);

    expect(answer.changed).toHaveLength(12);
    expect(answer.changed?.every((file) => file.absentAt === first)).toBe(true);
    expect((await readFile(trace, 'utf8')).match(/built-in: git ls-tree .*src\/added-/gu)).toHaveLength(1);
  });

  it('refuses in git\'s words when git cannot read the commit, as the question of one file does', async () => {
    await addedSinceTheRecord(1);
    commit.unread = 'fatal: not a tree object';

    await expect(asked(since)).rejects.toThrow(/git could not read \S+, the commit that record was made at/u);
  });
});
