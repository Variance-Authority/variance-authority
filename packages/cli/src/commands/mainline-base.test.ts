import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { review } from './review.js';
import { formatReview } from './review-text.js';
import { selectOutput } from './select-command.js';
import {
  BEFORE,
  DISCOUNTS,
  PUSH,
  ROUNDS,
  branchPublished,
  cloneOf,
  git,
  parseReview,
  publishTo,
  published,
  ranHere,
  recordIn,
  selectedIn,
} from './mainline-fixture.js';

/**
 * A checkout with no record of its own reads the one its mainline published.
 * What each reader says when it could not is in `mainline-base-miss.test.ts`.
 */

let home: string;
const cwd = process.cwd();

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'variance-mainline-base-'));
  process.env['VARIANCE_AUTHORITY_CACHE'] = join(home, 'ci-cache');
});

afterEach(async () => {
  process.chdir(cwd);
  delete process.env['VARIANCE_AUTHORITY_CACHE'];
  await rm(home, { recursive: true, force: true });
});

describe('`variance select` in a checkout that recorded nothing', () => {
  it('selects from the record its mainline published what the run that published it selects, from a clone at another path', async () => {
    const ci = await published(home);
    const change = BEFORE.replace('0.9', '0.8');

    await writeFile(join(ci.dir, 'src/total.ts'), change);
    const there = await selectedIn(ci.dir);
    expect(there.out).toBe('test/other.test.ts\n');
    expect(there.err).toContain(
      'record of "unit": read from this checkout\'s own, which its runs landed on the base the first of them was laid on; ' +
        'it was laid before checkouts kept a ledger, so which of its tests ran here is not known',
    );

    const clone = await cloneOf(home, ci.origin);
    process.env['VARIANCE_AUTHORITY_CACHE'] = join(home, 'laptop-cache');
    await writeFile(join(clone, 'src/total.ts'), change);
    const here = await selectedIn(clone);

    expect(here.out).toBe(there.out);
    const kept = join(home, 'laptop-cache', 'share', 'read', 'unit', ci.first, 'coverage.bin');
    expect(here.err.split('\n')).toContain(
      `record of "unit": read from mainline main, published at ${ci.first}, at the merge base with this checkout; kept at ${kept}.`,
    );
    const json = JSON.parse((await selectOutput({ cwd: clone, format: 'json' })).out) as { journal: object };
    expect(json.journal).toMatchObject({ at: kept, commit: ci.first, from: 'mainline', mainline: 'main', distance: 0 });
  });

  it('selects from the mainline\'s record on a branch whose own line holds a different one, and says it read the mainline\'s', async () => {
    const ci = await published(home);
    const branch = await branchPublished(home, ci.dir);
    const clone = await cloneOf(home, ci.origin, 'feat/x');
    process.env['VARIANCE_AUTHORITY_CACHE'] = join(home, 'laptop-cache');
    await writeFile(join(clone, 'src/total.ts'), BEFORE.replace('0.9', '0.8'));

    const here = await selectedIn(clone);

    // The branch's record says `other` covers the change and `total` does not; the mainline's says the reverse.
    expect(here.out).toBe('test/other.test.ts\n');
    expect(here.err).toContain(`record of "unit": read from mainline main, published at ${ci.first}, at the merge base with this checkout;`);
    expect(here.err).not.toContain(branch);
  });
});

describe('`variance review` after runs laid over no recording', () => {
  it('starts where the mainline published its record, and compares the cases with the mainline\'s', async () => {
    const ci = await published(home);
    const clone = await cloneOf(home, ci.origin);
    process.env['VARIANCE_AUTHORITY_CACHE'] = join(home, 'laptop-cache');
    await ranHere(clone, ci.first);

    const answer = await review(parseReview(['--root', clone]));

    expect(answer).toMatchObject({ from: ci.first, base: 'mainline', mainline: { name: 'main', suite: 'unit', commit: ci.first, distance: 0 } });
    expect(answer.files.find((file) => file.file === 'test/total.test.ts')?.cases).toEqual({ added: ['rounds'], removed: [] });
    expect(formatReview(answer, 'text')).toContain(
      `Changes since ${ci.first.slice(0, 12)}, where mainline main published its record of "unit", at the merge base with this checkout. 1 run`,
    );
  });

  it('starts where the mainline published its record on a branch whose own line holds one', async () => {
    const ci = await published(home);
    const branch = await branchPublished(home, ci.dir);
    const clone = await cloneOf(home, ci.origin, 'feat/x');
    process.env['VARIANCE_AUTHORITY_CACHE'] = join(home, 'laptop-cache');
    await ranHere(clone, branch);

    const answer = await review(parseReview(['--root', clone]));

    expect(answer).toMatchObject({ from: ci.first, base: 'mainline', mainline: { name: 'main', commit: ci.first, distance: 0 } });
  });

  it('starts at the merge base, and names the record\'s commit beside it, when the mainline published past it', async () => {
    const ci = await published(home);
    const clone = await cloneOf(home, ci.origin);
    await git(ci.dir, 'commit', '--quiet', '--allow-empty', '-m', 'second');
    const second = await git(ci.dir, 'rev-parse', 'HEAD');
    await git(ci.dir, 'push', '--quiet', 'origin', 'main');
    await recordIn(ci.dir, second, ['test/total.test.ts'], [DISCOUNTS, ROUNDS]);
    await publishTo(home, ci.dir, second, PUSH, 'mainline main');
    await git(clone, 'fetch', '--quiet', 'origin');
    process.env['VARIANCE_AUTHORITY_CACHE'] = join(home, 'laptop-cache');
    await ranHere(clone, ci.first);

    const answer = await review(parseReview(['--root', clone]));

    expect(answer).toMatchObject({ from: ci.first, base: 'mainline', mainline: { commit: second, distance: -1 } });
    // The cases the mainline published at `second` already hold `rounds`; they are not this change's base.
    expect(answer.files.find((file) => file.file === 'test/total.test.ts')?.cases).toBeUndefined();
    expect(formatReview(answer, 'text')).toContain(
      `Changes since ${ci.first.slice(0, 12)}, the merge base with ${second.slice(0, 12)}, where mainline main published ` +
        'its record of "unit", 1 commit(s) past the merge base with this checkout.',
    );
  });
});
