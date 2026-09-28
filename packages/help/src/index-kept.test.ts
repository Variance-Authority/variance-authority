import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readPublishedSources, sourceIndexPath, updateSourceIndex } from '@variance-authority/sense';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readWorkspace } from './read.js';

/**
 * A reading publishes what it learned, and never narrows the source index it
 * read.
 *
 * `variance index` keeps one index for the whole checkout, and every other
 * reader of it — `select` tracing a lockfile bump, `reach` — reads records the
 * help scan never asks about. A save keeps only the records its own scan
 * touched, so a help scan of less than the whole checkout that saved would
 * delete the rest.
 */

const made: string[] = [];
let previous: string | undefined;

beforeEach(() => {
  previous = process.env['VARIANCE_AUTHORITY_CACHE'];
  process.env['VARIANCE_AUTHORITY_CACHE'] = temporary('va-kept-cache-');
});

afterEach(() => {
  if (previous === undefined) delete process.env['VARIANCE_AUTHORITY_CACHE'];
  else process.env['VARIANCE_AUTHORITY_CACHE'] = previous;
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function temporary(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  made.push(dir);
  return dir;
}

function write(root: string, files: Readonly<Record<string, string>>): void {
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(join(root, file, '..'), { recursive: true });
    writeFileSync(join(root, file), text);
  }
}

async function held(index: string): Promise<readonly string[]> {
  return (await readPublishedSources(index)).records.map((record) => record.file);
}

describe('a reading over a published source index', () => {
  it('scans the whole checkout from a root spelled through a link, and keeps every record', async () => {
    const real = temporary('va-kept-real-');
    const link = join(temporary('va-kept-link-'), 'checkout');
    symlinkSync(real, link);
    execFileSync('git', ['init', '--quiet'], { cwd: real });
    write(real, {
      'package.json': '{"name":"linked","type":"module","exports":{".":"./src/index.ts"}}\n',
      'src/index.ts': "import left from 'left';\nexport const value = left;\n",
      'test/value.test.ts': "import { value } from '../src/index';\nvalue;\n",
    });
    const index = (await updateSourceIndex(link)).path;
    const before = await held(index);

    let scanned: readonly string[] = [];
    await readWorkspace(link, { index, records: (records) => { scanned = records.map((record) => record.file); } });

    expect(before).toEqual(['src/index.ts', 'test/value.test.ts']);
    expect(scanned).toEqual(before);
    expect(await held(index)).toEqual(before);
  });

  it('publishes a scan of some directories without writing it over the index of the whole', async () => {
    const repository = temporary('va-kept-repository-');
    execFileSync('git', ['init', '--quiet'], { cwd: repository });
    write(repository, {
      'app/package.json': '{"name":"app","private":true,"workspaces":["../lib"]}\n',
      'lib/package.json': '{"name":"lib","type":"module","exports":{".":"./index.ts"}}\n',
      'lib/index.ts': 'export const lib = 1;\n',
      'tools/build.ts': "import { lib } from '../lib/index';\nlib;\n",
    });
    const index = (await updateSourceIndex(repository)).path;
    const before = await held(index);

    await readWorkspace(join(repository, 'app'), { index: sourceIndexPath(repository) });

    expect(before).toContain('tools/build.ts');
    expect(await held(index)).toEqual(before);
  });
});
