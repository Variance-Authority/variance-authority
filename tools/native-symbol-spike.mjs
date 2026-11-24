import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { ok } from 'node:assert';
import { resolve } from 'node:path';
import { arch, cpus, platform, release } from 'node:os';
import { sourceIndexPath } from '@variance-authority/sense';

const [rootArg, hyperfine, outputArg, name = 'Button'] = process.argv.slice(2);
if (!rootArg || !hyperfine || !outputArg || process.argv.length > 6) {
  throw new Error('usage: node tools/native-symbol-spike.mjs <checkout> <hyperfine> <output.json> [name]');
}
const implementation = resolve(import.meta.dirname, '..');
const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: resolve(rootArg), encoding: 'utf8' }).trim();
const index = sourceIndexPath(root);
const output = resolve(outputArg);
const native = resolve(implementation, 'packages/sense/native/target/release/examples/symbol-spike');
const cli = resolve(implementation, 'packages/cli/dist/bin.js');
const nativeArgs = [root, index, `${index}.help.bin`, name];
const nodeArgs = [cli, 'ask', 'symbol', '--name', name];
const options = { cwd: root, maxBuffer: 64 * 1024 * 1024 };
const actual = execFileSync(native, nativeArgs, options);
const expected = execFileSync(process.execPath, nodeArgs, options);
ok(actual.equals(expected), 'the complete native and Node answers must agree before either is timed');
process.stdout.write(`Complete symbol answer agrees (${actual.length} bytes).\n`);
const commands = [
  ['native-symbol', [native, ...nativeArgs]],
  ['node-symbol', [process.execPath, ...nodeArgs]],
  ['rg-text', ['rg', '-n', '-F', '--glob', '*.{ts,tsx,js,jsx}', name, '.']],
];
const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
execFileSync(hyperfine, [
  '--warmup', '5', '--runs', '25', '--shell', 'none', '--export-json', output,
  ...commands.flatMap(([label, args]) => ['--command-name', label, args.map(quote).join(' ')]),
], { cwd: root, stdio: 'inherit' });
const results = JSON.parse(readFileSync(output, 'utf8'));
results.context = {
  measuredAt: new Date().toISOString(),
  machine: { platform: platform(), release: release(), arch: arch(), cpu: cpus()[0]?.model, cores: cpus().length },
  node: process.version,
  varianceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: implementation, encoding: 'utf8' }).trim(),
  corpusCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  answerBytes: actual.length,
  name,
  comparison: 'native-symbol and node-symbol return byte-identical answers; rg-text returns source matches and answers a different question',
  fff: 'not measured: no standalone fff executable; fff documents a resident library/MCP interface rather than an equivalent one-shot command',
};
writeFileSync(output, `${JSON.stringify(results, null, 2)}\n`);
