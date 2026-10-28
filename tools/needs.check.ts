import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { READS, advice, git, needs, remember, said, twinsOf, unitsIn } from './needs.mjs';

/**
 * Existing code with the needs of a function just written.
 *
 * A copy re-typed in its own shape shares no run of tokens with the code it
 * copies, so `clones.mjs` misses it, and `owners.mjs` knows only the idioms it
 * lists. What the copy cannot rename is what it needs: the calls it makes, the
 * fields it reads, the strings and types it names. Two functions that need the
 * same things answer the same question, whatever their shape.
 */

interface Unit {
  readonly path: string;
  readonly name: string;
  readonly kind: 'function' | 'constant';
  readonly line: number;
}

interface Twin {
  readonly path: string;
  readonly name: string;
  readonly line: number;
  readonly share: number;
}

const existing = [
  ...unitsIn(
    'packages/workspace/src/manifest.ts',
    [
      "import { readFileSync } from 'node:fs';",
      'export function readManifest(path: string) {',
      "  const text = readFileSync(path, 'utf8');",
      '  const parsed = JSON.parse(text);',
      "  if (typeof parsed.name !== 'string') throw new Error(`${path}: no name`);",
      "  return { name: parsed.name, version: parsed.version ?? '0.0.0', workspaces: parsed.workspaces ?? [] };",
      '}',
      "export const DEFAULT_VERSION = '0.0.0';",
    ].join('\n'),
  ),
  ...unitsIn(
    'packages/report/src/duration.ts',
    [
      'export function formatDuration(milliseconds: number): string {',
      '  const seconds = Math.floor(milliseconds / 1000);',
      '  const minutes = Math.floor(seconds / 60);',
      '  return minutes > 0 ? `${minutes} min ${seconds % 60} s` : `${seconds} s`;',
      '}',
      'export class Clock {',
      '  constructor(private readonly start: number) {',
      '    this.start = start;',
      '  }',
      '  elapsed(now: number) {',
      '    return formatDuration(now - this.start);',
      '  }',
      '}',
    ].join('\n'),
  ),
];

const named = (units: readonly Unit[]) => units.map((unit) => `${unit.kind} ${unit.name} ${unit.line}`);
const twins = (path: string, text: string) =>
  (twinsOf(unitsIn(path, text), existing) as readonly { unit: Unit; twins: readonly Twin[] }[]).map(
    ({ unit, twins }) => `${unit.name}: ${twins.map((twin) => `${twin.path}#${twin.name}`).join(', ')}`,
  );

describe('the needs reader', () => {
  it('reads every named function, method and top-level constant', () => {
    expect(named(existing)).toEqual([
      'function readManifest 2',
      'constant DEFAULT_VERSION 8',
      'function formatDuration 1',
      'function constructor 7',
      'function elapsed 10',
    ]);
  });

  it('reads a constant where the module declares it, not in a block or a loop at its top', () => {
    const text = [
      'export const LIMIT = 10;',
      'for (const row of [1, 2]) {',
      '  const doubled = row * 2;',
      '  console.log(doubled);',
      '}',
      'if (LIMIT > 5) {',
      "  const label = 'many';",
      '  console.log(label);',
      '}',
    ].join('\n');
    expect(named(unitsIn('tools/top.mjs', text))).toEqual(['constant LIMIT 1']);
  });

  it('names the existing function a rewritten one shares its needs with', () => {
    expect(
      twins(
        'packages/cli/src/config.ts',
        [
          "import { readFileSync } from 'node:fs';",
          'export const loadPackage = (path: string) => {',
          '  const json = JSON.parse(readFileSync(path, "utf8"));',
          "  if (typeof json.name !== 'string') {",
          '    throw new Error(`${path}: no name`);',
          '  }',
          '  const workspaces = json.workspaces ?? [];',
          "  return { name: json.name, version: json.version ?? '0.0.0', workspaces };",
          '};',
        ].join('\n'),
      ),
    ).toEqual(['loadPackage: packages/workspace/src/manifest.ts#readManifest']);
  });

  it('names nothing for a function with other needs', () => {
    expect(
      twins(
        'packages/cli/src/order.ts',
        [
          'export function byWeight(rows: readonly { weight: number; id: string }[]) {',
          '  return [...rows].sort((left, right) => right.weight - left.weight).map((row) => row.id).slice(0, 10);',
          '}',
        ].join('\n'),
      ),
    ).toEqual([]);
  });

  it('asks nothing of a function with fewer than five needs, nor of a constant or a constructor', () => {
    expect(
      twins(
        'packages/cli/src/small.ts',
        [
          "import { readFileSync as read } from 'node:fs';",
          "export const VERSION_DEFAULT = '0.0.0';",
          'export const half = (value: number) => value / 2;',
          'export class Package {',
          '  manifest: { name: string; version: string; workspaces: string[] };',
          '  constructor(file: string) {',
          '    const json = JSON.parse(read(file, "utf8"));',
          "    if (typeof json.name !== 'string') throw new Error(`${file}: no name`);",
          "    this.manifest = { name: json.name, version: json.version ?? '0.0.0', workspaces: json.workspaces ?? [] };",
          '  }',
          '}',
        ].join('\n'),
      ),
    ).toEqual([]);
  });

  it('never names the function as its own twin', () => {
    const added = existing.filter((unit: Unit) => unit.name === 'readManifest');
    expect(twinsOf(added, existing)).toEqual([]);
  });
});

describe('needs', () => {
  const made: string[] = [];
  afterEach(async () => {
    for (const dir of made.splice(0)) await rm(dir, { recursive: true, force: true });
  });

  // A repository whose `origin/main` holds `files`, committed.
  const repository = async (files: Record<string, readonly string[]>) => {
    const dir = await mkdtemp(join(tmpdir(), 'needs-'));
    made.push(dir);
    const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' });
    const write = async (path: string, text: readonly string[]) => {
      await mkdir(join(dir, path, '..'), { recursive: true });
      await writeFile(join(dir, path), text.join('\n'));
    };
    git('init', '-q', '-b', 'main');
    for (const [path, text] of Object.entries(files)) await write(path, text);
    git('add', '.');
    git('-c', 'user.email=a@b.c', '-c', 'user.name=a', 'commit', '-qm', 'one');
    git('update-ref', 'refs/remotes/origin/main', 'HEAD');
    return { dir, write };
  };

  const manifest = [
    "import { readFileSync } from 'node:fs';",
    'export function readManifest(path: string) {',
    "  const parsed = JSON.parse(readFileSync(path, 'utf8'));",
    "  if (typeof parsed.name !== 'string') throw new Error(`${path}: no name`);",
    "  return { name: parsed.name, version: parsed.version ?? '0.0.0', workspaces: parsed.workspaces ?? [] };",
    '}',
  ];

  it("says what git said, in one line, when a git command fails", async () => {
    const { dir } = await repository({ 'packages/a/src/a.ts': ['export const a = 1;'] });
    let message = '';
    try {
      git(dir, ['rev-parse', '--verify', 'nonsense']);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/^git rev-parse: fatal: /);
    expect(message).not.toContain('\n');
  });

  it('asks about the functions new since the branch left origin/main, and only those', async () => {
    const { dir, write } = await repository({
      'packages/workspace/src/manifest.ts': manifest,
      'packages/cli/src/config.ts': ['export function byWeight(rows: readonly { weight: number }[]) {', '  return rows.length;', '}'],
    });

    // An edit to a function the file already held asks nothing; a function new in it, or in a new file, asks.
    await write('packages/cli/src/config.ts', [
      "import { readFileSync } from 'node:fs';",
      'export function byWeight(rows: readonly { weight: number }[]) {',
      '  return rows.length + 1;',
      '}',
      'export const loadPackage = (path: string) => {',
      '  const json = JSON.parse(readFileSync(path, "utf8"));',
      "  if (typeof json.name !== 'string') throw new Error(`${path}: no name`);",
      "  return { name: json.name, version: json.version ?? '0.0.0', workspaces: json.workspaces ?? [] };",
      '};',
    ]);
    await write('packages/cli/src/order.ts', ['export function byId(rows: readonly { id: string }[]) {', '  return [...rows].sort((a, b) => a.id.localeCompare(b.id)).map((row) => row.id);', '}']);

    expect(said(needs(dir))).toBe(
      [
        'needs: 1 of 2 new functions asked about need what existing ones need. Read them; where one answers, call or extend it:',
        '  packages/cli/src/config.ts:5 loadPackage',
        '    0.624 packages/workspace/src/manifest.ts:2 readManifest',
        '',
      ].join('\n'),
    );
  });

  it('names a new function in a file whose path is not ASCII', async () => {
    const { dir, write } = await repository({ 'packages/workspace/src/manifest.ts': manifest });
    await write('packages/cli/src/café.ts', [
      "import { readFileSync } from 'node:fs';",
      'export const loadPackage = (path: string) => {',
      '  const json = JSON.parse(readFileSync(path, "utf8"));',
      "  if (typeof json.name !== 'string') throw new Error(`${path}: no name`);",
      "  return { name: json.name, version: json.version ?? '0.0.0', workspaces: json.workspaces ?? [] };",
      '};',
    ]);

    expect(said(needs(dir))).toBe(
      [
        'needs: 1 of 1 new functions asked about need what existing ones need. Read them; where one answers, call or extend it:',
        '  packages/cli/src/café.ts:2 loadPackage',
        '    0.581 packages/workspace/src/manifest.ts:2 readManifest',
        '',
      ].join('\n'),
    );
  });

  it('names a file oxc cannot parse, and reads the rest', async () => {
    const { dir, write } = await repository({
      'packages/workspace/src/manifest.ts': manifest,
      'packages/cli/src/config.ts': ['export function byWeight(rows: readonly { weight: number }[]) {', '  return rows.length;', '}'],
    });
    await write('tools/half.mjs', ['export function half(', '']);
    await write('packages/cli/src/config.ts', [
      "import { readFileSync } from 'node:fs';",
      'export function byWeight(rows: readonly { weight: number }[]) {',
      '  return rows.length;',
      '}',
      'export const loadPackage = (path: string) => {',
      '  const json = JSON.parse(readFileSync(path, "utf8"));',
      "  if (typeof json.name !== 'string') throw new Error(`${path}: no name`);",
      "  return { name: json.name, version: json.version ?? '0.0.0', workspaces: json.workspaces ?? [] };",
      '};',
    ]);

    expect(said(needs(dir))).toBe(
      [
        'needs: 1 of 1 new functions asked about need what existing ones need. Read them; where one answers, call or extend it:',
        '  packages/cli/src/config.ts:5 loadPackage',
        '    0.624 packages/workspace/src/manifest.ts:2 readManifest',
        'needs: oxc could not parse tools/half.mjs, so its functions are not read',
        '',
      ].join('\n'),
    );
  });

  it('reads one text by the language of each path that holds it, cached or not', async () => {
    // The same blob is TypeScript at one path and a syntax error at the other.
    const typed = ['export function count(rows: readonly { id: string }[]): number {', '  return rows.length;', '}'];
    const { dir, write } = await repository({ 'packages/a/src/count.ts': typed, 'packages/a/src/count.js': typed });
    await write('packages/a/src/order.ts', ['export function byId(rows: readonly { id: string }[]) {', '  return [...rows].sort((a, b) => a.id.localeCompare(b.id)).map((row) => row.id);', '}']);

    const first = needs(dir);
    await remember(first.cache);
    expect(said(first)).toBe(
      [
        'needs: no existing function named for the 1 new functions asked about; that clears none of them',
        'needs: oxc could not parse packages/a/src/count.js, so its functions are not read',
        '',
      ].join('\n'),
    );
    expect(said(needs(dir))).toBe(said(first));
  });

  it('reads nothing past the change when no function on it is new', async () => {
    const { dir } = await repository({ 'packages/workspace/src/manifest.ts': manifest, 'tools/half.mjs': ['export function half(', ''] });

    expect(said(needs(dir))).toBe('needs: no new function to ask about\n');
  });

  it('keeps what its cache held when a run reads nothing past the change', async () => {
    const config = ['export function byWeight(rows: readonly { weight: number }[]) {', '  return rows.length;', '}'];
    const { dir, write } = await repository({ 'packages/workspace/src/manifest.ts': manifest, 'packages/cli/src/config.ts': config });
    const held = (file: string) => Object.keys(JSON.parse(readFileSync(file, 'utf8')).blobs).sort();
    await write('packages/cli/src/order.ts', ['export function byId(rows: readonly { id: string }[]) {', '  return [...rows].sort((a, b) => a.id.localeCompare(b.id)).map((row) => row.id);', '}']);
    const whole = needs(dir);
    await remember(whole.cache);
    await rm(join(dir, 'packages/cli/src/order.ts'));

    const early = needs(dir);
    await remember(early.cache);
    expect(held(early.cache.file)).toEqual(held(whole.cache.file));
    expect(held(early.cache.file)).toHaveLength(2);
  });

  it('neither asks about nor names a function outside the production sources', async () => {
    const { dir, write } = await repository({ 'site/app/manifest.ts': manifest });
    const load = [
      "import { readFileSync } from 'node:fs';",
      'export const loadPackage = (path: string) => {',
      '  const json = JSON.parse(readFileSync(path, "utf8"));',
      "  if (typeof json.name !== 'string') throw new Error(`${path}: no name`);",
      "  return { name: json.name, version: json.version ?? '0.0.0', workspaces: json.workspaces ?? [] };",
      '};',
    ];
    await write('packages/cli/src/config.ts', load);
    await write('packages/cli/scripts/config.mjs', load.map((line) => line.replace('(path: string)', '(path)')));

    expect(said(needs(dir))).toBe('needs: no existing function named for the 1 new functions asked about; that clears none of them\n');
  });

  it('keys its cache by every text that shapes a bag, the word splitter included', () => {
    expect(READS.some((path: string) => readFileSync(path, 'utf8').includes('export function tokensOf('))).toBe(true);
  });
});

describe('advice', () => {
  const made: string[] = [];
  afterEach(async () => {
    for (const dir of made.splice(0)) await rm(dir, { recursive: true, force: true });
  });

  it('names what kept the list from being read, in one line, instead of failing the loop', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'needs-'));
    made.push(dir);
    const run = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' });
    run('init', '-q', '-b', 'main');
    await writeFile(join(dir, 'a.ts'), 'export const a = 1;\n');
    run('add', '.');
    run('-c', 'user.email=a@b.c', '-c', 'user.name=a', 'commit', '-qm', 'one');

    expect(await advice(dir)).toBe('needs: not read, no merge base with origin/main to measure the branch from\n');
  });
});
