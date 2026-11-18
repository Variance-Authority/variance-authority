import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sessionSources, type SessionScript } from '@variance-authority/sense/test-selection';
import { BUNDLE, BUNDLE_FUNCTIONS, BUNDLE_MAP, MAIN, MATH } from './session-input.fixture.js';
import { OperatorError } from '../exit.js';
import { readSession } from './session-input.js';

let root: string;
const functions = BUNDLE_FUNCTIONS;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'variance-session-'));
  await mkdir(join(root, 'src'));
  await mkdir(join(root, 'dist'));
  await writeFile(join(root, 'src/math.ts'), MATH);
  await writeFile(join(root, 'src/main.ts'), MAIN);
  await writeFile(join(root, 'dist/main.js'), BUNDLE);
  await writeFile(join(root, 'dist/main.js.map'), JSON.stringify(BUNDLE_MAP));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

/** Each function of `src/math.ts` by name, with what the scripts say of it. */
function math(scripts: readonly SessionScript[]): Record<string, string> {
  const read = sessionSources(scripts, 'presence');
  const source = read.sources.find((each) => each.file === join(root, 'src/math.ts'));
  return Object.fromEntries((source?.functions ?? []).map((each) => [each.row.name, each.state]));
}

const EXPECTED = { add: 'ran', never: 'unknown', twice: 'ran' };

/** Each line's length as Node's source-map cache writes it beside a script. */
function lineLengths(text: string): number[] {
  return text.split(/\n|\u2028|\u2029/).map((line) => line.length);
}

describe('a session read from what V8 wrote', () => {
  it('reads a NODE_V8_COVERAGE directory through the source maps Node cached', async () => {
    const node = join(root, 'node-coverage');
    await mkdir(node);
    const url = `file://${join(root, 'dist/main.js')}`;
    // Node keeps no script text, and caches the map it read beside the script.
    await writeFile(join(root, 'dist/main.js.map'), '{}');
    await writeFile(join(node, 'coverage-1-1-0.json'), JSON.stringify({
      result: [{ url, scriptId: '1', functions }, { url: 'node:internal/main', scriptId: '2', functions: [] }],
      'source-map-cache': { [url]: { lineLengths: lineLengths(BUNDLE), data: BUNDLE_MAP, url: 'main.js.map' } },
    }));
    try {
      const session = await readSession(node, undefined);

      expect(session.skipped).toEqual([]);
      expect(math(session.scripts)).toEqual(EXPECTED);
    } finally {
      await writeFile(join(root, 'dist/main.js.map'), JSON.stringify(BUNDLE_MAP));
    }
  });

  it('names a Node script whose file no longer holds the text it ran, and reads none of it', async () => {
    const node = join(root, 'node-rebuilt');
    await mkdir(node);
    const url = `file://${join(root, 'dist/main.js')}`;
    // The text V8 counted had a two-line banner the file on disk has lost since.
    const ran = `/**\n */\n${BUNDLE}`;
    await writeFile(join(node, 'coverage-1-1-0.json'), JSON.stringify({
      result: [{ url, scriptId: '1', functions }],
      'source-map-cache': { [url]: { lineLengths: lineLengths(ran), data: BUNDLE_MAP, url: 'main.js.map' } },
    }));
    const session = await readSession(node, undefined);

    expect(session.scripts).toEqual([]);
    expect(session.skipped).toEqual([url]);
  });

  it('names a served script no file under the served directory answers, and reads none of it', async () => {
    const at = join(root, 'cdn.json');
    const url = 'https://cdn.example.com/analytics/track.js';
    await writeFile(at, JSON.stringify([{ url, scriptId: '1', source: 'function track() {}\ntrack();\n', functions: [] }]));
    const session = await readSession(at, join(root, 'dist'));

    expect(session.scripts).toEqual([]);
    expect(session.skipped).toEqual([url]);
  });

  it('reads Playwright\'s coverage of a page through the map beside the served script', async () => {
    const at = join(root, 'playwright.json');
    await writeFile(at, JSON.stringify([
      { url: 'http://localhost:5173/main.js', scriptId: '1', source: BUNDLE, functions },
      { url: 'chrome-extension://abc/inject.js', scriptId: '2', source: 'x', functions: [] },
      { url: '', scriptId: '3', source: '1', functions: [] },
    ]));
    const session = await readSession(at, join(root, 'dist'));

    expect(session.scripts.map((script) => script.file)).toEqual([join(root, 'dist/main.js')]);
    expect(session.skipped).toEqual(['chrome-extension://abc/inject.js']);
    expect(math(session.scripts)).toEqual(EXPECTED);
  });

  it('reads CDP\'s precise coverage with the map inline in the script', async () => {
    const inline = BUNDLE.replace(
      'sourceMappingURL=main.js.map',
      `sourceMappingURL=data:application/json;base64,${Buffer.from(JSON.stringify(BUNDLE_MAP)).toString('base64')}`,
    );
    const at = join(root, 'cdp.json');
    await writeFile(at, JSON.stringify({ result: [{ url: `file://${join(root, 'dist/main.js')}`, scriptId: '1', source: inline, functions }] }));

    expect(math((await readSession(at, undefined)).scripts)).toEqual(EXPECTED);
  });

  it('reads a script CDP names by its bare path, as the inspector names a CommonJS module', async () => {
    const at = join(root, 'bare-path.json');
    await writeFile(at, JSON.stringify({ result: [{ url: join(root, 'dist/main.js'), scriptId: '1', source: BUNDLE, functions }] }));

    expect(math((await readSession(at, undefined)).scripts)).toEqual(EXPECTED);
  });

  it('resolves a map\'s sources against the map\'s own directory, not the script\'s', async () => {
    await mkdir(join(root, 'dist/maps'), { recursive: true });
    await writeFile(join(root, 'dist/maps/main.js.map'), JSON.stringify({ ...BUNDLE_MAP, sources: ['../../src/math.ts', '../../src/main.ts'] }));
    const at = join(root, 'apart.json');
    const source = BUNDLE.replace('sourceMappingURL=main.js.map', 'sourceMappingURL=maps/main.js.map');
    await writeFile(join(root, 'dist/apart.js'), source);
    await writeFile(at, JSON.stringify({ result: [{ url: `file://${join(root, 'dist/apart.js')}`, scriptId: '1', source, functions }] }));

    expect(math((await readSession(at, undefined)).scripts)).toEqual(EXPECTED);
  });

  it('reads a served script\'s map from the URL its comment names, under the served directory', async () => {
    await mkdir(join(root, 'dist/assets'), { recursive: true });
    await writeFile(join(root, 'dist/assets/app.js.map'), JSON.stringify({ ...BUNDLE_MAP, sources: ['../../src/math.ts', '../../src/main.ts'] }));
    const at = join(root, 'absolute-map.json');
    const scripts = ['/assets/app.js.map', 'http://localhost:5173/assets/app.js.map', 'app.js.map?v=1'].map((url, index) => {
      const source = BUNDLE.replace('sourceMappingURL=main.js.map', `sourceMappingURL=${url}`);
      return { url: `http://localhost:5173/assets/app.js?${index}`, scriptId: String(index), source, functions };
    });
    for (const script of scripts) {
      await writeFile(at, JSON.stringify([script]));
      await writeFile(join(root, 'dist/assets/app.js'), script.source);
      const session = await readSession(at, join(root, 'dist'));

      expect(session.skipped).toEqual([]);
      expect(math(session.scripts)).toEqual(EXPECTED);
    }
  });

  it('reads a script\'s map from the file: URL its comment names, and names one whose URL is no file here', async () => {
    const script = async (name: string, mapUrl: string) => {
      const source = BUNDLE.replace('sourceMappingURL=main.js.map', `sourceMappingURL=${mapUrl}`);
      await writeFile(join(root, `dist/${name}.js`), source);
      return { url: `file://${join(root, `dist/${name}.js`)}`, scriptId: name, source, functions };
    };
    const local = await script('file-map', `file://${join(root, 'dist/main.js.map')}`);
    const remote = await script('remote-map', 'file://remote/main.js.map');
    const at = join(root, 'file-map.json');
    await writeFile(at, JSON.stringify({ result: [local, remote] }));
    const session = await readSession(at, undefined);

    expect(session.skipped).toEqual([remote.url]);
    expect(math(session.scripts)).toEqual(EXPECTED);
  });

  it('names a served script whose file is another build than the one that ran, rather than read it through that build\'s map', async () => {
    const at = join(root, 'rebuilt.json');
    const url = 'http://localhost:5173/main.js';
    // The page ran a build with a banner the file on disk, and the map beside it, no longer have.
    await writeFile(at, JSON.stringify([{ url, scriptId: '1', source: `/**/\n${BUNDLE}`, functions }]));
    const session = await readSession(at, join(root, 'dist'));

    expect(session.scripts).toEqual([]);
    expect(session.skipped).toEqual([url]);
  });

  it('names a served script it cannot place without a served directory, and reads none of it', async () => {
    const at = join(root, 'unserved.json');
    await writeFile(at, JSON.stringify([{ url: 'http://localhost:5173/main.js', scriptId: '1', source: BUNDLE, functions }]));
    const session = await readSession(at, undefined);

    expect(session.scripts).toEqual([]);
    expect(session.skipped).toEqual(['http://localhost:5173/main.js']);
  });

  it('refuses a path that holds no V8 coverage export, naming the path', async () => {
    await writeFile(join(root, 'torn.json'), '[{');
    await writeFile(join(root, 'other.json'), JSON.stringify({ tests: [] }));

    await expect(readSession(join(root, 'absent.json'), undefined)).rejects.toThrow(new OperatorError(`no session at ${join(root, 'absent.json')}`));
    await expect(readSession(join(root, 'torn.json'), undefined)).rejects.toThrow(`${join(root, 'torn.json')} is not a V8 coverage export:`);
    await expect(readSession(join(root, 'other.json'), undefined)).rejects.toThrow(`${join(root, 'other.json')} is not a V8 coverage export: neither Playwright's array nor CDP's or Node's { result }`);
  });

  it('names each script whose URL or map cannot be read, and reads none of it', async () => {
    await writeFile(join(root, 'dist/torn.js.map'), '{');
    await writeFile(join(root, 'dist/index.js.map'), JSON.stringify({ version: 3, sections: [] }));
    const naming = (url: string) => BUNDLE.replace('sourceMappingURL=main.js.map', `sourceMappingURL=${url}`);
    const script = (url: string, source: string) => ({ url, scriptId: url, source, functions });
    const scripts = [
      script('http://[bad/main.js', BUNDLE),
      script('http://localhost:5173/main.js?absent', naming('absent.js.map')),
      script('http://localhost:5173/main.js?torn', naming('torn.js.map')),
      script('http://localhost:5173/main.js?index', naming('index.js.map')),
      script('http://localhost:5173/main.js?plain', naming('data:text/plain,x')),
      script('http://localhost:5173/main.js?remote', naming('file://remote/main.js.map')),
    ];
    const at = join(root, 'unread.json');
    await writeFile(at, JSON.stringify(scripts));
    const session = await readSession(at, join(root, 'dist'));

    expect(session.scripts).toEqual([]);
    expect(session.skipped).toEqual(scripts.map((each) => each.url));
  });
});
