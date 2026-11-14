import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { PassThrough } from 'node:stream';
import type { Help } from '@variance-authority/package/help';
import { encodeExecutionIndex, testCoverageFile, writeTestCoverage } from '@variance-authority/sense/test-selection';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { publishing, UNCOMPARED } from './__fixtures__/published-then-written.js';
import { caughtUp, foundNothingAnswer, foundNothingFooter, madeBefore, outlived, refusalFooter, snapshotLine } from './caught-up.js';
import { readWorkspace, readWorkspaceForAnswer } from './read.js';
import { workspaceGeneration, workspaceReadStarted } from './snapshot.js';
import { serveWorkspace, type WorkspaceOptions } from './server.js';
import { FoundNothing } from './tools/find.js';
import { search } from './tools/search.js';
import { uses } from './tools/uses.js';

/**
 * A question about a name written after the last published generation, asked
 * of this package's server. A generation is reused for an hour, so the name is
 * answered as not published, from that generation, with a date line that says
 * the checkout was not compared with it, as `variance ask` answers it.
 */

const fixture = publishing();
beforeEach(fixture.before);
afterEach(fixture.after);

const served = (root: string, justAnswer: boolean, name = 'keptOf', options: WorkspaceOptions = {}): Promise<{ text: string; isError?: boolean }> =>
  asked(root, justAnswer, 'docs_symbol', { name }, options);

async function asked(root: string, justAnswer: boolean, tool: string, args: Readonly<Record<string, unknown>>, options: WorkspaceOptions = {}): Promise<{ text: string; isError?: boolean }> {
  const input = new PassThrough();
  const output = new PassThrough();
  const stop = serveWorkspace(root, { ...options, input, output, justAnswer });
  try {
    const line = new Promise<string>((resolve) => output.once('data', (chunk: Buffer) => resolve(chunk.toString())));
    input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool, arguments: args } })}\n`);
    const result = (JSON.parse(await line) as { result: { content: { text: string }[]; isError?: boolean } }).result;
    return { text: result.content[0]!.text, ...(result.isError === undefined ? {} : { isError: result.isError }) };
  } finally {
    stop();
  }
}

/** The date line of a refusal whose checkout could not be compared with its generation, and why. */
const UNREAD = /Snapshot \d{4}-\d\d-\d\dT[\d:.]+Z, not compared with the checkout \((.+)\): run `variance index` if files changed since\./u;

/** A package whose entry publishes `deepOf`, `named` and `describedOf` only through a barrel. */
const BARRELS = {
  'packages/kit/package.json': JSON.stringify({ name: '@acme/kit', exports: './src/index.ts' }),
  'packages/kit/src/index.ts': "export * from './inner/mid.js';\n",
  'packages/kit/src/inner/mid.ts': "export * from './deep.js';\nexport { named } from './named.js';\n",
  'packages/kit/src/inner/deep.ts': '/** Halves the amount. */\nexport const describedOf = 1;\nexport const deepOf = 1;\n',
  'packages/kit/src/inner/named.ts': 'export const named = 2;\n',
};

describe('outlived', () => {
  const edit = (root: string): void => appendFileSync(join(root, 'packages/kit/src/tax.ts'), '// moved\n');
  const after = (help: Help): number => Date.parse(workspaceGeneration(help)!) + 1;

  it('says so of an answer whose declaring file changed after its generation, and of none whose file did not', async () => {
    const root = await fixture.published();
    const help = await readWorkspace(root);
    expect(await outlived('docs_symbol', help, { name: 'taxOf' }, { root }, after(help))).toBe(false);
    edit(root);
    expect(await outlived('docs_symbol', help, { name: 'taxOf' }, { root }, after(help))).toBe(true);
  });

  it('says so of an answer whose name a file passes on, when that file changed', async () => {
    const root = await fixture.published({ 'packages/kit/src/passing.ts': "export { taxOf } from './tax.js';\n" });
    const help = await readWorkspace(root);
    appendFileSync(join(root, 'packages/kit/src/passing.ts'), '// moved\n');
    expect(await outlived('docs_symbol', help, { name: 'taxOf' }, { root }, after(help))).toBe(true);
  });

  it.each([
    ['docs_symbol', 'named'],
    ['docs_uses', 'named'],
    ['docs_symbol', 'deepOf'],
    ['docs_uses', 'deepOf'],
  ])('says so of `%s` for `%s`, published through a barrel between the entry and its file, when that barrel changed', async (tool, name) => {
    const root = await fixture.published({
      'packages/kit/package.json': JSON.stringify({ name: '@acme/kit', exports: './src/index.ts' }),
      'packages/kit/src/index.ts': "export * from './inner/mid.js';\n",
      'packages/kit/src/inner/mid.ts': "export * from './deep.js';\nexport { named } from './named.js';\n",
      'packages/kit/src/inner/deep.ts': 'export const deepOf = 1;\n',
      'packages/kit/src/inner/named.ts': 'export const named = 2;\n',
    });
    const help = await readWorkspace(root);
    appendFileSync(join(root, 'packages/kit/src/inner/mid.ts'), '// moved\n');
    expect(await outlived(tool, help, { name }, { root }, after(help))).toBe(true);
  });

  it.each([
    ['deepOf', 'packages/kit/src/index.ts'],
    ['deepOf', 'packages/kit/src/inner/mid.ts'],
    ['named', 'packages/kit/src/index.ts'],
    ['named', 'packages/kit/src/inner/mid.ts'],
    ['halves the amount', 'packages/kit/src/index.ts'],
    ['halves the amount', 'packages/kit/src/inner/mid.ts'],
  ])('says so of `docs_search` for `%s` when %s, which publishes what it shows, changed', async (query, barrel) => {
    const root = await fixture.published(BARRELS);
    const help = await readWorkspace(root);
    expect(await outlived('docs_search', help, { query }, { root }, after(help))).toBe(false);
    appendFileSync(join(root, barrel), '// moved\n');
    expect(await outlived('docs_search', help, { query }, { root }, after(help))).toBe(true);
  });

  it.each([
    ['chainsTo', 'packages/kit/src/held.ts', { 'packages/kit/src/held.ts': 'export interface Tree {\n  chainsTo: string;\n}\n' }],
    ['rarityOf', 'packages/kit/src/uses.ts', { 'packages/kit/src/rarity.ts': 'export const rarity = 1;\n', 'packages/kit/src/uses.ts': "import { rarity as rarityOf } from './rarity.js';\nexport const shown = rarityOf;\n" }],
  ])('says so of `docs_search` for `%s` when %s, which holds the row it shows, changed', async (query, file, files) => {
    const root = await fixture.published(files);
    const help = await readWorkspace(root);
    expect(await outlived('docs_search', help, { query }, { root }, after(help))).toBe(false);
    appendFileSync(join(root, file), '// moved\n');
    expect(await outlived('docs_search', help, { query }, { root }, after(help))).toBe(true);
  });

  it('leaves a `docs_search` answer as it is when a barrel that passes on none of its rows changed', async () => {
    const root = await fixture.published({ ...BARRELS, 'packages/kit/src/aside.ts': "export { taxOf } from './tax.js';\n" });
    const help = await readWorkspace(root);
    appendFileSync(join(root, 'packages/kit/src/aside.ts'), '// moved\n');
    expect(await outlived('docs_search', help, { query: 'deepOf' }, { root }, after(help))).toBe(false);
  });

  it('leaves a `docs_search` answer as it is when a recorded case names a test file gone since the run', async () => {
    const root = await fixture.published(BARRELS);
    const at = testCoverageFile(root);
    mkdirSync(dirname(at), { recursive: true });
    const [file, name] = ['packages/kit/src/gone.test.ts', 'deepOf reads'];
    await writeTestCoverage(at, { version: 3, instrumentation: 'fixture-instrumentation', tests: [], modules: [] }, { index: encodeExecutionIndex({ tests: [{ id: `${file} > ${name}`, file, name }], modules: [] }) });
    const help = await readWorkspace(root);

    expect(search.run(help, { query: 'deepOf' }, { root })).toContain(`deepOf reads [test] — ${file}`);
    expect(await outlived('docs_search', help, { query: 'deepOf' }, { root }, after(help))).toBe(false);
  });

  it('says so of a file saved while its generation was being read, which is stamped later than the file', async () => {
    const root = await fixture.published();
    const help = await readWorkspace(root, {
      progress: (step) => {
        if (step === 'publishing the questions') edit(root);
        return () => {};
      },
    });
    expect(await outlived('docs_symbol', help, { name: 'taxOf' }, { root }, after(help))).toBe(true);
  });

  it('has nothing to look at for a refresh limited to a list, which keeps the time of the read it refreshed', async () => {
    const root = await fixture.published();
    await readWorkspace(root);
    edit(root);
    const started = Date.now();
    const help = await readWorkspaceForAnswer(root, { changed: [] });
    expect(await outlived('docs_symbol', help, { name: 'taxOf' }, { root }, started)).toBe(false);
  });

  it('looks at a generation read whole during the request, as at any other', async () => {
    const root = await fixture.published();
    const started = Date.now();
    const unchanged = await readWorkspace(root);
    expect(await outlived('docs_symbol', unchanged, { name: 'taxOf' }, { root }, started)).toBe(false);
    const moved = await readWorkspace(root, {
      progress: (step) => {
        if (step === 'publishing the questions') edit(root);
        return () => {};
      },
    });
    expect(await outlived('docs_symbol', moved, { name: 'taxOf' }, { root }, started)).toBe(true);
  });

  it('says so of a refusal whose name the generation before it held in a file that moved during the read', async () => {
    const root = await fixture.published();
    const before = await readWorkspace(root);
    const tax = join(root, 'packages/kit/src/tax.ts');
    writeFileSync(tax, readFileSync(tax, 'utf8').replace('taxOf', 'dutyOf'));
    const started = Date.now();
    const unchanged = await readWorkspace(root);
    expect(await outlived('docs_symbol', unchanged, { name: 'taxOf' }, { root }, started, before)).toBe(false);
    const help = await readWorkspace(root, {
      progress: (step) => {
        if (step === 'publishing the questions') edit(root);
        return () => {};
      },
    });
    expect(await outlived('docs_symbol', help, { name: 'taxOf' }, { root }, started, before)).toBe(true);
    expect(await outlived('docs_symbol', help, { name: 'taxOf' }, { root }, started)).toBe(false);
  });

  it('says so of an answer whose name the entry that publishes it stopped passing on', async () => {
    const entry = { 'packages/kit/package.json': JSON.stringify({ name: '@acme/kit', exports: './src/index.ts' }), 'packages/kit/src/index.ts': "export { taxOf } from './tax.js';\n" };
    const root = await fixture.published(entry);
    const help = await readWorkspace(root);
    expect(await outlived('docs_symbol', help, { name: 'taxOf' }, { root }, after(help))).toBe(false);
    writeFileSync(join(root, 'packages/kit/src/index.ts'), 'export {};\n');
    expect(await outlived('docs_symbol', help, { name: 'taxOf' }, { root }, after(help))).toBe(true);
    expect(await outlived('docs_uses', help, { name: 'taxOf' }, { root }, after(help))).toBe(true);
  });

  it('says so of a `docs_uses` answer when a file it lists changed', async () => {
    const root = await fixture.published({ 'packages/kit/src/site.ts': "import { taxOf } from './tax.js';\nexport const levy = taxOf(1);\n" });
    const help = await readWorkspace(root);
    expect(await outlived('docs_uses', help, { name: 'taxOf' }, { root }, after(help))).toBe(false);
    appendFileSync(join(root, 'packages/kit/src/site.ts'), '// moved\n');
    expect(await outlived('docs_uses', help, { name: 'taxOf' }, { root }, after(help))).toBe(true);
  });

  it('says so of a `docs_uses` answer about a name no file here declares, when a file it lists changed', async () => {
    const root = await fixture.published({ 'packages/app/package.json': JSON.stringify({ name: '@acme/app', dependencies: { '@acme/kit': '*' } }), 'packages/app/src/site.ts': "import { ghostOf } from '@acme/kit/src/tax';\nexport const here = ghostOf(1);\n" });
    const help = await readWorkspace(root);
    expect(uses.run(help, { name: 'ghostOf' }, { root })).toContain('site.ts');
    expect(await outlived('docs_uses', help, { name: 'ghostOf' }, { root }, after(help))).toBe(false);
    appendFileSync(join(root, 'packages/app/src/site.ts'), '// moved\n');
    expect(await outlived('docs_uses', help, { name: 'ghostOf' }, { root }, after(help))).toBe(true);
  });

  it('leaves a name no file declares to its refusal, and any question that names no file as it is', async () => {
    const root = await fixture.published();
    const help = await readWorkspace(root);
    edit(root);
    expect(await outlived('docs_symbol', help, { name: 'nowhere' }, { root }, after(help))).toBe(false);
    expect(await outlived('docs_grep', help, { query: 'taxOf' }, { root }, after(help))).toBe(false);
  });

  it('says so of a `docs_uses` answer whose declaring file changed, though no import of the name is in that file', async () => {
    const root = await fixture.published();
    const help = await readWorkspace(root);
    expect(await outlived('docs_uses', help, { name: 'taxOf' }, { root }, after(help))).toBe(false);
    edit(root);
    expect(await outlived('docs_uses', help, { name: 'taxOf' }, { root }, after(help))).toBe(true);
  });

  it('leaves a question its tool refuses to that refusal', async () => {
    const root = await fixture.published();
    const help = await readWorkspace(root);
    expect(await outlived('docs_symbol', help, { name: '' }, { root }, after(help))).toBe(false);
  });
});

describe('a `docs_search` answer once a barrel stops publishing a name', () => {
  it.each([
    ['the entry', 'packages/kit/src/index.ts', "export const shown = 1;\n"],
    ['a barrel in the middle', 'packages/kit/src/inner/mid.ts', "export * from './deep.js';\n"],
  ])('stops reporting it as published when %s drops it, inside the hour a generation is reused for', async (_barrel, file, text) => {
    const root = await fixture.published(BARRELS);
    const before = await asked(root, false, 'docs_search', { query: 'named' });
    expect(before.text).toContain('@acme/kit · named [const]');

    writeFileSync(join(root, file), text);

    const after = await asked(root, false, 'docs_search', { query: 'named' });
    expect(after.text).toContain('packages/kit/src/inner/named.ts');
    expect(after.text).not.toContain('@acme/kit · named [const]');
  });
});

describe('caughtUp', () => {
  it('looks once more at what it read, and says a file moved during that read rather than reading again', async () => {
    const started = Date.now();
    let reads = 0;
    const caught = await caughtUp(new Date(started - 1000).toISOString(), started, async () => {
      reads += 1;
      return 'asked again';
    }, async (subject) => subject === 'asked again');
    expect(caught).toEqual({ subject: 'asked again', unseen: 'a file it rests on changed while it was read' });
    expect(reads).toBe(1);
  });

  it('gives the caveat, and reads nothing more, of a generation made during the question whose file moved during that read', async () => {
    const started = Date.now();
    const at = new Date(started + 1).toISOString();
    let reads = 0;
    const caught = await caughtUp(at, started, async () => {
      reads += 1;
      return 'asked again';
    }, async () => true);
    expect(reads).toBe(0);
    expect(caught).toEqual({ unseen: 'a file it rests on changed while it was read', footer: snapshotLine(at, 'a file it rests on changed while it was read') });
  });

  it('says nothing of the read when no file moved during it', async () => {
    const started = Date.now();
    const caught = await caughtUp(new Date(started - 1000).toISOString(), started, async () => 'asked again', async () => false);
    expect(caught).toEqual({ subject: 'asked again' });
  });

  it('gives the reason to a date line, with no look, when the read failed', async () => {
    const started = Date.now();
    const looked: unknown[] = [];
    const caught = await caughtUp(new Date(started - 1000).toISOString(), started, async () => {
      throw new Error('a manifest is half-written');
    }, async (subject) => {
      looked.push(subject);
      return true;
    });
    expect(looked).toEqual([]);
    expect(caught?.unseen).toBe('it could not be read again: a manifest is half-written');
  });

  it('reads again an outlived answer from a generation made before the question', async () => {
    const started = Date.now();
    expect(await caughtUp(new Date(started - 1000).toISOString(), started, async () => 'asked again')).toEqual({ subject: 'asked again' });
  });

  it('says the checkout was not compared, and why, when reading it again fails', async () => {
    const started = Date.now();
    const caught = await caughtUp(new Date(started - 1000).toISOString(), started, async () => {
      throw new Error('a manifest is half-written');
    });
    expect(caught?.subject).toBeUndefined();
    expect(caught?.footer).toMatch(UNREAD);
    expect(caught?.footer).toContain('a manifest is half-written');
  });

  it('lets an answer stand from a generation made during the question, or from none', async () => {
    const started = Date.now();
    const again = async (): Promise<string> => 'asked again';
    expect(await caughtUp(new Date(started + 1).toISOString(), started, again)).toBeUndefined();
    expect(await caughtUp(undefined, started, again)).toBeUndefined();
  });
});

describe('foundNothingFooter', () => {
  const at = '2026-01-02T03:04:05.000Z';

  it('dates an answer that found nothing with the generation it was read from', () => {
    expect(foundNothingFooter(undefined, at, false)).toBe(`Snapshot ${at}.`);
    expect(foundNothingFooter(undefined, at, true)).toMatch(UNCOMPARED);
    expect(foundNothingFooter(undefined, undefined, false)).toBeUndefined();
  });

  it('dates it once, and says why, when the checkout could not be read again', async () => {
    const started = Date.now();
    const caught = await caughtUp(new Date(started - 1000).toISOString(), started, async () => {
      throw new Error('a manifest is half-written');
    });
    const footer = foundNothingFooter(caught, at, false);
    expect(footer).toMatch(UNREAD);
    expect(footer?.match(/Snapshot/gu)).toHaveLength(1);
  });
});

describe('refusalFooter', () => {
  const at = '2026-01-02T03:04:05.000Z';

  it('dates a refusal only when the checkout was not compared with what it came from', () => {
    expect(refusalFooter(undefined, at, false)).toBeUndefined();
    expect(refusalFooter({ subject: 'read' }, at, false)).toBeUndefined();
    expect(refusalFooter(undefined, at, true)).toMatch(UNCOMPARED);
  });

  it('says why when the look found its file moved during the read', () => {
    expect(refusalFooter({ subject: 'read', unseen: 'it moved' }, at, false)).toBe(snapshotLine(at, 'it moved'));
  });
});

describe('foundNothingAnswer', () => {
  const at = '2026-01-02T03:04:05.000Z';

  it('answers with what found nothing, dated, and leaves any other throw a refusal', () => {
    expect(foundNothingAnswer(new FoundNothing('`nope` is declared nowhere.'), undefined, at, false)).toBe(`\`nope\` is declared nowhere.\nSnapshot ${at}.`);
    expect(foundNothingAnswer(new FoundNothing('`nope` is declared nowhere.'), undefined, undefined, false)).toBe('`nope` is declared nowhere.');
    expect(foundNothingAnswer(new Error('a manifest is half-written'), undefined, at, false)).toBeUndefined();
  });
});

describe('snapshotLine', () => {
  it('names the generation time, and says when the checkout was not compared with it, and why when it was asked to be', () => {
    expect(snapshotLine('2026-01-02T03:04:05.000Z', false)).toBe('Snapshot 2026-01-02T03:04:05.000Z.');
    expect(snapshotLine('2026-01-02T03:04:05.000Z', true)).toMatch(UNCOMPARED);
    expect(snapshotLine('2026-01-02T03:04:05.000Z', 'it could not be read')).toMatch(UNREAD);
  });
});

describe('the help server about a name written after the published generation', () => {
  it.each([false, true])('answers `docs_symbol` from the published generation, `justAnswer` %s, that nothing declares it, and that the checkout was not compared with it', async (justAnswer) => {
    const answer = await served(await fixture.published(), justAnswer);
    expect(answer.isError).toBeUndefined();
    expect(answer.text).toMatch(/^`keptOf` is not published by this workspace/u);
    expect(answer.text).not.toContain('packages/kit/src/kept.ts');
    expect(answer.text).toMatch(UNCOMPARED);
    // Dated once, as `variance ask` dates it.
    expect(answer.text.match(/Snapshot/gu)).toHaveLength(1);
  });

  it('answers a name nothing declares as `variance ask` answers it: what was read, then the generation it was read from', async () => {
    const answer = await served(await fixture.published(), false, 'writtenNowhere');
    expect(answer.isError).toBeUndefined();
    expect(answer.text).toMatch(/^`writtenNowhere` is not published by this workspace.*declares `writtenNowhere`/su);
    expect(answer.text).toMatch(/\nSnapshot \d{4}-\d\d-\d\dT[\d:.]+Z, not compared with the checkout: run `variance index` if files changed since\.$/u);
  });

  it('says why under a refusal, when the file the name was in moved during the read that found it gone', async () => {
    const root = await fixture.published();
    const tax = join(root, 'packages/kit/src/tax.ts');
    writeFileSync(tax, readFileSync(tax, 'utf8').replace('taxOf', 'dutyOf'));
    const answer = await served(root, false, 'taxOf', {
      progress: (step) => {
        if (step === 'publishing the questions') appendFileSync(tax, '// moved\n');
        return () => {};
      },
    });
    expect(answer.text).toMatch(/^`taxOf` is not published/u);
    expect(answer.text).toMatch(/not compared with the checkout \(a file it rests on changed while it was read\)/u);
    expect(answer.text.match(/Snapshot/gu)).toHaveLength(1);
  });

  it('keeps no copy of a reading after a call: no help question compares one call with the last', async () => {
    const root = await fixture.published();
    const copied = vi.spyOn(globalThis, 'structuredClone');
    try {
      await served(root, false, 'taxOf');
      expect(copied).not.toHaveBeenCalled();
    } finally {
      copied.mockRestore();
    }
  });
});

describe('a generation that could not be saved', () => {
  it('keeps its times, so what it answers is dated and its text gated', async () => {
    const root = await fixture.published();
    const help = await readWorkspace(root, { index: join(root, 'package.json', 'index') });
    expect(workspaceGeneration(help)).toBeDefined();
    expect(workspaceReadStarted(help)).toBeDefined();
  });
});

describe('madeBefore', () => {
  it('says a generation made before the question started predates it, and one made during it or with no date does not', () => {
    const started = Date.parse('2026-11-14T08:00:00.000Z');
    expect(madeBefore('2026-11-14T07:59:59.999Z', started)).toBe(true);
    expect(madeBefore('2026-11-14T08:00:00.000Z', started)).toBe(false);
    expect(madeBefore(undefined, started)).toBe(false);
  });
});
