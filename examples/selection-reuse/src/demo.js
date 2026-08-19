import { execFileSync } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { movedBy, relationsOfFiles } from '@variance-authority/core';
import { openParseCache, openRecordCache, scanRelations } from '@variance-authority/sense';

const NOISE_FILES = 300;

function git(root, ...args) {
  execFileSync('git', args, { cwd: root, stdio: 'pipe' });
}

async function write(root, path, contents) {
  const file = join(root, path);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, contents, 'utf8');
}

async function fixture(root) {
  await write(root, 'package.json', '{ "name": "selection-reuse-fixture", "type": "module" }\n');
  await write(root, 'src/tokens.css', ':root { --accent: #0969da; }\n');
  await write(root, 'src/button.css', "@import './tokens.css';\n.button { color: var(--accent); }\n");
  await write(
    root,
    'src/Button.tsx',
    "import './button.css';\nexport function Button() { return <button className=\"button\">Save</button>; }\n",
  );
  await write(root, 'src/Badge.tsx', 'export function Badge() { return <span>New</span>; }\n');

  for (let index = 0; index < NOISE_FILES; index += 1) {
    await write(root, `src/noise/N${index}.ts`, `export const N${index} = ${index};\n`);
  }

  git(root, 'init', '--quiet');
  git(root, 'config', 'user.email', 'example@variance-authority.test');
  git(root, 'config', 'user.name', 'Variance Authority example');
  git(root, 'add', '-A');
  git(root, 'commit', '--quiet', '-m', 'baseline');
}

function decision(records) {
  const reached = movedBy(relationsOfFiles(records), ['src/tokens.css']);
  const components = new Set(reached.components);

  return {
    reached: [...components].sort(),
    collect: components.has('Button') ? ['story:catalog'] : [],
    skip: components.has('Badge') ? [] : ['story:account'],
  };
}

async function scan(root, cacheRoot) {
  const parsed = meter(await openParseCache(join(cacheRoot, 'parse.json')));
  const records = meter(await openRecordCache(join(cacheRoot, 'records.json')));
  const started = performance.now();
  const graph = await scanRelations({ root, dirs: ['src'], cache: parsed.cache, reuse: records.cache });
  const elapsedMs = performance.now() - started;
  await Promise.all([parsed.cache.save(), records.cache.save()]);
  return { elapsedMs, decision: decision(graph), parsed: parsed.stats, records: records.stats };
}

/** Count the work a cache prevented without changing the cache's behaviour. */
function meter(cache) {
  const stats = { lookups: 0, hits: 0, writes: 0 };

  return {
    stats,
    cache: {
      get(...args) {
        stats.lookups += 1;
        const value = cache.get(...args);
        if (value !== undefined) stats.hits += 1;
        return value;
      },
      set(...args) {
        stats.writes += 1;
        return cache.set(...args);
      },
      ...(cache.under === undefined ? {} : { under: (...args) => cache.under(...args) }),
      save: () => cache.save(),
    },
  };
}

export async function runDemo() {
  const root = await mkdtemp(join(tmpdir(), 'variance-selection-reuse-'));
  // A cache is operational state, not source. Keeping it outside the checkout
  // means it cannot move the source-tree layout it is intended to reuse.
  const cacheRoot = await mkdtemp(join(tmpdir(), 'variance-selection-cache-'));

  try {
    await fixture(root);
    const cold = await scan(root, cacheRoot);
    await Promise.all([access(join(cacheRoot, 'parse.json')), access(join(cacheRoot, 'records.json'))]);
    const cacheAfterCold = true;
    const warm = await scan(root, cacheRoot);

    await write(root, 'src/tokens.css', ':root { --accent: #8250df; }\n');
    const afterEdit = await scan(root, cacheRoot);

    return {
      coldMs: cold.elapsedMs,
      warmMs: warm.elapsedMs,
      afterEditMs: afterEdit.elapsedMs,
      cold: cold.decision,
      warm: warm.decision,
      afterEdit: afterEdit.decision,
      work: {
        cold: { parsed: cold.parsed, records: cold.records },
        warm: { parsed: warm.parsed, records: warm.records },
        afterEdit: { parsed: afterEdit.parsed, records: afterEdit.records },
      },
      cacheAfterCold,
      cacheFiles: {
        parse: await readFile(join(cacheRoot, 'parse.json'), 'utf8'),
        records: await readFile(join(cacheRoot, 'records.json'), 'utf8'),
      },
    };
  } finally {
    await Promise.all([
      rm(root, { recursive: true, force: true }),
      rm(cacheRoot, { recursive: true, force: true }),
    ]);
  }
}

export function print(result) {
  const speedup = result.coldMs / result.warmMs;
  console.log(
    [
      '',
      'CACHED SOURCE SELECTION — one changed token',
      '  changed:  src/tokens.css',
      `  collect:  ${result.warm.collect.join(', ') || '—'} (reaches Button)`,
      `  skip:     ${result.warm.skip.join(', ') || '—'} (does not reach Badge)`,
      '',
      `  cold scan:       ${result.coldMs.toFixed(1)} ms`,
      `  warm scan:       ${result.warmMs.toFixed(1)} ms`,
      `  after token edit: ${result.afterEditMs.toFixed(1)} ms`,
      `  speedup:         ${speedup.toFixed(1)}×`,
      `  warm reuse:      ${result.work.warm.records.hits} records reused, ${result.work.warm.records.writes} rebuilt`,
      `  selection agrees: ${JSON.stringify(result.cold) === JSON.stringify(result.warm) ? 'yes' : 'no'}`,
      '',
    ].join('\n'),
  );
}
