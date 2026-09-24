#!/usr/bin/env node

/**
 * Build the native scanner, and put it where the loader looks.
 *
 * `cargo` produces a `cdylib` under its own name and extension; Node loads a
 * `.node`, which is the same Mach-O, ELF or PE object under a different suffix.
 * The copy is the whole build step — there is no bundler here and no generated
 * bindings.
 *
 * Where the copy lands is the one decision this script makes. A platform we
 * publish for has a package under `npm/`, and the binary goes into it: that is
 * the same directory a consumer's package manager unpacks, so this checkout and
 * an install resolve the addon by the identical path and there is no
 * development-only loading path to keep working. A platform we do not publish
 * for has nowhere like that to write, so the binary goes to `dist/native/`,
 * which is the loader's second attempt and this script's only reason to have
 * one: somebody on a musl Linux who compiles gets the addon without a package
 * existing for them.
 *
 * `--target <triple>` cross-compiles, which is how the release matrix fills one
 * package per runner.
 *
 * One binary per platform, built for the floor of it: `rustc` builds
 * `aarch64-apple-darwin` for `apple-m1`, which every Apple Silicon Mac runs.
 * Narrowing that to a later core was measured and did not pay — what a newer
 * machine wants is a different number of workers, which is a runtime decision.
 *
 * `SENSE_TARGET_CPU` appends a `-C target-cpu`, which is the knob that says so
 * again when a generation lands; `scripts/tuned-cost.mjs` is what drives it.
 *
 * A missing toolchain is not a failure of the build. The JavaScript scanner is
 * the implementation of record and the native one is an acceleration of it, so a
 * checkout without `cargo` builds and scans — it scans slower, and
 * `native.test.ts` says which half ran. What it cannot do is record: the probes
 * are placed by this addon alone, so the suite's own recording and every test of
 * instrumentation fail by name until a toolchain or a prebuilt package provides
 * it. A missing toolchain for a target that was *asked for* is a failure,
 * because somebody asking for one wanted it.
 *
 * The same argument, one level in: a build that fails on the tree-sitter
 * grammars is retried without them rather than given up on. They are five C
 * parsers this crate did not write, compiled by whatever `cc` is here, and
 * dropping them costs the acceleration of five languages while the scanner —
 * git identity, the path set, the oxc parse, resolution, the journey fold —
 * still ships. A build that fails again is a build that failed.
 */

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TARGETS } from './targets.mjs';

const here = dirname(fileURLToPath(import.meta.url));

/** What `cargo` calls the artifact on this host, for a target nobody named. */
const HOST_ARTIFACT = {
  darwin: 'libsense_native.dylib',
  linux: 'libsense_native.so',
  win32: 'sense_native.dll',
}[process.platform];

const at = process.argv.indexOf('--target');
const target = at === -1 ? undefined : process.argv[at + 1];

if (at !== -1 && (target === undefined || !(target in TARGETS))) {
  console.error(`sense: no such target \`${target}\` — one of ${Object.keys(TARGETS).join(', ')}`);
  process.exit(1);
}

/**
 * `cargo`, from `PATH` first and from rustup's own directory second.
 *
 * The second is what a `yarn build` in a shell that never sourced
 * `~/.cargo/env` needs, and the first is what a CI runner with rustup already
 * on `PATH` has — including Windows, where `HOME` is not the variable holding
 * the home directory and the constructed path is not one.
 */
const cargo = [process.env['CARGO'], 'cargo', join(process.env['HOME'] ?? '', '.cargo', 'bin', 'cargo')]
  .filter((candidate) => candidate !== undefined && candidate !== '')
  .find((candidate) => spawnSync(candidate, ['--version'], { stdio: 'ignore' }).status === 0);

if (cargo === undefined) {
  if (target !== undefined) {
    console.error(`sense: no cargo, so ${target} cannot be built`);
    process.exit(1);
  }
  console.log('sense: no cargo on PATH, skipping the native scanner');
  process.exit(0);
}

/**
 * The subcommand and triple a named target is built with.
 *
 * A target with a glibc floor is linked against that glibc's symbol versions
 * rather than the runner's, which `cargo zigbuild` does from the triple's
 * suffix and writes under the plain triple. Asked for and missing is a failure
 * like a missing target: the binary it would have produced loads on fewer
 * machines than the one we publish, and nothing would say so until a `dlopen`.
 */
const floor = target === undefined ? undefined : TARGETS[target].glibc;
const subcommand = floor === undefined ? 'build' : 'zigbuild';
const triple = floor === undefined ? target : `${target}.${floor}`;

const linkable =
  floor === undefined || spawnSync(cargo, ['zigbuild', '--help'], { stdio: 'ignore' }).status === 0;
if (!linkable) {
  console.error(
    `sense: ${target} links against glibc ${floor} through \`cargo zigbuild\`, which is not installed`,
  );
  process.exit(1);
}

if (target === undefined && HOST_ARTIFACT === undefined) {
  console.log(`sense: no native scanner for ${process.platform}, skipping`);
  process.exit(0);
}

/**
 * One `cargo build --release`, optionally narrowed to a microarchitecture.
 *
 * A `target-cpu` changes the code for every crate in the graph, so cargo treats
 * it as a different build and the two do not share artifacts. That is what a
 * measurement of one costs: a full build, not a relink.
 */
function build(cpu, extra = []) {
  const flags = [process.env['RUSTFLAGS'] ?? '', cpu === undefined ? '' : `-C target-cpu=${cpu}`]
    .filter((part) => part !== '')
    .join(' ');
  const run = spawnSync(
    cargo,
    [subcommand, '--release', ...(triple === undefined ? [] : ['--target', triple]), ...extra],
    { cwd: here, stdio: 'inherit', env: { ...process.env, ...(flags === '' ? {} : { RUSTFLAGS: flags }) } },
  );

  return run.status ?? 1;
}

/**
 * Build the scanner, and if the grammars are what stopped it, build it without them.
 *
 * The five tree-sitter grammars are the one part of this crate compiled from C
 * generated by somebody else, by whatever `cc` the machine has. That is a
 * failure mode the rest of the crate does not have, and it is not one to answer
 * by losing the scanner: oxc reads the languages this product is about, and the
 * grammars are a second reader for five more. So a failed build is attempted
 * once again with `--no-default-features`, which drops the grammars and nothing
 * else.
 *
 * What that costs is exactly those five languages, and only their acceleration:
 * `readLanguage` claims nothing, and `record.ts` reads Python, Rust, Java,
 * Kotlin and Swift with the JavaScript oracle — the same readers that run where
 * no addon reached the machine at all. Nothing is skipped and no answer changes.
 *
 * It is said loudly, because a binary that is quietly a smaller binary is the
 * thing this repository has already been bitten by once. A second failure is a
 * failure: the grammars were not what was wrong.
 */
function buildScanner(cpu) {
  if (build(cpu) === 0) return true;

  console.error('sense: the build failed — trying again without the tree-sitter grammars');
  const status = build(cpu, ['--no-default-features']);
  if (status !== 0) process.exit(status);

  console.error(
    'sense: built WITHOUT the tree-sitter grammars. Python, Rust, Java, Kotlin and Swift',
  );
  console.error('sense: are read by the JavaScript readers instead. Everything else is native.');
  return false;
}

buildScanner(process.env['SENSE_TARGET_CPU']);

const from = join(
  here,
  'target',
  ...(target === undefined ? [] : [target]),
  'release',
  target === undefined ? HOST_ARTIFACT : TARGETS[target].artifact,
);

// A host build lands in its own package when we publish one for this host, and
// in `dist/native/` when we do not.
const forHost = Object.values(TARGETS).find(({ package: name }) =>
  name.startsWith(`${process.platform}-${process.arch}`),
);
const published = target === undefined ? forHost?.package : TARGETS[target].package;
const into =
  published === undefined ? join(here, '..', 'dist', 'native') : join(here, '..', 'npm', published);

mkdirSync(into, { recursive: true });
copyFileSync(from, join(into, 'scan.node'));

if (!existsSync(join(into, 'scan.node'))) process.exit(1);
console.log(`sense: native scanner at ${join(into, 'scan.node')}`);
