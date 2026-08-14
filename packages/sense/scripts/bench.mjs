/**
 * What a scan costs on the second run, and on the run after a one-line edit.
 *
 * The claim this package makes is not that parsing is fast. It is that the cost
 * of a scan is the size of the **diff** rather than the size of the repository —
 * which only holds if three things are true together: a digest arrives without
 * reading the file, a parse is reused whenever the digest has not moved, and the
 * *edges* are reused whenever no path appeared or disappeared. Any two of them
 * still leave a full pass. So the arms are:
 *
 *   cold   — no digests, no cache. Every file opened, decoded, parsed.
 *   warm   — git's digests, a populated parse cache. Nothing opened, nothing
 *            parsed — and every specifier still put to the resolver.
 *   reuse  — the same, plus records kept from the last run. Nothing resolved.
 *   edit   — one file rewritten, then the reuse arm again. This is the real case.
 *
 * The tree is synthetic and committed to a real repository, because the digests
 * being measured are git's own and a tree with no `HEAD` would silently take the
 * cold path in every arm.
 *
 * Run:  yarn workspace @variance-authority/sense bench
 *       yarn workspace @variance-authority/sense bench 40000
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { memoryParseCache } from '../dist/cache.js';
import { memoryRecordCache } from '../dist/reuse.js';
import { scanRelations } from '../dist/scan.js';
import { gitDigests } from '../dist/tree.js';

/** Components to generate. Each one brings a leaf, a stylesheet and a barrel share. */
const COMPONENTS = Number(process.argv[2] ?? 10_000);
/** Files per directory, so the resolver walks a plausible tree rather than one flat list. */
const FANOUT = 20;

const root = mkdtempSync(join(tmpdir(), 'variance-bench-'));

try {
  console.log(`generating ${COMPONENTS} components under ${root}`);
  generate(root, COMPONENTS);

  git(root, ['init', '--quiet']);
  git(root, ['add', '-A']);
  git(root, ['commit', '--quiet', '-m', 'one']);

  const digests = await time('git ls-tree + status', () => gitDigests(root));
  console.log(`  ${digests.value.size} digests, no file opened`);

  const cold = await time('cold   — no digests, no cache', () =>
    scanRelations({ root, dirs: ['src'], digests: false }),
  );

  const cache = memoryParseCache();
  await scanRelations({ root, dirs: ['src'], cache });
  const warm = await time('warm   — parses remembered', () =>
    scanRelations({ root, dirs: ['src'], cache }),
  );

  const reuse = memoryRecordCache();
  await scanRelations({ root, dirs: ['src'], cache, reuse });
  const kept = await time('reuse  — records remembered too', () =>
    scanRelations({ root, dirs: ['src'], cache, reuse }),
  );

  writeFileSync(join(root, 'src/0/leaf-0.ts'), 'export const leaf0 = 1;\nexport const added = 2;\n');
  const edit = await time('edit   — one file rewritten', () =>
    scanRelations({ root, dirs: ['src'], cache, reuse }),
  );

  console.log(`\n${cold.value.length} files, ${edges(cold.value)} edges`);
  console.log(`parses remembered:  ${(cold.ms / warm.ms).toFixed(1)}× cold`);
  console.log(`records too:        ${(cold.ms / kept.ms).toFixed(1)}× cold`);
  console.log(
    `one edit costs ${(edit.ms - kept.ms).toFixed(0)} ms over a scan that found nothing to do`,
  );
  // Every arm asks git again, because every real run does. What is left after
  // that is the walk and two map lookups per file.
  console.log(`the reuse arm is ${(kept.ms - digests.ms).toFixed(0)} ms of scan, and the rest is git`);
} finally {
  rmSync(root, { recursive: true, force: true });
}

/**
 * A tree shaped like a design system: leaves nobody imports, components that
 * import a leaf and a stylesheet, and a barrel per directory re-exporting them.
 */
function generate(root, count) {
  writeFileSync(join(root, 'package.json'), '{ "name": "bench", "type": "module" }');

  const dirs = Math.ceil(count / FANOUT);
  for (let dir = 0; dir < dirs; dir += 1) {
    const at = join(root, 'src', String(dir));
    mkdirSync(at, { recursive: true });

    const names = [];
    for (let n = 0; n < FANOUT && dir * FANOUT + n < count; n += 1) {
      writeFileSync(join(at, `leaf-${n}.ts`), `export const leaf${n} = ${n};\n`);
      writeFileSync(join(at, `style-${n}.css`), `.c${n} { color: red }\n`);
      writeFileSync(
        join(at, `Comp-${n}.tsx`),
        [
          `import { leaf${n} } from './leaf-${n}.js';`,
          `import './style-${n}.css';`,
          dir > 0 ? `import { Comp0 } from '../${dir - 1}/index.js';` : '',
          `export function Comp${n}() { return leaf${n}; }`,
          '',
        ].join('\n'),
      );
      names.push(n);
    }

    writeFileSync(
      join(at, 'index.ts'),
      names.map((n) => `export { Comp${n} } from './Comp-${n}.js';`).join('\n') + '\n',
    );
  }
}

function edges(records) {
  return records.reduce((total, record) => total + (record.edges?.length ?? 0), 0);
}

async function time(what, work) {
  const started = process.hrtime.bigint();
  const value = await work();
  const ms = Number(process.hrtime.bigint() - started) / 1e6;

  console.log(`${what.padEnd(34)} ${ms.toFixed(0).padStart(6)} ms`);

  return { value, ms };
}

function git(root, args) {
  execFileSync('git', ['-c', 'user.email=bench@example.test', '-c', 'user.name=Bench', ...args], {
    cwd: root,
    stdio: 'ignore',
  });
}
