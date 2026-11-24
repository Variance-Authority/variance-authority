import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cargoPath } from '../../../tools/cargo-path.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const dist = join(here, '..', 'dist');
const target = fileURLToPath(new URL('../../../node_modules/.cache/variance-native-cli', import.meta.url));
const binary = process.platform === 'win32' ? 'variance.exe' : 'variance';
const installed = join(dist, binary);
const cargo = cargoPath();
if (cargo === undefined) {
  rmSync(installed, { force: true });
  process.stdout.write('variance: no Cargo, skipping the native entry point\n');
  process.exit(0);
}

mkdirSync(target, { recursive: true });
const scratch = mkdtempSync(join(target, 'responses-'));
const staging = `${installed}.${process.pid}`;
try {
  // The Node command supplies the bytes. Rust only owns which exact calls can
  // use them without starting a process.
  const commands = [['--help'], ['ask', '--help'], ['--version']];
  const entries = commands.map((args, index) => {
    const response = execFileSync(process.execPath, [join(dist, 'bin.js'), ...args], { env: { ...process.env, CI: 'true' } });
    const file = `${index}.out`;
    writeFileSync(join(scratch, file), response);
    return `    (&[${args.map((arg) => JSON.stringify(arg)).join(', ')}], include_bytes!("${file}")),`;
  });
  const responses = join(scratch, 'responses.rs');
  writeFileSync(responses, `const RESPONSES: &[(&[&str], &[u8])] = &[\n${entries.join('\n')}\n];\n`);
  execFileSync(cargo, ['build', '--release', '--locked', '--target-dir', scratch], {
    cwd: here, env: { ...process.env, VARIANCE_CLI_RESPONSES: responses }, stdio: 'inherit',
  });
  copyFileSync(join(scratch, 'release', binary), staging);
  renameSync(staging, installed);
} finally {
  rmSync(staging, { force: true });
  rmSync(scratch, { recursive: true, force: true });
}
