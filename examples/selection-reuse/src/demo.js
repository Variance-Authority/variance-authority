import { execFileSync } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { RUNTIME_EDGES, affectedBy, relationsOfFiles } from '@variance-authority/core/relate';
import { readPublishedSources, sourcesWithin, updateSourceIndex } from '@variance-authority/sense';

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
  const affected = affectedBy(relationsOfFiles(records), ['src/tokens.css'], { through: RUNTIME_EDGES });
  const components = new Set(affected.components);

  return {
    affected: [...components].sort(),
    collect: components.has('Button') ? ['story:catalog'] : [],
    skip: components.has('Badge') ? [] : ['story:account'],
  };
}

async function scan(root, cacheRoot) {
  const index = join(cacheRoot, 'source-index.bin');
  const started = performance.now();
  const update = await updateSourceIndex(root, { index, dirs: ['src'] });
  if (update.refused !== undefined) throw new Error(update.refused);
  const { records } = await readPublishedSources(update.path);
  const graph = sourcesWithin(records, root, ['src']);
  const elapsedMs = performance.now() - started;
  return { elapsedMs, decision: decision(graph), work: { files: update.files, reread: update.reread, parsed: update.parsed } };
}

export async function runDemo() {
  const root = await mkdtemp(join(tmpdir(), 'variance-selection-reuse-'));
  // A cache is operational state, not source. Keeping it outside the checkout
  // means it cannot move the source-tree layout it is intended to reuse.
  const cacheRoot = await mkdtemp(join(tmpdir(), 'variance-selection-cache-'));

  try {
    await fixture(root);
    const cold = await scan(root, cacheRoot);
    await access(join(cacheRoot, 'source-index.bin'));
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
        cold: cold.work,
        warm: warm.work,
        afterEdit: afterEdit.work,
      },
      cacheAfterCold,
      cacheMagic: (await readFile(join(cacheRoot, 'source-index.bin'))).subarray(0, 8).toString('utf8'),
      cacheSegments: (await readdir(join(cacheRoot, 'source-index.bin.segments'))).length,
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
      `  warm reuse:      ${result.work.warm.files} files, ${result.work.warm.reread} reread, ${result.work.warm.parsed} parsed`,
      `  selection agrees: ${JSON.stringify(result.cold) === JSON.stringify(result.warm) ? 'yes' : 'no'}`,
      '',
    ].join('\n'),
  );
}
